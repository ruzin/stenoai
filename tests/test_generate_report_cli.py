# tests/test_generate_report_cli.py
import json
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner
from unittest import mock

import simple_recorder
from src.config import Config


def _write_summary(tmp, transcript="Alice: hi. Bob: bye."):
    p = Path(tmp) / "meeting_summary.json"
    p.write_text(json.dumps({
        "summary": "Existing summary",
        "transcript": transcript,
        "session_info": {"name": "Test", "duration_minutes": 10},
    }))
    return p


class GenerateReportCliTests(unittest.TestCase):
    def test_unknown_template_emits_stream_error_and_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            with mock.patch("src.config.get_config", return_value=cfg):
                res = CliRunner().invoke(
                    simple_recorder.generate_report,
                    [str(summary), "does-not-exist"],
                )
            self.assertNotEqual(res.exit_code, 0)
            self.assertIn("STREAM_ERROR", res.output)
            # No report persisted.
            data = json.loads(summary.read_text())
            self.assertFalse(data.get("reports"))

    def test_empty_stream_emits_stream_error_and_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            fake_summarizer = mock.MagicMock()
            fake_summarizer.model_name = "llama3.2:3b"
            # Stream yields only whitespace → must be treated as empty.
            fake_summarizer.summarize_transcript_streaming.return_value = iter(["   ", "\n"])

            with mock.patch("src.config.get_config", return_value=cfg), \
                 mock.patch("src.summarizer.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.generate_report,
                    [str(summary), "standard"],
                )
            self.assertNotEqual(res.exit_code, 0)
            self.assertIn("STREAM_ERROR", res.output)
            self.assertIn("empty report", res.output)
            data = json.loads(summary.read_text())
            self.assertFalse(data.get("reports"))

    def test_valid_stream_writes_before_stream_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            fake_summarizer = mock.MagicMock()
            fake_summarizer.model_name = "llama3.2:3b"
            fake_summarizer.summarize_transcript_streaming.return_value = iter(
                ["## Report\n", "- body"]
            )

            with mock.patch("src.config.get_config", return_value=cfg), \
                 mock.patch("src.summarizer.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.generate_report,
                    [str(summary), "standard"],
                )
            self.assertEqual(res.exit_code, 0, res.output)
            # Ordering: the file is written before STREAM_COMPLETE is emitted.
            saved_idx = res.output.find("STREAM_COMPLETE")
            self.assertNotEqual(saved_idx, -1)
            data = json.loads(summary.read_text())
            self.assertEqual(len(data["reports"]), 1)
            self.assertIn("body", data["reports"][0]["content"])
            self.assertEqual(data["active_report"], data["reports"][0]["id"])


if __name__ == "__main__":
    unittest.main()
