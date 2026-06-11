import os
import unittest
from unittest.mock import patch

from src import parakeet_models


class MaybeEnableOfflineTests(unittest.TestCase):
    def setUp(self):
        # Snapshot the two env vars we touch so each test runs from a known
        # clean slate and never leaks state into the rest of the suite.
        self._saved = {
            k: os.environ.get(k)
            for k in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")
        }
        for k in self._saved:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_enables_offline_when_installed(self):
        with patch("src.parakeet_models.is_installed", return_value=True):
            enabled = parakeet_models.maybe_enable_offline("some/model")
        self.assertTrue(enabled)
        self.assertEqual(os.environ.get("HF_HUB_OFFLINE"), "1")
        self.assertEqual(os.environ.get("TRANSFORMERS_OFFLINE"), "1")

    def test_noop_when_not_installed(self):
        with patch("src.parakeet_models.is_installed", return_value=False):
            enabled = parakeet_models.maybe_enable_offline("some/model")
        self.assertFalse(enabled)
        self.assertIsNone(os.environ.get("HF_HUB_OFFLINE"))
        self.assertIsNone(os.environ.get("TRANSFORMERS_OFFLINE"))

    def test_does_not_override_explicit_operator_value(self):
        os.environ["HF_HUB_OFFLINE"] = "0"
        with patch("src.parakeet_models.is_installed", return_value=True):
            parakeet_models.maybe_enable_offline("some/model")
        # setdefault must leave an explicit debug override (e.g. =0) intact.
        self.assertEqual(os.environ.get("HF_HUB_OFFLINE"), "0")


if __name__ == "__main__":
    unittest.main()
