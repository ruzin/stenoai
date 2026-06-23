# tests/test_report_versions_cli.py
import json, tempfile, unittest
from pathlib import Path
from click.testing import CliRunner
import simple_recorder


def _last_json(out):
    return json.loads([l for l in out.splitlines() if l.strip().startswith("{")][-1])


def _seed(tmp, meeting):
    p = Path(tmp) / "m_summary.json"
    p.write_text(json.dumps(meeting))
    return p


class SetActiveDeleteCliTests(unittest.TestCase):
    def _meeting(self):
        return {"session_info": {"name": "M", "summary_file": "m_summary.json"},
                "summary": "s", "discussion_areas": [], "key_points": [], "action_items": [],
                "reports": [{"id": "rep_1", "template_id": "t", "template_name": "T",
                             "model": "m", "content": "c", "created_at": "2026-01-01T00:00:00"}],
                "active_report": None}

    def test_set_active_persists(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = _seed(tmp, self._meeting())
            res = CliRunner().invoke(simple_recorder.set_active_report, [str(p), "rep_1"])
            self.assertTrue(_last_json(res.output)["success"])
            self.assertEqual(json.loads(p.read_text())["active_report"], "rep_1")

    def test_set_active_standard_clears(self):
        with tempfile.TemporaryDirectory() as tmp:
            m = self._meeting(); m["active_report"] = "rep_1"
            p = _seed(tmp, m)
            CliRunner().invoke(simple_recorder.set_active_report, [str(p), "standard"])
            self.assertIsNone(json.loads(p.read_text())["active_report"])

    def test_delete_report_removes(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = _seed(tmp, self._meeting())
            res = CliRunner().invoke(simple_recorder.delete_report, [str(p), "rep_1"])
            self.assertTrue(_last_json(res.output)["success"])
            self.assertEqual(json.loads(p.read_text())["reports"], [])

    def test_set_active_unknown_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = _seed(tmp, self._meeting())
            res = CliRunner().invoke(simple_recorder.set_active_report, [str(p), "nope"])
            self.assertNotEqual(res.exit_code, 0)


if __name__ == "__main__":
    unittest.main()
