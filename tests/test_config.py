import json
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


class ConfigWhisperModelTests(unittest.TestCase):
    def test_default_whisper_model_is_small(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(config.get_whisper_model(), "small")

    def test_set_whisper_model_persists_supported_size(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_whisper_model("large-v3-turbo"))
            self.assertEqual(config.get_whisper_model(), "large-v3-turbo")
            # Round-trip via a fresh Config instance
            reloaded = Config(config_path=path)
            self.assertEqual(reloaded.get_whisper_model(), "large-v3-turbo")

    def test_set_whisper_model_rejects_unknown_size(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertFalse(config.set_whisper_model("ultra-mega"))
            self.assertEqual(config.get_whisper_model(), "small")

    def test_get_whisper_model_falls_back_when_stored_value_invalid(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            # Simulate a hand-edited config with a stale model name
            config._config["whisper_model"] = "obsolete-model"
            self.assertEqual(config.get_whisper_model(), "small")


class ConfigWhisperModelMigrationTests(unittest.TestCase):
    """_migrate_whisper_model runs at load time to rescue configs that hold
    values outside the current SUPPORTED_WHISPER_MODELS list. Bare 'large'
    is the critical case — pywhispercpp.AVAILABLE_MODELS doesn't include it
    and the native loader segfaults if we let the value through to Model()."""

    def _write_config(self, path: Path, payload: dict) -> None:
        path.write_text(json.dumps(payload))

    def test_migrates_bare_large_to_turbo(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            self._write_config(path, {"whisper_model": "large"})
            config = Config(config_path=path)
            self.assertEqual(config.get_whisper_model(), "large-v3-turbo")
            # Persisted to disk so the migration doesn't re-run forever.
            self.assertEqual(
                json.loads(path.read_text())["whisper_model"], "large-v3-turbo"
            )

    def test_migrates_retired_tier_to_small(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            self._write_config(path, {"whisper_model": "medium"})
            config = Config(config_path=path)
            self.assertEqual(config.get_whisper_model(), "small")
            self.assertEqual(
                json.loads(path.read_text())["whisper_model"], "small"
            )

    def test_leaves_supported_value_untouched(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            self._write_config(path, {"whisper_model": "large-v3-turbo"})
            Config(config_path=path)
            # No rewrite happened — value identical, no migration thrash.
            self.assertEqual(
                json.loads(path.read_text())["whisper_model"], "large-v3-turbo"
            )


class ConfigAutoDetectMeetingsTests(unittest.TestCase):
    def test_default_auto_detect_meetings_is_true(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertTrue(config.get_auto_detect_meetings_enabled())

    def test_auto_detect_meetings_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_auto_detect_meetings_enabled(False))
            self.assertFalse(config.get_auto_detect_meetings_enabled())
            reloaded = Config(config_path=path)
            self.assertFalse(reloaded.get_auto_detect_meetings_enabled())
            self.assertTrue(reloaded.set_auto_detect_meetings_enabled(True))
            self.assertTrue(reloaded.get_auto_detect_meetings_enabled())


class ConfigKeepRecordingsTests(unittest.TestCase):
    def test_default_keep_recordings_is_false(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertFalse(config.get_keep_recordings())

    def test_keep_recordings_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_keep_recordings(True))
            self.assertTrue(config.get_keep_recordings())
            reloaded = Config(config_path=path)
            self.assertTrue(reloaded.get_keep_recordings())
            self.assertTrue(reloaded.set_keep_recordings(False))
            self.assertFalse(reloaded.get_keep_recordings())


if __name__ == "__main__":
    unittest.main()
