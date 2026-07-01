"""Tests for the Ollama num_ctx sizing helper in src.summarizer.

Ollama otherwise applies a small default context window (~4K) regardless of the
model's real capability, silently truncating long meetings. `resolve_num_ctx`
picks a per-model window clamped to a floor/ceiling. Pure function — no model or
running Ollama required.
"""

import unittest
from unittest import mock

from src.config import Config
from src.summarizer import (
    resolve_num_ctx,
    OLLAMA_NUM_CTX_FLOOR,
    OLLAMA_NUM_CTX_DEFAULT,
    OLLAMA_NUM_CTX_CEILING,
    _OLLAMA_MODEL_NUM_CTX,
)


class ResolveNumCtxTests(unittest.TestCase):
    def test_known_model_returns_mapped_window(self):
        self.assertEqual(resolve_num_ctx("gemma4:e2b-it-qat"), 32768)

    def test_quantized_llama_is_capped_low(self):
        # llama3.2:3b's quantized build effectively caps ~8K despite the headline.
        self.assertEqual(resolve_num_ctx("llama3.2:3b"), 8192)

    def test_unknown_model_falls_back_to_default(self):
        self.assertEqual(resolve_num_ctx("some-future-model:99b"), OLLAMA_NUM_CTX_DEFAULT)

    def test_result_is_always_within_floor_and_ceiling(self):
        for model in list(_OLLAMA_MODEL_NUM_CTX) + ["unknown:1b", ""]:
            value = resolve_num_ctx(model)
            self.assertGreaterEqual(value, OLLAMA_NUM_CTX_FLOOR, msg=model)
            self.assertLessEqual(value, OLLAMA_NUM_CTX_CEILING, msg=model)

    def test_clamps_below_floor_up(self):
        # A model mapped below the floor is raised to the floor. patch.dict
        # restores the shared map even on failure (no leaked test state).
        with mock.patch.dict(_OLLAMA_MODEL_NUM_CTX, {"tiny-test-model": 512}):
            self.assertEqual(resolve_num_ctx("tiny-test-model"), OLLAMA_NUM_CTX_FLOOR)

    def test_clamps_above_ceiling_down(self):
        with mock.patch.dict(
            _OLLAMA_MODEL_NUM_CTX, {"huge-test-model": OLLAMA_NUM_CTX_CEILING * 4}
        ):
            self.assertEqual(
                resolve_num_ctx("huge-test-model"), OLLAMA_NUM_CTX_CEILING
            )

    def test_every_active_registry_model_has_an_explicit_window(self):
        # Drift guard: a model added to the config registry without a num_ctx
        # entry would silently get the generic default. Fail loudly instead so
        # the per-model window is a deliberate choice, not an oversight.
        active = {
            mid
            for mid, info in Config.SUPPORTED_MODELS.items()
            if not info.get("deprecated")
        }
        missing = active - set(_OLLAMA_MODEL_NUM_CTX)
        self.assertEqual(
            missing,
            set(),
            msg=f"active registry models missing a num_ctx entry: {missing}",
        )

    def test_nvfp4_tag_resolves_to_same_num_ctx_as_its_gguf_sibling(self):
        # A value deliberately different from OLLAMA_NUM_CTX_DEFAULT proves the
        # NVFP4 tag is actually canonicalized to its GGUF sibling before lookup,
        # rather than merely falling through to the default (which happens to
        # equal today's real Gemma entries, making a same-value test pass
        # either way regardless of whether canonicalization runs).
        with mock.patch.dict(
            _OLLAMA_MODEL_NUM_CTX,
            {"gemma4:12b-it-qat": 65536, "gemma4:e2b-it-qat": 16384},
        ):
            self.assertEqual(
                resolve_num_ctx("gemma4:12b-nvfp4"),
                resolve_num_ctx("gemma4:12b-it-qat"),
            )
            self.assertEqual(resolve_num_ctx("gemma4:12b-nvfp4"), 65536)

            self.assertEqual(
                resolve_num_ctx("gemma4:e2b-nvfp4"),
                resolve_num_ctx("gemma4:e2b-it-qat"),
            )
            self.assertEqual(resolve_num_ctx("gemma4:e2b-nvfp4"), 16384)


class LocalProviderModelResolutionTests(unittest.TestCase):
    def _make_config(self, model_id):
        cfg = mock.Mock()
        cfg.get_ai_provider.return_value = "local"
        cfg.get_remote_ollama_url.return_value = None
        cfg.get_model.return_value = model_id
        return cfg

    def test_local_provider_resolves_to_nvfp4_on_apple_silicon(self):
        from src.summarizer import OllamaSummarizer
        cfg = self._make_config("gemma4:e2b-it-qat")
        with mock.patch.object(OllamaSummarizer, "_ensure_ollama_ready"), \
             mock.patch("src.summarizer.ollama.Client"), \
             mock.patch("src.config.is_apple_silicon", return_value=True):
            summarizer = OllamaSummarizer(config=cfg)
        self.assertEqual(summarizer.model_name, "gemma4:e2b-nvfp4")

    def test_local_provider_keeps_gguf_off_apple_silicon(self):
        from src.summarizer import OllamaSummarizer
        cfg = self._make_config("gemma4:e2b-it-qat")
        with mock.patch.object(OllamaSummarizer, "_ensure_ollama_ready"), \
             mock.patch("src.summarizer.ollama.Client"), \
             mock.patch("src.config.is_apple_silicon", return_value=False):
            summarizer = OllamaSummarizer(config=cfg)
        self.assertEqual(summarizer.model_name, "gemma4:e2b-it-qat")

    def test_remote_provider_is_never_resolved(self):
        from src.summarizer import OllamaSummarizer
        cfg = mock.Mock()
        cfg.get_ai_provider.return_value = "remote"
        cfg.get_remote_ollama_url.return_value = "http://192.168.1.50:11434"
        cfg.get_model.return_value = "gemma4:e2b-it-qat"
        with mock.patch("src.summarizer.ollama.Client"), \
             mock.patch("src.config.is_apple_silicon", return_value=True):
            summarizer = OllamaSummarizer(config=cfg)
        self.assertEqual(summarizer.model_name, "gemma4:e2b-it-qat")


if __name__ == "__main__":
    unittest.main()
