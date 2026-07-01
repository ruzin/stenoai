"""Unit coverage for _normalize_markdown_for_parsing.

Some local models emit a reasoning block whose closing tag runs straight into
the first real header on the same line (e.g. `</thought>## Summary`). Without a
newline between the tag and the `#`, the section parser never recognises the
header and the whole summary collapses into one blob. The normaliser inserts
that missing newline before parsing.
"""

import unittest

from simple_recorder import _normalize_markdown_for_parsing


class NormalizeMarkdownForParsingTests(unittest.TestCase):
    def test_header_adjacent_to_closing_tag_gets_its_own_line(self):
        normalized = _normalize_markdown_for_parsing("</thought>## Summary\ntext")
        self.assertEqual(normalized, "</thought>\n## Summary\ntext")
        # The header now starts a line of its own.
        self.assertIn("\n## Summary", normalized)

    def test_text_without_tag_adjacent_header_is_unchanged(self):
        original = "## Summary\n\nSome discussion text with no reasoning tags."
        self.assertEqual(_normalize_markdown_for_parsing(original), original)

    def test_unrelated_html_like_tag_before_header_is_unchanged(self):
        # Only </think>/</thought> are reasoning-block closers. Any other
        # HTML-like tag the model happens to emit right before a header
        # (e.g. </span>, </div>) must NOT get a spurious section break.
        original = "</span>## Summary\ntext"
        self.assertEqual(_normalize_markdown_for_parsing(original), original)


if __name__ == "__main__":
    unittest.main()
