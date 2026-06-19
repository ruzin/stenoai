"""Tests for the cross-note chat corpus budget (_chat_corpus_char_budget).

The budget caps how much note context is assembled for cross-note chat. Cloud/
adapter get a generous fixed budget; local/remote are sized to the model's
num_ctx so a smaller local window answers over fewer recent notes rather than
overflowing (WS3). Pure function — no notes or model needed.
"""

import unittest

from simple_recorder import _chat_corpus_char_budget
from src.summarizer import resolve_num_ctx


class ChatCorpusBudgetTests(unittest.TestCase):
    def test_cloud_and_adapter_use_the_generous_fixed_budget(self):
        self.assertEqual(_chat_corpus_char_budget("cloud", "gpt-4o"), 400_000)
        self.assertEqual(_chat_corpus_char_budget("adapter", "adapter (org)"), 400_000)

    def test_local_budget_is_derived_from_the_model_window(self):
        expected = int(resolve_num_ctx("gemma4:e2b-it-qat") * 3.5 * 0.55)
        self.assertEqual(_chat_corpus_char_budget("local", "gemma4:e2b-it-qat"), expected)

    def test_remote_is_sized_like_local(self):
        self.assertEqual(
            _chat_corpus_char_budget("remote", "gemma4:e2b-it-qat"),
            _chat_corpus_char_budget("local", "gemma4:e2b-it-qat"),
        )

    def test_local_budget_is_smaller_than_cloud(self):
        # The whole point: a local window must not be handed the cloud-sized
        # corpus, or it would overflow.
        local = _chat_corpus_char_budget("local", "gemma4:e2b-it-qat")
        cloud = _chat_corpus_char_budget("cloud", "gpt-4o")
        self.assertLess(local, cloud)
        self.assertGreater(local, 0)

    def test_unknown_local_model_still_gets_a_sane_budget(self):
        budget = _chat_corpus_char_budget("local", "some-future-model:7b")
        # Falls back to the default num_ctx → a positive, sub-cloud budget.
        self.assertGreater(budget, 0)
        self.assertLess(budget, 400_000)


if __name__ == "__main__":
    unittest.main()
