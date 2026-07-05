# tests/test_save_transcript_note.py
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner
from unittest import mock

import simple_recorder
from simple_recorder import _parse_meeting_markdown
from src.config import Config

_TRANSCRIPT = "[00:03] [You] hello there\n[00:05] [Others] hi, good to see you"


def _data_dirs(tmp):
    """A get_data_dirs() stand-in pointing every dir at the temp root."""
    root = Path(tmp)
    return {
        "output": root / "output",
        "recordings": root / "recordings",
        "transcripts": root / "transcripts",
    }


class SaveTranscriptNoteTests(unittest.TestCase):
    def _save(self, tmp, extra_args=None):
        with mock.patch("src.config.get_data_dirs", return_value=_data_dirs(tmp)):
            res = CliRunner().invoke(
                simple_recorder.save_transcript_note,
                [
                    "--name", "New note",
                    "--transcript", _TRANSCRIPT,
                    "--duration-seconds", "8",
                    "--language", "en",
                ] + (extra_args or []),
            )
        return res

    def test_writes_pending_note_with_transcript_and_no_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = self._save(tmp)
            self.assertEqual(res.exit_code, 0, res.output)
            self.assertIn("SAVED:", res.output)

            saved = res.output.split("SAVED:", 1)[1].strip().splitlines()[0]
            p = Path(saved)
            self.assertTrue(p.exists(), "note file should be written")
            self.assertTrue(p.name.endswith("_summary.md"))

            body = p.read_text(encoding="utf-8")
            self.assertIn("summary_status: \"pending\"", body)
            self.assertIn("## Transcript", body)
            self.assertIn("[00:03] [You] hello there", body)
            self.assertIn("[00:05] [Others] hi", body)
            # No summary section — the pending state keys on its absence.
            self.assertNotIn("## Summary", body)

    def test_parse_surfaces_pending_status_and_transcript(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = self._save(tmp)
            saved = res.output.split("SAVED:", 1)[1].strip().splitlines()[0]
            parsed = _parse_meeting_markdown(Path(saved))

            self.assertEqual(parsed["session_info"].get("summary_status"), "pending")
            self.assertNotIn("transcription_failed", parsed["session_info"])
            self.assertTrue(parsed["transcript"].strip(), "transcript must be non-empty")
            self.assertEqual(parsed["summary"], "")

    def test_empty_transcript_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch("src.config.get_data_dirs", return_value=_data_dirs(tmp)):
                res = CliRunner().invoke(
                    simple_recorder.save_transcript_note,
                    ["--name", "New note", "--transcript", "   "],
                )
            self.assertNotEqual(res.exit_code, 0)
            self.assertIn("No transcript", res.output)

    def test_transcript_file_wins_over_inline(self):
        with tempfile.TemporaryDirectory() as tmp:
            tf = Path(tmp) / "t.txt"
            tf.write_text("[00:01] [You] from a file", encoding="utf-8")
            with mock.patch("src.config.get_data_dirs", return_value=_data_dirs(tmp)):
                res = CliRunner().invoke(
                    simple_recorder.save_transcript_note,
                    [
                        "--name", "New note",
                        "--transcript", "inline should lose",
                        "--transcript-file", str(tf),
                    ],
                )
            self.assertEqual(res.exit_code, 0, res.output)
            saved = res.output.split("SAVED:", 1)[1].strip().splitlines()[0]
            body = Path(saved).read_text(encoding="utf-8")
            self.assertIn("from a file", body)
            self.assertNotIn("inline should lose", body)

    def test_reprocess_fills_summary_and_drops_pending_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = self._save(tmp)
            saved = res.output.split("SAVED:", 1)[1].strip().splitlines()[0]

            cfg = Config(config_path=Path(tmp) / "config.json")
            fake = mock.MagicMock()
            fake.model_name = "llama3.2:3b"
            fake.summarize_transcript_streaming.return_value = iter(
                ["## Summary\n", "A short meeting."]
            )
            with mock.patch("src.config.get_config", return_value=cfg), \
                 mock.patch("src.summarizer.OllamaSummarizer", return_value=fake):
                rres = CliRunner().invoke(simple_recorder.reprocess, [saved])
            self.assertEqual(rres.exit_code, 0, rres.output)

            reparsed = _parse_meeting_markdown(Path(saved))
            self.assertNotIn("summary_status", reparsed["session_info"])
            self.assertIn("short meeting", reparsed["summary"].lower())
            self.assertTrue(reparsed["transcript"].strip(), "transcript must survive reprocess")


if __name__ == "__main__":
    unittest.main()
