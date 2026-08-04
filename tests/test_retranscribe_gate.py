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
from unittest import mock

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
            # patch.dict save/restores any pre-existing value (CI/dev shells set it).
            with mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
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

    def test_retranscribe_with_ambiguous_stem_prints_marker_and_exits_nonzero(self):
        """Two recordings share the note stem -> ambiguous -> RETRANSCRIBE_NO_AUDIO.

        _find_recording_for_stem declines rather than guessing which source to
        re-run, so the CLI surfaces the same clean audio-gate marker and writes
        nothing.
        """
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
                # recorder.recordings_dir == get_data_dirs()['recordings'] under tmp.
                recordings_dir = Path(tmp) / "recordings"
                recordings_dir.mkdir(parents=True, exist_ok=True)
                (recordings_dir / "meeting.wav").write_bytes(b"a")
                (recordings_dir / "meeting.m4a").write_bytes(b"b")

                summary = Path(tmp) / "meeting_summary.md"
                summary.write_text(_MD_TEMPLATE)
                before = summary.read_text()

                res = CliRunner().invoke(
                    simple_recorder.reprocess, [str(summary), "--retranscribe"]
                )

                self.assertNotEqual(res.exit_code, 0, res.output)
                self.assertIn("STREAM_ERROR:RETRANSCRIBE_NO_AUDIO", res.output)
                self.assertEqual(summary.read_text(), before)


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

    def test_returns_none_when_stem_is_ambiguous(self):
        """Multiple regular files sharing the stem -> decline (don't guess)."""
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "my-note.wav").write_bytes(b"a")
            (Path(tmp) / "my-note.m4a").write_bytes(b"b")
            self.assertIsNone(simple_recorder._find_recording_for_stem(tmp, "my-note"))

    def test_rejects_symlinked_recording(self):
        """A symlink whose stem matches must be rejected (JS/Python parity)."""
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "real-audio.wav"
            target.write_bytes(b"a")
            link = Path(tmp) / "my-note.wav"
            try:
                link.symlink_to(target)
            except (OSError, NotImplementedError) as e:
                self.skipTest(f"symlinks unavailable: {e}")
            # The symlink stem matches but is_symlink() is True -> not returned.
            self.assertIsNone(simple_recorder._find_recording_for_stem(tmp, "my-note"))


if __name__ == "__main__":
    unittest.main()
