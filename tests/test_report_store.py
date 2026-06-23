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

    def test_transcript_text_containing_heading_literal_not_truncated(self):
        # A transcript whose TEXT contains the literal '## Transcript' (e.g. a
        # speaker reading a markdown heading aloud) must not split the section
        # early / misclassify content. Only a real heading line splits.
        md = (
            "---\ntitle: \"N\"\nduration_seconds: 60\nlanguage: \"en\"\n---\n\n"
            "## Summary\nDiscussed the markdown spec.\n\n"
            "## Transcript\n\n"
            "Speaker A: the heading is written ## Transcript on its own line.\n"
            "Speaker B: and notes use ## User Notes inline like this.\n"
        )
        with tempfile.TemporaryDirectory() as t:
            mp = Path(t) / "m_summary.md"
            mp.write_text(md, encoding="utf-8")
            m = S.read_meeting(mp)
            # The whole transcript survives, including the literal heading text.
            self.assertIn("written ## Transcript on its own line.", m["transcript"])
            self.assertIn("## User Notes inline like this.", m["transcript"])
            # Notes were NOT split out from the inline mention.
            self.assertIn(m["notes"] or "", ("", None))
            # Summary stays clean.
            self.assertIn("Discussed the markdown spec.", m["summary_markdown"])
            self.assertNotIn("Speaker A", m["summary_markdown"])

    def test_summary_text_containing_heading_literal_not_split(self):
        # The summary body mentioning '## Transcript' inline must not be treated
        # as the section boundary.
        md = (
            "---\ntitle: \"N\"\nduration_seconds: 60\nlanguage: \"en\"\n---\n\n"
            "## Summary\nWe agreed the note format uses ## Transcript as a header.\n\n"
            "## Transcript\n\n"
            "Speaker A: hello.\n"
        )
        with tempfile.TemporaryDirectory() as t:
            mp = Path(t) / "m_summary.md"
            mp.write_text(md, encoding="utf-8")
            m = S.read_meeting(mp)
            self.assertIn("uses ## Transcript as a header.", m["summary_markdown"])
            self.assertEqual(m["transcript"].strip(), "Speaker A: hello.")


if __name__ == "__main__":
    unittest.main()
