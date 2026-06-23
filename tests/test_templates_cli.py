# tests/test_templates_cli.py
import json
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner
from unittest import mock

import simple_recorder
from src.config import Config


def _last_json(output):
    line = [ln for ln in output.splitlines() if ln.strip().startswith("{")][-1]
    return json.loads(line)


class TemplatesCliTests(unittest.TestCase):
    def _run(self, cmd, args, tmp):
        cfg = Config(config_path=Path(tmp) / "config.json")
        with mock.patch("src.config.get_config", return_value=cfg):
            return CliRunner().invoke(cmd, args), cfg

    def test_list_templates_includes_standard_and_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            res, _ = self._run(simple_recorder.list_templates, [], tmp)
            data = _last_json(res.output)
            ids = [t["id"] for t in data["templates"]]
            self.assertIn("standard", ids)
            self.assertEqual(data["default_template_id"], "standard")

    def test_save_template_creates_custom(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = json.dumps({"name": "Leitung", "prompt": "kurz", "language": "de"})
            res, cfg = self._run(simple_recorder.save_template, [payload], tmp)
            data = _last_json(res.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["template"]["id"], "leitung")

    def test_set_default_template_persists(self):
        with tempfile.TemporaryDirectory() as tmp:
            res, cfg = self._run(simple_recorder.set_default_template, ["shareable-summary"], tmp)
            self.assertTrue(_last_json(res.output)["success"])

    def test_set_default_unknown_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            res, _ = self._run(simple_recorder.set_default_template, ["nope"], tmp)
            self.assertNotEqual(res.exit_code, 0)


if __name__ == "__main__":
    unittest.main()
