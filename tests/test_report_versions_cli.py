# tests/test_report_versions_cli.py
import json, tempfile, unittest
from pathlib import Path
from click.testing import CliRunner
import simple_recorder
from src import report_store


def _last_json(out):
    return json.loads([l for l in out.splitlines() if l.strip().startswith("{")][-1])


def _seed(tmp, meeting, sidecar=None):
    """Write a meeting JSON and optionally a sidecar. Returns the meeting path."""
    p = Path(tmp) / "m_summary.json"
    p.write_text(json.dumps(meeting))
    if sidecar is not None:
        sp = report_store.sidecar_path(p)
        sp.write_text(json.dumps(sidecar))
    return p


def _read_sidecar(meeting_path):
    return json.loads(report_store.sidecar_path(meeting_path).read_text())


class SetActiveDeleteCliTests(unittest.TestCase):
    def _meeting(self):
        """Minimal meeting JSON — no reports/active_report in the meeting file."""
        return {"session_info": {"name": "M", "summary_file": "m_summary.json"},
                "summary": "s", "discussion_areas": [], "key_points": [], "action_items": []}

    def _sidecar(self):
        """Sidecar with one report pre-seeded."""
        return {"reports": [{"id": "rep_1", "template_id": "t", "template_name": "T",
                              "model": "m", "content": "c", "created_at": "2026-01-01T00:00:00"}],
                "active_report": None}

    def test_set_active_persists_to_sidecar(self):
        """set-active-report must write active_report to the SIDECAR, not the meeting file."""
        with tempfile.TemporaryDirectory() as tmp:
            p = _seed(tmp, self._meeting(), self._sidecar())
            res = CliRunner().invoke(simple_recorder.set_active_report, [str(p), "rep_1"])
            self.assertTrue(_last_json(res.output)["success"])
            # Sidecar is updated
            sidecar = _read_sidecar(p)
            self.assertEqual(sidecar["active_report"], "rep_1")
            # Meeting file is untouched (no active_report key injected)
            meeting = json.loads(p.read_text())
            self.assertNotIn("active_report", meeting)

    def test_set_active_standard_clears_in_sidecar(self):
        """'standard' clears active_report in the sidecar."""
        with tempfile.TemporaryDirectory() as tmp:
            sc = self._sidecar()
            sc["active_report"] = "rep_1"
            p = _seed(tmp, self._meeting(), sc)
            CliRunner().invoke(simple_recorder.set_active_report, [str(p), "standard"])
            sidecar = _read_sidecar(p)
            self.assertIsNone(sidecar["active_report"])
            meeting = json.loads(p.read_text())
            self.assertNotIn("active_report", meeting)

    def test_delete_report_removes_from_sidecar(self):
        """delete-report must remove the entry from the SIDECAR."""
        with tempfile.TemporaryDirectory() as tmp:
            p = _seed(tmp, self._meeting(), self._sidecar())
            res = CliRunner().invoke(simple_recorder.delete_report, [str(p), "rep_1"])
            self.assertTrue(_last_json(res.output)["success"])
            sidecar = _read_sidecar(p)
            self.assertEqual(sidecar["reports"], [])
            # Meeting file is untouched
            meeting = json.loads(p.read_text())
            self.assertNotIn("reports", meeting)

    def test_set_active_unknown_exits_nonzero(self):
        """Unknown report_id must produce non-zero exit."""
        with tempfile.TemporaryDirectory() as tmp:
            p = _seed(tmp, self._meeting(), self._sidecar())
            res = CliRunner().invoke(simple_recorder.set_active_report, [str(p), "nope"])
            self.assertNotEqual(res.exit_code, 0)

    def test_delete_unknown_exits_nonzero(self):
        """Unknown report_id in delete-report must produce non-zero exit."""
        with tempfile.TemporaryDirectory() as tmp:
            p = _seed(tmp, self._meeting(), self._sidecar())
            res = CliRunner().invoke(simple_recorder.delete_report, [str(p), "nope"])
            self.assertNotEqual(res.exit_code, 0)


if __name__ == "__main__":
    unittest.main()
