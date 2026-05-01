import unittest

from src.summarizer import _strip_reasoning_tags, _strip_reasoning_tags_streaming


class StripReasoningTagsTests(unittest.TestCase):
    def test_passthrough_when_no_tags(self):
        self.assertEqual(_strip_reasoning_tags("plain summary"), "plain summary")

    def test_strips_single_block(self):
        self.assertEqual(
            _strip_reasoning_tags("<think>reasoning</think>final"),
            "final",
        )

    def test_strips_multiline_block(self):
        text = "<think>line one\nline two\n  more</think>\n# Summary\nbody"
        self.assertEqual(_strip_reasoning_tags(text), "# Summary\nbody")

    def test_strips_multiple_blocks(self):
        text = "<think>a</think>middle<think>b</think>end"
        self.assertEqual(_strip_reasoning_tags(text), "middleend")

    def test_drops_unclosed_trailing_block(self):
        # Truncated reasoning — drop everything from <think> onwards.
        text = "good content<think>reasoning that never closes"
        self.assertEqual(_strip_reasoning_tags(text), "good content")

    def test_handles_json_inside_thinking(self):
        # The exact failure mode caught on the gov mac: model emits a
        # draft JSON inside <think>, then the real JSON. Old extractor
        # spanned both and produced malformed JSON.
        text = '<think>let me draft: { "draft": true } no, revise</think>{"final": true}'
        self.assertEqual(_strip_reasoning_tags(text), '{"final": true}')


class StripReasoningTagsStreamingTests(unittest.TestCase):
    def _join(self, chunks):
        return "".join(_strip_reasoning_tags_streaming(iter(chunks)))

    def test_passthrough_when_no_tags(self):
        self.assertEqual(self._join(["hello ", "world"]), "hello world")

    def test_full_block_in_one_chunk(self):
        self.assertEqual(
            self._join(["<think>reasoning</think>final"]),
            "final",
        )

    def test_block_split_across_chunks(self):
        # Tags themselves are split across chunk boundaries.
        chunks = ["<thi", "nk>some ", "reasoning</thi", "nk>", "answer"]
        self.assertEqual(self._join(chunks), "answer")

    def test_partial_open_tag_at_chunk_end(self):
        # Last char of a chunk is "<" — could become "<think>" or could
        # just be a literal < in markdown. We must hold it back until
        # we know which.
        chunks = ["good <", "think>hidden</think>visible"]
        self.assertEqual(self._join(chunks), "good visible")

    def test_literal_lt_not_swallowed(self):
        # If "<" never extends into "<think>", we must eventually flush it.
        chunks = ["x < y"]
        self.assertEqual(self._join(chunks), "x < y")

    def test_unclosed_trailing_block_dropped(self):
        # Stream ends mid-thinking — drop the partial reasoning, don't
        # leak it to the user.
        chunks = ["good ", "<think>truncated"]
        self.assertEqual(self._join(chunks), "good ")

    def test_multiple_blocks_in_stream(self):
        chunks = ["A<think>x</think>B<think>y</think>C"]
        self.assertEqual(self._join(chunks), "ABC")

    def test_realistic_deepseek_summary(self):
        # Approximates what DeepSeek-R1 actually emits via the HF mirror:
        # an extensive reasoning block, then the markdown summary.
        chunks = [
            "<think>\n",
            "The user wants a meeting summary. Let me identify ",
            "the key points...\n",
            "Action items: 1. follow up\n",
            "</think>\n",
            "# Meeting summary\n\n",
            "**Key points:**\n",
            "- Decision A\n",
        ]
        result = self._join(chunks)
        self.assertNotIn("<think>", result)
        self.assertNotIn("Action items", result)
        self.assertIn("# Meeting summary", result)
        self.assertIn("Decision A", result)


if __name__ == "__main__":
    unittest.main()
