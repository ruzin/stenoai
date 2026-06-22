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


class MapCallTests(unittest.TestCase):
    def test_map_prompt_contains_chunk_position(self):
        s = _make_summarizer()
        prompt = s._create_map_prompt("hello world", 2, 5)
        self.assertIn("part 2 of 5", prompt)
        self.assertIn("hello world", prompt)

    def test_map_prompt_contains_extraction_structure(self):
        s = _make_summarizer()
        prompt = s._create_map_prompt("some text", 1, 3)
        self.assertIn("KEY POINTS", prompt)
        self.assertIn("ACTION ITEMS", prompt)
        self.assertIn("TRANSCRIPT SEGMENT:", prompt)

    def test_summarize_chunk_raises_on_empty_llm_response(self):
        s = _make_summarizer()
        with mock.patch.object(s, '_ensure_ollama_ready'):
            with mock.patch.object(s.client, 'chat', return_value={"message": {"content": ""}}):
                with self.assertRaises(ValueError) as ctx:
                    s._summarize_chunk("some content", 1, 3)
        self.assertIn("empty", str(ctx.exception).lower())

    def test_summarize_chunk_returns_stripped_content(self):
        s = _make_summarizer()
        fake_response = {"message": {"content": "  KEY POINTS\n- item\n"}}
        with mock.patch.object(s, '_ensure_ollama_ready'):
            with mock.patch.object(s.client, 'chat', return_value=fake_response):
                result = s._summarize_chunk("some content", 1, 3)
        self.assertEqual(result, "KEY POINTS\n- item")

    def test_summarize_chunk_passes_num_predict_option(self):
        s = _make_summarizer()
        fake_response = {"message": {"content": "some result"}}
        with mock.patch.object(s, '_ensure_ollama_ready'):
            with mock.patch.object(s.client, 'chat', return_value=fake_response) as mock_chat:
                s._summarize_chunk("content", 1, 1)
        call_kwargs = mock_chat.call_args
        options = call_kwargs[1].get('options') or (call_kwargs[0][2] if len(call_kwargs[0]) > 2 else {})
        # Extract options from however it was called
        all_kwargs = mock_chat.call_args.kwargs if mock_chat.call_args.kwargs else {}
        if not all_kwargs:
            all_kwargs = dict(zip(['model', 'messages', 'stream', 'options'], mock_chat.call_args.args))
        self.assertEqual(all_kwargs.get('options', {}).get('num_predict'), 600)

    def test_summarize_chunk_uses_non_streaming(self):
        s = _make_summarizer()
        fake_response = {"message": {"content": "result"}}
        with mock.patch.object(s, '_ensure_ollama_ready'):
            with mock.patch.object(s.client, 'chat', return_value=fake_response) as mock_chat:
                s._summarize_chunk("content", 1, 1)
        call_kwargs = mock_chat.call_args.kwargs if mock_chat.call_args.kwargs else {}
        if not call_kwargs:
            call_kwargs = dict(zip(['model', 'messages', 'stream', 'options'], mock_chat.call_args.args))
        self.assertIs(call_kwargs.get('stream'), False)


class ReducePromptTests(unittest.TestCase):
    def test_reduce_prompt_contains_chunk_headers(self):
        s = _make_summarizer()
        results = ["KEY POINTS\n- item A", "KEY POINTS\n- item B"]
        prompt = s._create_reduce_prompt(results)
        self.assertIn("CHUNK 1 OF 2", prompt)
        self.assertIn("CHUNK 2 OF 2", prompt)
        self.assertIn("item A", prompt)
        self.assertIn("item B", prompt)

    def test_reduce_prompt_instructs_markdown_output(self):
        s = _make_summarizer()
        prompt = s._create_reduce_prompt(["result"])
        self.assertIn("## Summary", prompt)
        self.assertIn("## Key Topics", prompt)
        self.assertIn("## Key Points", prompt)
        self.assertIn("## Action Items", prompt)

    def test_reduce_prompt_includes_notes_when_provided(self):
        s = _make_summarizer()
        prompt = s._create_reduce_prompt(["result"], notes="bring coffee")
        self.assertIn("bring coffee", prompt)
        self.assertIn("USER NOTES", prompt)

    def test_reduce_prompt_no_notes_section_when_empty(self):
        s = _make_summarizer()
        prompt = s._create_reduce_prompt(["result"], notes=None)
        self.assertNotIn("USER NOTES", prompt)

    def test_reduce_prompt_does_not_say_summarise_this_transcript(self):
        # Regression guard: the reduce step must NOT reuse _create_markdown_prompt's
        # opening "Summarise this meeting transcript" because the input is already
        # extracted bullet lists, not raw speech.
        s = _make_summarizer()
        prompt = s._create_reduce_prompt(["result"])
        self.assertNotIn("Summarise this meeting transcript", prompt)
        self.assertNotIn("TRANSCRIPT:\n", prompt)


if __name__ == "__main__":
    unittest.main()
