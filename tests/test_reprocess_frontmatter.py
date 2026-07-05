# tests/test_reprocess_frontmatter.py
"""Regression tests for reprocess's .md frontmatter rebuild (#276 review).

The reprocess CLI rewrites a .md meeting's frontmatter from scratch. It must
carry forward two fields that may have existed in the original file:
  - `folders` (list of folder IDs the meeting belongs to)
  - `is_live_transcript` (bool, only present when true)
Dropping either silently removes the meeting from all its folders / loses the
live-transcript flag on every regenerate.
"""
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner
from unittest import mock

import simple_recorder
from src.config import Config

_MD_TEMPLATE = """\
---
title: My Meeting
language: en
duration_seconds: 600
{extra}---
## Summary

Existing summary

## Transcript

Alice: hi. Bob: bye.
"""


def _write_summary(tmp, extra_frontmatter=""):
    p = Path(tmp) / "meeting_summary.md"
    p.write_text(_MD_TEMPLATE.format(extra=extra_frontmatter))
    return p


def _fake_summarizer():
    fake = mock.MagicMock()
    fake.model_name = "llama3.2:3b"
    fake.summarize_transcript_streaming.return_value = iter(
        ["## Summary\n", "Regenerated summary body\n"]
    )
    return fake


def _run_reprocess(tmp, summary_path):
    cfg = Config(config_path=Path(tmp) / "config.json")
    with mock.patch("src.config.get_config", return_value=cfg), \
         mock.patch("src.summarizer.OllamaSummarizer", return_value=_fake_summarizer()):
        return CliRunner().invoke(simple_recorder.reprocess, [str(summary_path)])


class ReprocessFrontmatterTests(unittest.TestCase):
    def test_folders_preserved_across_reprocess(self):
        """reprocess must not drop the meeting's folder membership."""
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp, extra_frontmatter='folders: ["folder-abc"]\n')
            res = _run_reprocess(tmp, summary)
            self.assertEqual(res.exit_code, 0, res.output)

            reparsed = simple_recorder._parse_meeting_markdown(summary)
            self.assertIn("folder-abc", reparsed["folders"])

    def test_is_live_transcript_preserved_across_reprocess(self):
        """reprocess must carry forward the is_live_transcript flag when true."""
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp, extra_frontmatter="is_live_transcript: true\n")
            res = _run_reprocess(tmp, summary)
            self.assertEqual(res.exit_code, 0, res.output)

            reparsed = simple_recorder._parse_meeting_markdown(summary)
            self.assertTrue(reparsed["session_info"].get("is_live_transcript"))

    def test_no_folders_key_writes_empty_list(self):
        """A meeting with no folders key must reprocess cleanly to folders: []."""
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp)  # no folders, no is_live_transcript
            res = _run_reprocess(tmp, summary)
            self.assertEqual(res.exit_code, 0, res.output)

            # Check the raw frontmatter, not just the parsed result — the parser
            # defaults a *missing* folders key to [] too, so asserting only on
            # the parsed value wouldn't distinguish "wrote folders: []" from
            # "wrote nothing at all".
            frontmatter = summary.read_text().split('---')[1]
            self.assertIn('folders: []', frontmatter)

            reparsed = simple_recorder._parse_meeting_markdown(summary)
            self.assertEqual(reparsed["folders"], [])
            # is_live_transcript must NOT be injected when it was never set.
            self.assertNotIn("is_live_transcript", reparsed["session_info"])


if __name__ == "__main__":
    unittest.main()
