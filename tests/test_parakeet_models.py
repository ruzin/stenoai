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
        os.environ["TRANSFORMERS_OFFLINE"] = "0"
        with patch("src.parakeet_models.is_installed", return_value=True):
            parakeet_models.maybe_enable_offline("some/model")
        # setdefault must leave explicit debug overrides (e.g. =0) intact for
        # both flags.
        self.assertEqual(os.environ.get("HF_HUB_OFFLINE"), "0")
        self.assertEqual(os.environ.get("TRANSFORMERS_OFFLINE"), "0")


class DisableImplicitHfTokenTests(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.get("HF_HUB_DISABLE_IMPLICIT_TOKEN")
        os.environ.pop("HF_HUB_DISABLE_IMPLICIT_TOKEN", None)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("HF_HUB_DISABLE_IMPLICIT_TOKEN", None)
        else:
            os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = self._saved

    def test_sets_flag_when_unset(self):
        # A stray/expired HF token in the environment would 401 the anonymous
        # public download; the flag forces token-free requests.
        parakeet_models.disable_implicit_hf_token()
        self.assertEqual(os.environ.get("HF_HUB_DISABLE_IMPLICIT_TOKEN"), "1")

    def test_does_not_override_explicit_operator_value(self):
        os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "0"
        parakeet_models.disable_implicit_hf_token()
        # setdefault must leave an explicit operator override (e.g. =0 to reach
        # a private mirror) intact.
        self.assertEqual(os.environ.get("HF_HUB_DISABLE_IMPLICIT_TOKEN"), "0")


class DownloadErrorSurfacingTests(unittest.TestCase):
    def test_masking_filenotfound_is_reported_as_http_failure(self):
        model_id = parakeet_models.DEFAULT_MODEL_ID
        # parakeet-mlx/onnx-asr raise this shape when the HF fetch fails and
        # they fall back to a local path; it must not be parroted verbatim.
        masking = FileNotFoundError(
            2, "No such file or directory", f"{model_id}/config.json"
        )
        with patch("src.parakeet.ensure_loaded", side_effect=masking), \
                self.assertLogs("src.parakeet_models", level="ERROR") as cm:
            ok = parakeet_models.download(model_id)
        self.assertFalse(ok)
        joined = "\n".join(cm.output)
        self.assertIn("HF_TOKEN", joined)
        self.assertIn("401", joined)

    def test_unrelated_error_uses_plain_message(self):
        with patch("src.parakeet.ensure_loaded", side_effect=RuntimeError("boom")), \
                self.assertLogs("src.parakeet_models", level="ERROR") as cm:
            ok = parakeet_models.download(parakeet_models.DEFAULT_MODEL_ID)
        self.assertFalse(ok)
        joined = "\n".join(cm.output)
        self.assertIn("download/load failed", joined)
        self.assertNotIn("HF_TOKEN", joined)


if __name__ == "__main__":
    unittest.main()
