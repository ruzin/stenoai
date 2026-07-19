"""Reprocess must (re)generate a placeholder note's title.

Now that the pipeline is transcript-first (#276), a fresh recording with
auto-summarize off is saved transcript-only as a placeholder ("Note"), and the
user generates the summary later via "Generate notes" — which reprocesses with
regenerate_title=False. Reprocess must still name that note (its title is an
auto-placeholder), while never overwriting a title the user chose. --regenerate-
title forces regeneration regardless.
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
title: {title}
language: en
duration_seconds: 600
notes_generated: false
---
## Transcript

Alice: let's ship the release on Friday. Bob: agreed.
"""


def _write_note(tmp, title):
    p = Path(tmp) / "meeting_summary.md"
    p.write_text(_MD_TEMPLATE.format(title=title))
    return p


def _fake_summarizer():
    fake = mock.MagicMock()
    fake.model_name = "llama3.2:3b"
    fake.summarize_transcript_streaming.return_value = iter(
        ["## Summary\n", "We agreed to ship on Friday.\n"]
    )
    fake.generate_title.return_value = "Friday Release Plan"
    return fake


def _run(tmp, summary_path, *extra_args):
    cfg = Config(config_path=Path(tmp) / "config.json")
    fake = _fake_summarizer()
    with mock.patch("src.config.get_config", return_value=cfg), \
            mock.patch("src.summarizer.OllamaSummarizer", return_value=fake):
        res = CliRunner().invoke(simple_recorder.reprocess, [str(summary_path), *extra_args])
    return res, fake


def _title_of(summary_path):
    return simple_recorder._parse_meeting_markdown(summary_path)["session_info"]["name"]


class ReprocessTitleTests(unittest.TestCase):
    def test_placeholder_name_gets_a_title_without_force(self):
        # "Generate notes" sends regenerate_title=False; a placeholder note must
        # still be named.
        with tempfile.TemporaryDirectory() as tmp:
            note = _write_note(tmp, "Note")
            res, fake = _run(tmp, note)
            self.assertEqual(res.exit_code, 0, res.output)
            fake.generate_title.assert_called_once()
            self.assertEqual(_title_of(note), "Friday Release Plan")

    def test_user_named_note_is_not_renamed_without_force(self):
        # A title the user chose must survive a plain "Generate notes" reprocess.
        with tempfile.TemporaryDirectory() as tmp:
            note = _write_note(tmp, "Quarterly Board Review")
            res, fake = _run(tmp, note)
            self.assertEqual(res.exit_code, 0, res.output)
            fake.generate_title.assert_not_called()
            self.assertEqual(_title_of(note), "Quarterly Board Review")

    def test_force_regenerates_even_a_user_named_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = _write_note(tmp, "Quarterly Board Review")
            res, fake = _run(tmp, note, "--regenerate-title")
            self.assertEqual(res.exit_code, 0, res.output)
            fake.generate_title.assert_called_once()
            self.assertEqual(_title_of(note), "Friday Release Plan")


if __name__ == "__main__":
    unittest.main()
