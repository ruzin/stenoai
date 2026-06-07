import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from simple_recorder import SimpleRecorder, _atomic_write_json


class AtomicWriteJsonTests(unittest.TestCase):
    def test_writes_valid_json_to_new_path(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "state.json"
            payload = {"recording": True, "session_name": "Daily"}

            _atomic_write_json(target, payload)

            self.assertTrue(target.exists())
            with open(target, "r") as f:
                self.assertEqual(json.load(f), payload)

    def test_replaces_existing_file_atomically(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "state.json"
            target.write_text('{"prior": true}')

            _atomic_write_json(target, {"replaced": True})

            with open(target, "r") as f:
                self.assertEqual(json.load(f), {"replaced": True})

    def test_failed_write_preserves_existing_file(self):
        """If json.dump raises mid-flight, the original file must remain intact
        and the temp file must be cleaned up — that's the whole point of the
        atomic-rename pattern."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "state.json"
            target.write_text('{"prior": "intact"}')

            # A payload that can't be JSON-serialised forces json.dump to raise.
            unserialisable = {"obj": object()}

            with self.assertRaises(TypeError):
                _atomic_write_json(target, unserialisable)

            # Original file untouched.
            with open(target, "r") as f:
                self.assertEqual(json.load(f), {"prior": "intact"})

            # No stray *.tmp files left behind in the directory.
            stray_temps = [
                p for p in Path(tmp_dir).iterdir() if p.name.endswith(".tmp")
            ]
            self.assertEqual(stray_temps, [])

    def test_creates_parent_directory_if_missing(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "nested" / "deeper" / "state.json"
            _atomic_write_json(target, {"ok": True})
            self.assertTrue(target.exists())


class GetStateTests(unittest.TestCase):
    """get_state distinguishes 'missing' (return default) from 'corrupt'
    (quarantine + return default + log) from 'unreadable' (log + return
    default). Previously it swallowed all three identically via a bare
    `except:`."""

    def _recorder_in(self, tmp_dir):
        """Build a SimpleRecorder rooted at tmp_dir for its state file.
        Patches the data-dirs side effect since we don't need real data
        dirs for these tests."""
        with patch("src.config.get_data_dirs") as mock_dirs:
            base = Path(tmp_dir)
            mock_dirs.return_value = {
                "recordings": base / "rec",
                "transcripts": base / "trs",
                "output": base / "out",
            }
            recorder = SimpleRecorder()
        # Redirect the state file into our tmp dir for isolation.
        recorder.state_file = Path(tmp_dir) / "recorder_state.json"
        return recorder

    def test_missing_file_returns_default(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            recorder = self._recorder_in(tmp_dir)
            self.assertEqual(
                recorder.get_state(),
                {"recording": False, "current_file": None, "session_name": None},
            )

    def test_valid_state_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            recorder = self._recorder_in(tmp_dir)
            payload = {
                "recording": True,
                "current_file": "/tmp/x.wav",
                "session_name": "Test",
            }
            recorder.save_state(payload)
            self.assertEqual(recorder.get_state(), payload)

    def test_corrupt_json_is_quarantined(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            recorder = self._recorder_in(tmp_dir)
            recorder.state_file.write_text('{"recording": tru')  # truncated

            result = recorder.get_state()

            # Returns default rather than crashing.
            self.assertEqual(
                result,
                {"recording": False, "current_file": None, "session_name": None},
            )
            # Original is gone — moved aside.
            self.assertFalse(recorder.state_file.exists())
            # Quarantined copy exists alongside, preserving the corrupt bytes
            # so a human can inspect them.
            quarantine = recorder.state_file.with_suffix(
                recorder.state_file.suffix + ".corrupt"
            )
            self.assertTrue(quarantine.exists())
            self.assertEqual(quarantine.read_text(), '{"recording": tru')

    def test_invalid_utf8_is_quarantined(self):
        """A partial write can leave the file with bytes that aren't valid
        UTF-8 — open(..., 'r') raises UnicodeDecodeError before json.load
        sees it. That's the same 'content unparseable' failure mode as
        JSONDecodeError and must be quarantined, not propagated."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            recorder = self._recorder_in(tmp_dir)
            # 0xFF / 0xFE are not valid leading UTF-8 bytes.
            recorder.state_file.write_bytes(b'\xff\xfe\x00\x01')

            result = recorder.get_state()

            self.assertEqual(
                result,
                {"recording": False, "current_file": None, "session_name": None},
            )
            self.assertFalse(recorder.state_file.exists())
            quarantine = recorder.state_file.with_suffix(
                recorder.state_file.suffix + ".corrupt"
            )
            self.assertTrue(quarantine.exists())

    def test_unreadable_file_does_not_quarantine(self):
        """A permission error is transient (user could fix it). Don't
        destroy the file — just log and return default."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            recorder = self._recorder_in(tmp_dir)
            recorder.state_file.write_text('{"recording": true}')

            with patch("builtins.open", side_effect=PermissionError("denied")):
                result = recorder.get_state()

            self.assertEqual(
                result,
                {"recording": False, "current_file": None, "session_name": None},
            )
            # File is still where it was — we don't move it aside on a
            # transient OS error.
            self.assertTrue(recorder.state_file.exists())

    def test_save_state_is_atomic_under_crash(self):
        """Simulate a crash by making json.dump raise after partial work.
        The prior state file must survive intact."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            recorder = self._recorder_in(tmp_dir)
            recorder.save_state({"recording": False, "current_file": None})

            original_dump = json.dump

            def explode(*_args, **_kwargs):
                raise RuntimeError("simulated crash mid-write")

            with patch("simple_recorder.json.dump", side_effect=explode):
                with self.assertRaises(RuntimeError):
                    recorder.save_state({"recording": True, "current_file": "/x.wav"})

            # Prior state preserved.
            self.assertEqual(
                json.loads(recorder.state_file.read_text()),
                {"recording": False, "current_file": None},
            )


if __name__ == "__main__":
    unittest.main()
