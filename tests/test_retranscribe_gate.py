# tests/test_retranscribe_gate.py
"""Tests for the re-transcribe MVP audio-gate (#266).

Re-transcribe (`reprocess --retranscribe`) re-runs ASR on the ORIGINAL
recording, so it is only possible when that recording still exists on disk
(keep-recordings was on). When the audio is gone the command must fail cleanly
with the distinct `RETRANSCRIBE_NO_AUDIO` marker (so the renderer can say
"recording no longer available") and touch nothing — no partial rewrite of the
note. This is the core MVP gate and is model-free: it exits before any ASR or
summariser is initialised.
"""
import os
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner

import simple_recorder

_MD_TEMPLATE = """\
---
title: My Meeting
language: en
duration_seconds: 600
configured_language: en
detected_language: en
---
## Summary

Existing summary

## Transcript

Alice: hi. Bob: bye.
"""


class RetranscribeNoAudioGateTests(unittest.TestCase):
    def test_retranscribe_without_recording_prints_marker_and_exits_nonzero(self):
        """No source recording on disk -> RETRANSCRIBE_NO_AUDIO, non-zero, no write."""
        with tempfile.TemporaryDirectory() as tmp:
            # STENOAI_USER_DATA_DIR drives get_data_dirs(), so recorder.recordings_dir
            # is this (empty) temp dir -> no recording can match the note stem.
            os.environ["STENOAI_USER_DATA_DIR"] = tmp
            try:
                summary = Path(tmp) / "meeting_summary.md"
                summary.write_text(_MD_TEMPLATE)
                before = summary.read_text()

                res = CliRunner().invoke(
                    simple_recorder.reprocess, [str(summary), "--retranscribe"]
                )

                self.assertNotEqual(res.exit_code, 0, res.output)
                self.assertIn("STREAM_ERROR:RETRANSCRIBE_NO_AUDIO", res.output)
                # The gate must touch nothing: the note is byte-for-byte unchanged.
                self.assertEqual(summary.read_text(), before)
            finally:
                os.environ.pop("STENOAI_USER_DATA_DIR", None)


class FindRecordingForStemTests(unittest.TestCase):
    def test_matches_recording_by_stem_any_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec = Path(tmp) / "my-note.webm"
            rec.write_bytes(b"fake audio")
            found = simple_recorder._find_recording_for_stem(tmp, "my-note")
            self.assertIsNotNone(found)
            self.assertEqual(Path(found).name, "my-note.webm")

    def test_returns_none_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "other.wav").write_bytes(b"x")
            self.assertIsNone(simple_recorder._find_recording_for_stem(tmp, "my-note"))

    def test_returns_none_when_dir_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "does-not-exist"
            self.assertIsNone(simple_recorder._find_recording_for_stem(missing, "my-note"))


if __name__ == "__main__":
    unittest.main()
