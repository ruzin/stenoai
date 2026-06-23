# tests/test_report_store.py
import json, tempfile, unittest
from pathlib import Path
from src import report_store as S


MD = '''---
title: "Note"
date: "2026-06-14T08:43:37"
duration_seconds: 120
language: "de"
is_diarised: false
---

## Summary
An overview.

## Key Points
- one

## Transcript

Speaker A: hello.
Speaker B: hi.

## User Notes

remember coffee
'''


class SidecarPathTests(unittest.TestCase):
    def test_md_and_json_map_to_same_sidecar(self):
        self.assertEqual(S.sidecar_path("/x/abc_summary.md").name, "abc_reports.json")
        self.assertEqual(S.sidecar_path("/x/abc_summary.json").name, "abc_reports.json")


class LoadSaveSidecarTests(unittest.TestCase):
    def test_missing_returns_empty(self):
        with tempfile.TemporaryDirectory() as t:
            sc = S.load_sidecar(Path(t) / "m_summary.md")
            self.assertEqual(sc, {"reports": [], "active_report": None})

    def test_save_then_load_roundtrip(self):
        with tempfile.TemporaryDirectory() as t:
            mp = Path(t) / "m_summary.md"
            S.save_sidecar(mp, {"reports": [{"id": "r1"}], "active_report": "r1"})
            self.assertEqual(S.load_sidecar(mp)["active_report"], "r1")
            self.assertTrue((Path(t) / "m_reports.json").exists())


class ReadMeetingTests(unittest.TestCase):
    def test_reads_md_transcript_notes_summary(self):
        with tempfile.TemporaryDirectory() as t:
            mp = Path(t) / "m_summary.md"
            mp.write_text(MD, encoding="utf-8")
            m = S.read_meeting(mp)
            self.assertIn("Speaker A: hello.", m["transcript"])
            self.assertIn("Speaker B: hi.", m["transcript"])
            self.assertNotIn("## Transcript", m["transcript"])
            self.assertEqual(m["notes"].strip(), "remember coffee")
            self.assertIn("## Summary", m["summary_markdown"])
            self.assertIn("An overview.", m["summary_markdown"])
            self.assertNotIn("## Transcript", m["summary_markdown"])
            self.assertEqual(m["language"], "de")
            self.assertEqual(m["duration_minutes"], 2)

    def test_reads_json_meeting(self):
        with tempfile.TemporaryDirectory() as t:
            mp = Path(t) / "m_summary.json"
            mp.write_text(json.dumps({
                "transcript": "T: hi", "user_notes": "n",
                "summary": "ov", "key_points": ["kp"], "discussion_areas": [], "action_items": [],
                "session_info": {"duration_seconds": 180, "output_language": "en"},
            }), encoding="utf-8")
            m = S.read_meeting(mp)
            self.assertEqual(m["transcript"], "T: hi")
            self.assertEqual(m["language"], "en")
            self.assertEqual(m["duration_minutes"], 3)
            self.assertIn("ov", m["summary_markdown"])

    def test_md_without_notes_section(self):
        with tempfile.TemporaryDirectory() as t:
            mp = Path(t) / "m_summary.md"
            mp.write_text(MD.split("## User Notes")[0], encoding="utf-8")
            m = S.read_meeting(mp)
            self.assertIn("Speaker A: hello.", m["transcript"])
            self.assertIn(m["notes"] or "", ("", None))


if __name__ == "__main__":
    unittest.main()
