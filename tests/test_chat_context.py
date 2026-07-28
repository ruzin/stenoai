# tests/test_chat_context.py
"""Tests for Task 8: participants and action items reaching the meeting chat.

Goal 2 of the editable-note feature is that a user's corrections to a note
(participants, action items, ...) are actually visible to the chat, not just
to the note view. Before this change the single-meeting chat context
(`query` / `query-streaming`) sent summary + topics + key points but silently
dropped participants and action items, and the cross-note chat
(`chat-global-streaming`) dropped participants. An edited correction to either
field was therefore invisible to the model regardless of the editor.

These tests drive the real CLI commands end to end (via CliRunner, with only
the Ollama summarizer mocked out) and assert on the actual string handed to
the summarizer — not on a private helper tested in isolation — so a call site
that forgets to use the shared assembly logic would fail here.
"""
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder

_MD_WITH_PARTICIPANTS_AND_ACTIONS = """\
---
title: Team Sync
language: en
duration_seconds: 600
configured_language: en
detected_language: en
---
## Summary

We reviewed the roadmap and agreed next steps.

## Participants

Alice, Bob

## Key Topics

### Roadmap
Discussed Q3 priorities.

## Key Points

- Ship the redesign this quarter

## Action Items

- Alice to send the follow-up doc
- Bob to book the review meeting

## Transcript

Alice: hi. Bob: bye.
"""

_MD_WITHOUT_PARTICIPANTS_OR_ACTIONS = """\
---
title: Quick Check-in
language: en
duration_seconds: 120
configured_language: en
detected_language: en
---
## Summary

Just a quick status check, nothing else discussed.

## Transcript

Alice: all good here.
"""


def _write_md(tmp: str, name: str, content: str) -> Path:
    p = Path(tmp) / name
    p.write_text(content, encoding='utf-8')
    return p


class SingleMeetingChatContextTests(unittest.TestCase):
    """`query` (non-streaming single-meeting chat)."""

    def test_query_context_includes_participants_and_action_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_md(tmp, "meeting_summary.md", _MD_WITH_PARTICIPANTS_AND_ACTIONS)

            fake_summarizer = mock.MagicMock()
            fake_summarizer.query_transcript.return_value = "the answer"

            with mock.patch("simple_recorder.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.query, [str(summary), "-q", "who is coming?"]
                )

            self.assertEqual(res.exit_code, 0, res.output)
            self.assertTrue(fake_summarizer.query_transcript.called)
            context = fake_summarizer.query_transcript.call_args[0][0]

            self.assertIn("PARTICIPANTS:", context)
            self.assertIn("- Alice", context)
            self.assertIn("- Bob", context)
            self.assertIn("ACTION ITEMS:", context)
            self.assertIn("- Alice to send the follow-up doc", context)
            self.assertIn("- Bob to book the review meeting", context)
            # Pre-existing sections must still be present (no regression).
            self.assertIn("SUMMARY:", context)
            self.assertIn("KEY TOPICS:", context)
            self.assertIn("KEY POINTS:", context)

    def test_query_context_omits_empty_sections(self):
        """No participants or action items in the note -> no empty headings
        in the assembled context. A naive implementation that always emits
        the heading (checking key presence rather than list truthiness)
        would fail this."""
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_md(tmp, "meeting_summary.md", _MD_WITHOUT_PARTICIPANTS_OR_ACTIONS)

            fake_summarizer = mock.MagicMock()
            fake_summarizer.query_transcript.return_value = "the answer"

            with mock.patch("simple_recorder.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.query, [str(summary), "-q", "who is coming?"]
                )

            self.assertEqual(res.exit_code, 0, res.output)
            context = fake_summarizer.query_transcript.call_args[0][0]

            self.assertNotIn("PARTICIPANTS:", context)
            self.assertNotIn("ACTION ITEMS:", context)
            # The sections that DO have content must still show up.
            self.assertIn("SUMMARY:", context)


