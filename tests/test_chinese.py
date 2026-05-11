import unittest
from unittest.mock import patch

from src import chinese


class FakeConverter:
    def __init__(self, suffix):
        self.suffix = suffix

    def convert(self, text):
        return f"{text}{self.suffix}"


class ChineseVariantTests(unittest.TestCase):
    def test_apply_variant_passes_through_without_variant(self):
        self.assertEqual(chinese.apply_variant("hello", None), "hello")

    def test_apply_variant_uses_traditional_converter(self):
        with patch("src.chinese._get_converter", return_value=FakeConverter("-t")):
            self.assertEqual(chinese.apply_variant("汉字", "traditional"), "汉字-t")

    def test_apply_variant_uses_simplified_converter(self):
        with patch("src.chinese._get_converter", return_value=FakeConverter("-s")):
            self.assertEqual(chinese.apply_variant("漢字", "simplified"), "漢字-s")

    def test_missing_converter_returns_original_text(self):
        with patch("src.chinese._get_converter", return_value=None):
            self.assertEqual(chinese.apply_variant("漢字", "simplified"), "漢字")


if __name__ == "__main__":
    unittest.main()
