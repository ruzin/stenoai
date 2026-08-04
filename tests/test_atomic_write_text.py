"""Persistence safety for the summary Markdown.

The .md note is the app's primary user artifact, and it is rewritten in
place on every reprocess, retranscribe, title regeneration and live
append. Path.write_text truncates the file first, so a crash or a full
disk between truncate and write left the user with an empty or
half-written note and nothing to fall back to.

These tests pin the guarantee _atomic_write_text provides: the previous
file survives a failed write untouched, and no temp debris is left behind.
"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.config import _atomic_write_text


class AtomicWriteTextTests(unittest.TestCase):
    def test_write_replaces_previous_content_and_leaves_no_tmp_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "meeting.md"
            _atomic_write_text(path, "---\ntitle: \"First\"\n---\n")
            _atomic_write_text(path, "---\ntitle: \"Zweite Fassung\"\n---\n")

            self.assertEqual(path.read_text(encoding="utf-8"),
                             "---\ntitle: \"Zweite Fassung\"\n---\n")
            leftovers = [p for p in Path(tmp_dir).iterdir() if p.suffix == ".tmp"]
            self.assertEqual(leftovers, [])

    def test_failed_write_preserves_previous_file(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "meeting.md"
            _atomic_write_text(path, "## Summary\n\nThe original note.\n")
            before = path.read_text(encoding="utf-8")

            # Fail after the payload has been written to the temp file but
            # before the replace — the "disk fills up mid-write" case.
            with patch("src.config.os.fsync", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    _atomic_write_text(path, "## Summary\n\nThe replacement.\n")

            # The note on disk is the previous, complete version — not empty,
            # not truncated.
            self.assertEqual(path.read_text(encoding="utf-8"), before)
            leftovers = [p for p in Path(tmp_dir).iterdir() if p.suffix == ".tmp"]
            self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
