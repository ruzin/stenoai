import unittest

from src.summarizer import normalize_markdown


class NormalizeMarkdownTests(unittest.TestCase):
    def test_preserves_emphasis_at_line_start(self):
        self.assertEqual(normalize_markdown("**bold**"), "**bold**")
        self.assertEqual(normalize_markdown("*italic*"), "*italic*")

    def test_adds_missing_bullet_spacing(self):
        self.assertEqual(normalize_markdown("-item"), "- item")
        self.assertEqual(normalize_markdown("*item"), "* item")
        self.assertEqual(normalize_markdown("1. item"), "1. item")

    def test_adds_missing_heading_spacing(self):
        self.assertEqual(normalize_markdown("###Title"), "### Title")


if __name__ == "__main__":
    unittest.main()
