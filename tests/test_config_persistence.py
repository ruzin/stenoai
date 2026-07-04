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
import multiprocessing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.config import Config


def _worker_set_key(path_str: str, key: str, value) -> None:
    """Top-level (picklable) worker for the multiprocess stress test: each
    process loads the shared config and writes one distinct key via set()."""
    Config(config_path=Path(path_str)).set(key, value)


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

    def test_non_dict_json_takes_corrupt_path(self):
        # `null` and `[]` parse as valid JSON but would crash every config
        # accessor — they must route through the corrupt-file recovery too.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text("null")

            with patch("src.config.time.sleep"):
                config = Config(config_path=path)

            self.assertTrue(config._load_failed)
            self.assertEqual(path.read_text(), "null")
            self.assertTrue((Path(tmp_dir) / "config.json.corrupt").exists())
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


class LostUpdateTests(unittest.TestCase):
    """Two writers changing DIFFERENT keys must not revert each other.

    The app has no daemon — every operation is a fresh CLI subprocess doing
    load-whole-config -> mutate one key -> write-whole-file. Without the
    snapshot-diff merge under a file lock, the second writer's whole-file
    write reverts the first writer's unrelated key (classic lost update).
    """

    def test_two_writers_different_keys_both_survive(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            # Seed a baseline file both writers load from.
            Config(config_path=path)

            c1 = Config(config_path=path)
            c2 = Config(config_path=path)
            # Two live handles that both loaded the same starting config, then
            # each change a different key (the interleaving a real double-write
            # produces). Pre-fix, c2's save reverted c1's language back to "en".
            self.assertTrue(c1.set_language("de"))
            self.assertTrue(c2.set_notifications_enabled(False))

            on_disk = json.loads(path.read_text())
            self.assertEqual(on_disk["language"], "de")
            self.assertIs(on_disk["notifications_enabled"], False)

    def test_second_save_in_same_process_diffs_correctly(self):
        # After a save adopts the merged result, a second save on the SAME
        # handle must still overlay only its own new change, not resurrect the
        # pre-first-save snapshot.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            Config(config_path=path)

            c1 = Config(config_path=path)
            c2 = Config(config_path=path)

            self.assertTrue(c1.set_language("de"))
            self.assertTrue(c2.set_notifications_enabled(False))
            # c1 writes a second, unrelated key after c2 already wrote.
            self.assertTrue(c1.set_keep_recordings(True))

            on_disk = json.loads(path.read_text())
            self.assertEqual(on_disk["language"], "de")
            self.assertIs(on_disk["notifications_enabled"], False)
            self.assertIs(on_disk["keep_recordings"], True)


class MigrationVsSetterTests(unittest.TestCase):
    def test_load_time_migration_and_concurrent_setter_both_survive(self):
        # A pre-migration config: legacy flat cloud_model triggers the
        # cloud_models migration (a load-time _save) in c1's __init__. A second
        # handle changes an unrelated key; neither write may clobber the other.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({
                "cloud_model": "gpt-4o-mini",
                "cloud_provider": "openai",
                "language": "en",
            }))

            # c2 loads the pre-migration file first (its snapshot has no
            # cloud_models), then c1's construction migrates + saves.
            c2 = Config(config_path=path)
            c1 = Config(config_path=path)  # __init__ migrates cloud_models + saves

            # c2 now writes an unrelated key on top of the migrated file.
            self.assertTrue(c2.set_language("de"))

            on_disk = json.loads(path.read_text())
            # Migration result survives c2's later write.
            self.assertEqual(on_disk["cloud_models"], {"openai": "gpt-4o-mini"})
            # And c2's setter survives.
            self.assertEqual(on_disk["language"], "de")
            del c1  # keep linters quiet; construction was the point


class MultiprocessStressTests(unittest.TestCase):
    def test_concurrent_processes_each_key_survives(self):
        # Real OS processes prove the file lock serializes cross-process, not
        # just cross-handle in one interpreter. spawn matches the frozen app's
        # subprocess model and is the only portable start method on macOS/Windows.
        try:
            ctx = multiprocessing.get_context("spawn")
        except ValueError:  # pragma: no cover - spawn is available on mac/win/linux
            self.skipTest("spawn start method unavailable")

        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            # Seed a baseline so every worker loads the same starting file.
            Config(config_path=path)

            n = 6
            procs = [
                ctx.Process(
                    target=_worker_set_key,
                    args=(str(path), f"stress_key_{i}", i),
                )
                for i in range(n)
            ]
            for p in procs:
                p.start()
            for p in procs:
                p.join(timeout=60)
                self.assertEqual(p.exitcode, 0)

            on_disk = json.loads(path.read_text())
            for i in range(n):
                self.assertEqual(on_disk[f"stress_key_{i}"], i)


if __name__ == "__main__":
    unittest.main()
