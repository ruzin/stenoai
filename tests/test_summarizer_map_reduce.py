"""Unit tests for map-reduce summarization helpers in OllamaSummarizer."""

import unittest
from unittest import mock

from src.config import Config
from src.summarizer import OllamaSummarizer, MAP_PROMPT_OVERHEAD_TOKENS, MAP_OUTPUT_MAX_TOKENS, CHARS_PER_TOKEN


def _make_summarizer(model_name="llama3.2:3b"):
    cfg = Config()
    return OllamaSummarizer(model_name=model_name, ai_provider="local", config=cfg)


class ChunkBudgetTests(unittest.TestCase):
    def test_budget_uses_fixed_caps_not_ratio(self):
        s = _make_summarizer("llama3.2:3b")  # num_ctx = 8192
        # content_tokens = 8192 - 300 - 600 = 7292; budget = 7292 * 4 = 29168
        self.assertEqual(s._chunk_budget_chars(), 7292 * 4)

    def test_budget_scales_with_model_context(self):
        s_small = _make_summarizer("llama3.2:3b")   # 8192
        s_large = _make_summarizer("gemma4:e2b-it-qat")  # 32768
        self.assertLess(s_small._chunk_budget_chars(), s_large._chunk_budget_chars())


class SplitIntoChunksTests(unittest.TestCase):
    def test_short_transcript_returns_single_chunk(self):
        s = _make_summarizer()
        budget = s._chunk_budget_chars()
        transcript = "Speaker A: hello world.\n" * 10
        # Definitely shorter than budget
        self.assertLess(len(transcript), budget)
        chunks = s._split_into_chunks(transcript)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0], transcript)

    def test_each_chunk_fits_within_budget(self):
        s = _make_summarizer()
        budget = s._chunk_budget_chars()
        overlap_chars = int(budget * 0.05)
        content_budget = budget - overlap_chars
        # Build transcript 3x content_budget → guaranteed 3+ chunks
        line = "Speaker A: some words here.\n"
        n = (content_budget * 3) // len(line) + 1
        transcript = line * n
        chunks = s._split_into_chunks(transcript)
        self.assertGreater(len(chunks), 1)
        for i, chunk in enumerate(chunks):
            self.assertLessEqual(
                len(chunk), budget,
                msg=f"chunk {i} of {len(chunks)} has {len(chunk)} chars > budget {budget}",
            )

    def test_overlap_prefix_from_previous_chunk(self):
        s = _make_summarizer()
        budget = s._chunk_budget_chars()
        overlap_chars = int(budget * 0.05)
        content_budget = budget - overlap_chars
        # Make a transcript large enough for exactly 2 raw chunks
        line = "x" * 80 + "\n"
        n = (content_budget // len(line)) + 5
        transcript = line * n
        chunks = s._split_into_chunks(transcript)
        self.assertGreaterEqual(len(chunks), 2, "need at least 2 chunks to test overlap")
        # chunk[1] must start with the tail of chunk[0]
        tail = chunks[0][-overlap_chars:]
        self.assertTrue(
            chunks[1].startswith(tail),
            msg=f"chunk[1] does not start with last {overlap_chars} chars of chunk[0]",
        )

    def test_no_data_lost_across_chunks(self):
        s = _make_summarizer()
        budget = s._chunk_budget_chars()
        overlap_chars = int(budget * 0.05)
        content_budget = budget - overlap_chars
        # Each line has a unique number so we can check coverage
        line = "Speaker A: line {i}.\n"
        n = (content_budget * 2) // len(line.format(i=9999)) + 1
        lines = [line.format(i=i) for i in range(n)]
        transcript = "".join(lines)
        chunks = s._split_into_chunks(transcript)
        combined = " ".join(chunks)
        for i, ln in enumerate(lines):
            self.assertIn(ln.strip(), combined, msg=f"line {i} not found in any chunk")


if __name__ == "__main__":
    unittest.main()
