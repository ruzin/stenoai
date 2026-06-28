# tests/test_reports.py
import json, tempfile, unittest
from pathlib import Path
from src import reports as R
from src.config import Config


class ReportHelpersTests(unittest.TestCase):
    def test_append_sets_active_and_appends(self):
        m = {"summary": "x"}
        rep = {"id": "rep_1", "template_id": "t", "template_name": "T",
               "model": "llama3.2:3b", "content": "## R\nbody", "created_at": "2026-01-01T00:00:00"}
        R.append_report(m, rep)
        self.assertEqual(m["reports"][0]["content"], "## R\nbody")
        self.assertEqual(m["active_report"], "rep_1")

    def test_ids_are_unique(self):
        self.assertNotEqual(R.new_report_id(), R.new_report_id())


class GetTemplateTests(unittest.TestCase):
    def test_get_template_returns_standard_and_none_for_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = Config(config_path=Path(tmp) / "config.json")
            self.assertEqual(c.get_template("standard")["id"], "standard")
            self.assertIsNone(c.get_template("nope"))


if __name__ == "__main__":
    unittest.main()
