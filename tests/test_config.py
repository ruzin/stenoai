import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.config import Config


class ConfigStoragePathTests(unittest.TestCase):
    def test_set_storage_path_handles_permission_errors(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(config.get_storage_path(), "")

            with patch("pathlib.Path.mkdir", side_effect=PermissionError("no access")):
                success = config.set_storage_path("/System/Library")

            self.assertFalse(success)
            self.assertEqual(config.get_storage_path(), "")

    def test_set_storage_path_accepts_none_as_reset(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            success = config.set_storage_path(None)
            self.assertTrue(success)
            self.assertEqual(config.get_storage_path(), "")


class ConfigLanguageTests(unittest.TestCase):
    def test_set_language_accepts_supported_dutch_code(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            success = config.set_language("nl")
            self.assertTrue(success)
            self.assertEqual(config.get_language(), "nl")
            self.assertEqual(config.get_language_name("nl"), "Dutch")

    def test_set_language_accepts_auto_detection_mode(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            success = config.set_language("auto")
            self.assertTrue(success)
            self.assertEqual(config.get_language(), "auto")
            self.assertEqual(config.get_language_name("auto"), "Auto (detect)")


class HFMirrorTests(unittest.TestCase):
    def test_every_active_supported_model_has_mirror(self):
        # Models without a `deprecated: True` flag should be coverable by the
        # HF fallback so VPN-blocked users can still complete setup.
        active = {
            name for name, meta in Config.SUPPORTED_MODELS.items()
            if not meta.get("deprecated")
        }
        missing = active - set(Config.HF_MIRRORS.keys())
        self.assertEqual(
            missing, set(),
            f"Active supported models without an HF mirror: {missing}"
        )

    def test_hf_mirrors_use_hf_co_prefix(self):
        for internal_id, mirror in Config.HF_MIRRORS.items():
            self.assertTrue(
                mirror.startswith("hf.co/"),
                f"{internal_id} mirror must start with hf.co/, got {mirror!r}"
            )

    def test_get_pull_candidates_returns_internal_id_first(self):
        candidates = Config.get_pull_candidates("llama3.2:3b")
        self.assertEqual(candidates[0], "llama3.2:3b")
        self.assertEqual(candidates[1], Config.HF_MIRRORS["llama3.2:3b"])

    def test_get_pull_candidates_for_unmirrored_model(self):
        # An unknown / unmirrored model should still return a single-entry list,
        # so callers can iterate uniformly without special-casing.
        candidates = Config.get_pull_candidates("not-a-real-model:1b")
        self.assertEqual(candidates, ["not-a-real-model:1b"])

    def test_resolved_pull_tag_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertIsNone(config.get_resolved_pull_tag("llama3.2:3b"))

            mirror = Config.HF_MIRRORS["llama3.2:3b"]
            self.assertTrue(config.set_resolved_pull_tag("llama3.2:3b", mirror))
            self.assertEqual(config.get_resolved_pull_tag("llama3.2:3b"), mirror)

            # Reload to verify persistence.
            reloaded = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(reloaded.get_resolved_pull_tag("llama3.2:3b"), mirror)

    def test_resolved_pull_tags_are_keyed_per_model(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            config.set_resolved_pull_tag("llama3.2:3b", "hf.co/example/llama:Q4_K_M")
            config.set_resolved_pull_tag("gemma3:4b", "hf.co/example/gemma:Q4_K_M")
            self.assertEqual(
                config.get_resolved_pull_tag("llama3.2:3b"),
                "hf.co/example/llama:Q4_K_M",
            )
            self.assertEqual(
                config.get_resolved_pull_tag("gemma3:4b"),
                "hf.co/example/gemma:Q4_K_M",
            )
            self.assertIsNone(config.get_resolved_pull_tag("never-set:1b"))


if __name__ == "__main__":
    unittest.main()
