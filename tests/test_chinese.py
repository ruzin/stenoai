"""Tests for src.chinese (Simplified ↔ Traditional conversion via OpenCC).

The real-conversion tests double as the staleness check on
``opencc-python-reimplemented==0.1.7``: its PyPI classifiers stop at Python 3.5,
so a green run here proves it still imports AND converts on the interpreter that
ships in the signed binary. The missing-OpenCC test proves the module degrades
gracefully (returns its input, never raises) when the dependency is absent.
"""
import builtins
import unittest
from unittest.mock import patch

from src import chinese

# Known-good pair. 简体中文 (Simplified) ↔ 簡體中文 (Traditional).
SIMPLIFIED = "简体中文"
TRADITIONAL = "簡體中文"


def _opencc_installed() -> bool:
    try:
        import opencc  # noqa: F401
        return True
    except ImportError:
        return False


@unittest.skipUnless(_opencc_installed(), "opencc not installed in this env")
class ChineseRealConversionTests(unittest.TestCase):
    """Exercise the real OpenCC converters (no mocks)."""

    def setUp(self):
        # Converters are module-level singletons; other tests may have poisoned
        # them (missing-import test). Reset so we build fresh real ones.
        chinese._converter_s2t = None
        chinese._converter_t2s = None
        chinese._unavailable_logged = False

    def test_s2t_converts_simplified_to_traditional(self):
        self.assertEqual(chinese.to_traditional(SIMPLIFIED), TRADITIONAL)

    def test_t2s_converts_traditional_to_simplified(self):
        self.assertEqual(chinese.to_simplified(TRADITIONAL), SIMPLIFIED)

    def test_round_trip_is_identity(self):
        self.assertEqual(chinese.to_simplified(chinese.to_traditional(SIMPLIFIED)), SIMPLIFIED)

    def test_apply_variant_traditional(self):
        self.assertEqual(chinese.apply_variant(SIMPLIFIED, "traditional"), TRADITIONAL)

    def test_apply_variant_simplified(self):
        self.assertEqual(chinese.apply_variant(TRADITIONAL, "simplified"), SIMPLIFIED)

    def test_apply_variant_accepts_ui_language_codes(self):
        self.assertEqual(chinese.apply_variant(SIMPLIFIED, "zh-Hant"), TRADITIONAL)
        self.assertEqual(chinese.apply_variant(TRADITIONAL, "zh-Hans"), SIMPLIFIED)

    def test_convert_alias(self):
        self.assertEqual(chinese.convert(SIMPLIFIED, "traditional"), TRADITIONAL)


class ChineseVariantPassthroughTests(unittest.TestCase):
    """Behaviour that must hold regardless of whether OpenCC is installed."""

    def test_apply_variant_passes_through_without_variant(self):
        self.assertEqual(chinese.apply_variant("hello", None), "hello")

    def test_apply_variant_passes_through_unknown_variant(self):
        self.assertEqual(chinese.apply_variant("hello", "en"), "hello")

    def test_empty_and_none_are_returned_unchanged(self):
        self.assertEqual(chinese.apply_variant("", "traditional"), "")
        self.assertIsNone(chinese.apply_variant(None, "traditional"))


class ChineseMissingOpenCCTests(unittest.TestCase):
    """When OpenCC can't be imported, every entry point degrades gracefully."""

    def setUp(self):
        # Drop any cached real converters so _get_converter re-attempts the
        # (now-failing) import instead of returning a live singleton.
        chinese._converter_s2t = None
        chinese._converter_t2s = None
        chinese._unavailable_logged = False

    def tearDown(self):
        chinese._converter_s2t = None
        chinese._converter_t2s = None
        chinese._unavailable_logged = False

    def test_conversion_returns_input_when_opencc_missing(self):
        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "opencc" or name.startswith("opencc."):
                raise ImportError("simulated: opencc not installed")
            return real_import(name, *args, **kwargs)

        with patch.object(builtins, "__import__", side_effect=fake_import):
            # No throw, and the input is returned unchanged in every direction.
            self.assertEqual(chinese.to_traditional(SIMPLIFIED), SIMPLIFIED)
            self.assertEqual(chinese.to_simplified(TRADITIONAL), TRADITIONAL)
            self.assertEqual(chinese.apply_variant(SIMPLIFIED, "traditional"), SIMPLIFIED)
            self.assertIsNone(chinese.apply_variant(None, "traditional"))


if __name__ == "__main__":
    unittest.main()
