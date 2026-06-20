import json
import tempfile
import unittest
from pathlib import Path

from simple_recorder import _atomic_write_json


class AtomicWriteJsonTests(unittest.TestCase):
    """`_atomic_write_json` is the shared tempfile-then-rename writer used for
    the summary JSON (it originally also backed recorder_state.json, which is
    retired — capture state now lives in the Electron main process)."""

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


if __name__ == "__main__":
    unittest.main()
