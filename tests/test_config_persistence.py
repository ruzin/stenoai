"""Persistence safety for config.json.

config.json is read and written by many concurrent short-lived CLI
subprocesses. These tests pin down the two guarantees that prevent a
settings wipe (the "org user silently reset to local llama" bug):

1. _save() is atomic — a reader never sees a torn file, and a failed
   save leaves the previous file intact.
2. A corrupt (or torn) existing file is never overwritten by the
   load-time migrations persisting in-memory defaults.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.config import Config


class AtomicSaveTests(unittest.TestCase):
    def test_save_leaves_valid_json_and_no_tmp_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_ai_provider("cloud"))

            on_disk = json.loads(path.read_text())
            self.assertEqual(on_disk["ai_provider"], "cloud")
            leftovers = [p for p in Path(tmp_dir).iterdir() if p.suffix == ".tmp"]
            self.assertEqual(leftovers, [])

    def test_failed_save_preserves_previous_file(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_ai_provider("cloud"))
            before = path.read_text()

            with patch("src.config.json.dump", side_effect=OSError("disk full")):
                success = config.set_ai_provider("remote")

            self.assertFalse(success)
            # On-disk file is the previous, fully-valid version — not torn.
            self.assertEqual(path.read_text(), before)
            self.assertEqual(json.loads(before)["ai_provider"], "cloud")


class CorruptConfigTests(unittest.TestCase):
    def _write_corrupt(self, tmp_dir: str) -> Path:
        path = Path(tmp_dir) / "config.json"
        path.write_text('{"ai_provider": "adapter", "model": "llam')  # torn write
        return path

    def test_corrupt_config_is_not_overwritten_by_migrations(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = self._write_corrupt(tmp_dir)
            corrupt_bytes = path.read_bytes()

            with patch("src.config.time.sleep"):
                config = Config(config_path=path)

            self.assertTrue(config._load_failed)
            # The recoverable original is untouched and backed up.
            self.assertEqual(path.read_bytes(), corrupt_bytes)
            backup = Path(tmp_dir) / "config.json.corrupt"
            self.assertTrue(backup.exists())
            self.assertEqual(backup.read_bytes(), corrupt_bytes)
            # In-memory we run on defaults.
            self.assertEqual(config.get_ai_provider(), "local")

    def test_torn_read_retry_heals(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"ai_provider": "adapter", "cloud_models": {}}))

            real_load = json.load
            calls = {"n": 0}

            def flaky_load(f):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise json.JSONDecodeError("torn", "", 0)
                return real_load(f)

            with patch("src.config.json.load", side_effect=flaky_load), \
                    patch("src.config.time.sleep"):
                config = Config(config_path=path)

            self.assertFalse(config._load_failed)
            self.assertEqual(config.get_ai_provider(), "adapter")

    def test_set_after_corrupt_load_writes_valid_file(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = self._write_corrupt(tmp_dir)
            with patch("src.config.time.sleep"):
                config = Config(config_path=path)

            self.assertTrue(config.set_ai_provider("cloud"))
            on_disk = json.loads(path.read_text())
            self.assertEqual(on_disk["ai_provider"], "cloud")
            # The pre-wipe original stays available for recovery.
            self.assertTrue((Path(tmp_dir) / "config.json.corrupt").exists())


class MigrationStillRunsOnHealthyLoadTests(unittest.TestCase):
    def test_legacy_cloud_model_still_migrates(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({
                "cloud_model": "gpt-4o-mini",
                "cloud_provider": "openai",
            }))

            config = Config(config_path=path)

            self.assertEqual(config._config["cloud_models"], {"openai": "gpt-4o-mini"})
            on_disk = json.loads(path.read_text())
            self.assertEqual(on_disk["cloud_models"], {"openai": "gpt-4o-mini"})


if __name__ == "__main__":
    unittest.main()
