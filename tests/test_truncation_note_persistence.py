"""The local-model truncation note must survive past the streaming view.

The note trails the streamed markdown (after ## Action Items), so the
section parsers would silently drop it from the structured fields the
meeting view / copy / share are built from. Both parsers fold it into the
``summary`` field instead.
"""

import tempfile
import unittest
from pathlib import Path

from simple_recorder import (
    SimpleRecorder,
    _extract_truncation_note,
    _parse_meeting_markdown,
)
from src.summarizer import LOCAL_TRUNCATION_USER_NOTE

_STREAMED_MD = f"""## Summary
A quarterly planning discussion.

## Key Topics
### Budget
Reviewed the budget.

## Key Points
- Budget approved

## Action Items
- Send the deck
{LOCAL_TRUNCATION_USER_NOTE}"""


class ExtractTruncationNoteTests(unittest.TestCase):
    def test_extracts_note_content_without_blockquote_marker(self):
        note = _extract_truncation_note(_STREAMED_MD)
        self.assertIsNotNone(note)
        self.assertFalse(note.startswith(">"))
        self.assertIn("longer than the local AI model", note)

    def test_none_when_absent(self):
        self.assertIsNone(_extract_truncation_note("## Summary\nshort meeting"))
        self.assertIsNone(_extract_truncation_note(""))

    def test_matches_the_summarizer_constant(self):
        """The prefix-based detection must actually match the constant the
        summarizer emits — guards against the two drifting apart."""
        self.assertIsNotNone(_extract_truncation_note(LOCAL_TRUNCATION_USER_NOTE))


class ParsedSummaryCarriesNoteTests(unittest.TestCase):
    def test_parse_streamed_markdown_folds_note_into_summary(self):
        parsed = SimpleRecorder._parse_streamed_markdown(_STREAMED_MD)
        self.assertIn("longer than the local AI model", parsed["summary"])
        self.assertIn("A quarterly planning discussion.", parsed["summary"])
        # The note is NOT misparsed as an action item.
        self.assertEqual(parsed["action_items"], ["Send the deck"])

    def test_parse_streamed_markdown_without_note_unchanged(self):
        parsed = SimpleRecorder._parse_streamed_markdown(
            "## Summary\nShort meeting.\n\n## Action Items\n- Do the thing"
        )
        self.assertEqual(parsed["summary"], "Short meeting.")

    def test_parse_meeting_markdown_folds_note_into_summary(self):
        md = f"""---
title: "Planning"
date: "2026-06-12T10:00:00"
duration_seconds: 7200
language: "en"
is_diarised: false
---

{_STREAMED_MD}

## Transcript

a long transcript
"""
        with tempfile.TemporaryDirectory() as tmp_dir:
            md_path = Path(tmp_dir) / "planning_summary.md"
            md_path.write_text(md, encoding="utf-8")
            parsed = _parse_meeting_markdown(md_path)
        self.assertIn("longer than the local AI model", parsed["summary"])
        self.assertEqual(parsed["action_items"], ["Send the deck"])

    def test_note_not_duplicated_if_already_in_summary(self):
        note_text = LOCAL_TRUNCATION_USER_NOTE.strip().lstrip("> ")
        md = (
            f"## Summary\nShort. {note_text}\n\n"
            f"## Action Items\n- x\n{LOCAL_TRUNCATION_USER_NOTE}"
        )
        parsed = SimpleRecorder._parse_streamed_markdown(md)
        self.assertEqual(parsed["summary"].count("longer than the local AI model"), 1)
