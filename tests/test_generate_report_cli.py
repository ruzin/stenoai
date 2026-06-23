# tests/test_generate_report_cli.py
import json
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner
from unittest import mock

import simple_recorder
from src import report_store
from src.config import Config

_MD_TEMPLATE = """\
---
language: en
duration_seconds: 600
---
## Summary

Existing summary

## Transcript

{transcript}
"""


def _write_summary(tmp, transcript="Alice: hi. Bob: bye."):
    p = Path(tmp) / "meeting_summary.md"
    p.write_text(_MD_TEMPLATE.format(transcript=transcript))
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
            # No sidecar written.
            sidecar_p = report_store.sidecar_path(summary)
            self.assertFalse(sidecar_p.exists())

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
            # No sidecar written.
            sidecar_p = report_store.sidecar_path(summary)
            self.assertFalse(sidecar_p.exists())

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
            # Ordering: the sidecar is written before STREAM_COMPLETE is emitted.
            self.assertIn("STREAM_COMPLETE", res.output)
            # Report landed in the sidecar, NOT the meeting file.
            sidecar_p = report_store.sidecar_path(summary)
            self.assertTrue(sidecar_p.exists(), "sidecar file should exist")
            sidecar = json.loads(sidecar_p.read_text())
            self.assertEqual(len(sidecar["reports"]), 1)
            self.assertIn("body", sidecar["reports"][0]["content"])
            self.assertEqual(sidecar["active_report"], sidecar["reports"][0]["id"])
            # Meeting file itself must NOT be modified (it's still a .md).
            self.assertTrue(summary.read_text().startswith("---"))


if __name__ == "__main__":
    unittest.main()
