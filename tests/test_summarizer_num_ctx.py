"""Tests for the Ollama num_ctx sizing helper in src.summarizer.

Ollama otherwise applies a small default context window (~4K) regardless of the
model's real capability, silently truncating long meetings. `resolve_num_ctx`
picks a per-model window clamped to a floor/ceiling. Pure function — no model or
running Ollama required.
"""

import unittest

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
        # A model mapped below the floor is raised to the floor.
        tiny = "tiny-test-model"
        _OLLAMA_MODEL_NUM_CTX[tiny] = 512
        try:
            self.assertEqual(resolve_num_ctx(tiny), OLLAMA_NUM_CTX_FLOOR)
        finally:
            del _OLLAMA_MODEL_NUM_CTX[tiny]

    def test_clamps_above_ceiling_down(self):
        huge = "huge-test-model"
        _OLLAMA_MODEL_NUM_CTX[huge] = OLLAMA_NUM_CTX_CEILING * 4
        try:
            self.assertEqual(resolve_num_ctx(huge), OLLAMA_NUM_CTX_CEILING)
        finally:
            del _OLLAMA_MODEL_NUM_CTX[huge]

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


if __name__ == "__main__":
    unittest.main()