class SingleMeetingChatContextStreamingTests(unittest.TestCase):
    """`query-streaming` duplicates the same assembly for the streaming chat
    entry point used by the renderer; it must not drift from `query`."""

    def test_query_streaming_context_includes_participants_and_action_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_md(tmp, "meeting_summary.md", _MD_WITH_PARTICIPANTS_AND_ACTIONS)

            fake_summarizer = mock.MagicMock()
            fake_summarizer.query_transcript_streaming.return_value = iter(["hi"])

            with mock.patch("simple_recorder.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.query_streaming, [str(summary), "-q", "who is coming?"]
                )

            self.assertEqual(res.exit_code, 0, res.output)
            self.assertIn("CHAT_STREAM_COMPLETE", res.output)
            self.assertTrue(fake_summarizer.query_transcript_streaming.called)
            context = fake_summarizer.query_transcript_streaming.call_args[0][0]

            self.assertIn("PARTICIPANTS:", context)
            self.assertIn("- Alice", context)
            self.assertIn("ACTION ITEMS:", context)
            self.assertIn("- Bob to book the review meeting", context)

    def test_query_streaming_context_omits_empty_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_md(tmp, "meeting_summary.md", _MD_WITHOUT_PARTICIPANTS_OR_ACTIONS)

            fake_summarizer = mock.MagicMock()
            fake_summarizer.query_transcript_streaming.return_value = iter(["hi"])

            with mock.patch("simple_recorder.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.query_streaming, [str(summary), "-q", "who is coming?"]
                )

            self.assertEqual(res.exit_code, 0, res.output)
            context = fake_summarizer.query_transcript_streaming.call_args[0][0]

            self.assertNotIn("PARTICIPANTS:", context)
            self.assertNotIn("ACTION ITEMS:", context)


class GlobalChatContextTests(unittest.TestCase):
    """`chat-global-streaming` (cross-note chat) already included action
    items but dropped participants."""

    def test_global_corpus_includes_participants(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
                output_dir = Path(tmp) / "output"
                output_dir.mkdir(parents=True, exist_ok=True)
                _write_md(
                    str(output_dir),
                    "meeting_summary.md",
                    _MD_WITH_PARTICIPANTS_AND_ACTIONS,
                )

                fake_summarizer = mock.MagicMock()
                fake_summarizer.query_transcript_streaming.return_value = iter(["hi"])

                with mock.patch("simple_recorder.OllamaSummarizer", return_value=fake_summarizer):
                    res = CliRunner().invoke(
                        simple_recorder.chat_global_streaming, ["-q", "who was in the sync?"]
                    )

            self.assertEqual(res.exit_code, 0, res.output)
            self.assertIn("CHAT_STREAM_COMPLETE", res.output)
            self.assertTrue(fake_summarizer.query_transcript_streaming.called)
            corpus = fake_summarizer.query_transcript_streaming.call_args[0][0]

            self.assertIn("Participants:", corpus)
            self.assertIn("- Alice", corpus)
            self.assertIn("- Bob", corpus)
            # Pre-existing sections must still be present (no regression).
            self.assertIn("Action items:", corpus)

    def test_global_corpus_omits_participants_when_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
                output_dir = Path(tmp) / "output"
                output_dir.mkdir(parents=True, exist_ok=True)
                _write_md(
                    str(output_dir),
                    "meeting_summary.md",
                    _MD_WITHOUT_PARTICIPANTS_OR_ACTIONS,
                )

                fake_summarizer = mock.MagicMock()
                fake_summarizer.query_transcript_streaming.return_value = iter(["hi"])

                with mock.patch("simple_recorder.OllamaSummarizer", return_value=fake_summarizer):
                    res = CliRunner().invoke(
                        simple_recorder.chat_global_streaming, ["-q", "who was in the sync?"]
                    )

            self.assertEqual(res.exit_code, 0, res.output)
            corpus = fake_summarizer.query_transcript_streaming.call_args[0][0]

            self.assertNotIn("Participants:", corpus)
            self.assertNotIn("Action items:", corpus)


if __name__ == "__main__":
    unittest.main()
