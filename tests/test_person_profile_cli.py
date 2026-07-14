import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config


def _last_json(output):
    line = [ln for ln in output.splitlines() if ln.strip().startswith("{")][-1]
    return json.loads(line)


class PersonProfileCliTests(unittest.TestCase):
    """create/rename-person-profile: the CLI wrapper layer around
    Config's name-uniqueness invariant (see ConfigPersonProfileTests in
    tests/test_config.py for the underlying Config-level behavior) --
    these tests only prove the click command surfaces ValueError as a
    graceful {"success": false, "error": ...} instead of a stack trace."""

    def _run(self, command, args, tmp, cfg=None):
        cfg = cfg or Config(config_path=Path(tmp) / "config.json")
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            result = CliRunner().invoke(command, args)
        return result, cfg

    def test_create_person_profile_succeeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, cfg = self._run(simple_recorder.create_person_profile, ["Max"], tmp)
            self.assertEqual(result.exit_code, 0)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["display_name"], "Max")
            self.assertEqual(len(cfg.get_person_profiles()), 1)

    def test_create_person_profile_rejects_duplicate_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            cfg.create_person_profile("Max")
            result, cfg = self._run(simple_recorder.create_person_profile, ["Max"], tmp, cfg=cfg)
            self.assertNotEqual(result.exit_code, 0)
            data = _last_json(result.output)
            self.assertFalse(data["success"])
            self.assertIn("already exists", data["error"])
            self.assertEqual(len(cfg.get_person_profiles()), 1)

    def test_rename_person_profile_rejects_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            cfg.create_person_profile("Max")
            julian = cfg.create_person_profile("Julian")
            result, cfg = self._run(
                simple_recorder.rename_person_profile, [julian["person_id"], "Max"], tmp, cfg=cfg,
            )
            self.assertNotEqual(result.exit_code, 0)
            data = _last_json(result.output)
            self.assertFalse(data["success"])
            self.assertIn("already exists", data["error"])
            self.assertEqual(cfg.get_person_profile(julian["person_id"])["display_name"], "Julian")


if __name__ == "__main__":
    unittest.main()
