"""Tests for the local-Ollama context cap (src/summarizer.py).

Small local models silently overrun their context on long transcripts and
summarise only the meeting's start. The cap applies ONLY to the bundled
local Ollama: cloud/remote/adapter providers must see the full transcript,
and only local chat calls get the num_ctx options hint.
"""

import unittest
from unittest.mock import MagicMock

from src.summarizer import (
    LOCAL_OLLAMA_NUM_CTX,
    LOCAL_TRANSCRIPT_CHAR_CAP,
    LOCAL_TRANSCRIPT_TRUNCATION_NOTE,
    OllamaSummarizer,
)


def _build_summarizer(ai_provider: str) -> OllamaSummarizer:
    # Bypass __init__ — it spins up Ollama / validates cloud keys. The
    # methods under test only need ai_provider (+ model/client for chat).
    s = OllamaSummarizer.__new__(OllamaSummarizer)
    s.ai_provider = ai_provider
    s.model_name = "test-model"
    s.client = MagicMock()
    # __del__ → cleanup() reads this; without it GC logs an AttributeError.
    s.ollama_process = None
    return s


def _long_transcript() -> str:
    head = "HEAD-MARKER " + ("alpha " * 4000)
    tail = ("omega " * 4000) + " TAIL-MARKER"
    assert len(head) + len(tail) > LOCAL_TRANSCRIPT_CHAR_CAP
    return head + tail


class CapTranscriptTests(unittest.TestCase):
    def test_local_long_transcript_truncated_with_marker_head_and_tail(self):
        s = _build_summarizer("local")
        out = s._cap_transcript_for_local(_long_transcript())
        self.assertLessEqual(
            len(out), LOCAL_TRANSCRIPT_CHAR_CAP + len(LOCAL_TRANSCRIPT_TRUNCATION_NOTE)
        )
        self.assertIn(LOCAL_TRANSCRIPT_TRUNCATION_NOTE, out)
        self.assertTrue(out.startswith("HEAD-MARKER"))
        self.assertTrue(out.endswith("TAIL-MARKER"))

    def test_local_short_transcript_unchanged(self):
        s = _build_summarizer("local")
        short = "a short meeting about nothing"
        self.assertEqual(s._cap_transcript_for_local(short), short)

    def test_cloud_remote_adapter_never_truncated(self):
        long = _long_transcript()
        for provider in ("cloud", "remote", "adapter"):
            s = _build_summarizer(provider)
            self.assertEqual(s._cap_transcript_for_local(long), long, provider)

    def test_empty_transcript_unchanged(self):
        s = _build_summarizer("local")
        self.assertEqual(s._cap_transcript_for_local(""), "")

    def test_markdown_prompt_builder_applies_cap_for_local(self):
        s = _build_summarizer("local")
        prompt = s._create_markdown_prompt(_long_transcript())
        self.assertIn(LOCAL_TRANSCRIPT_TRUNCATION_NOTE, prompt)

    def test_permissive_prompt_builder_applies_cap_for_local(self):
        s = _build_summarizer("local")
        prompt = s._create_permissive_prompt(_long_transcript())
        self.assertIn(LOCAL_TRANSCRIPT_TRUNCATION_NOTE, prompt)

    def test_markdown_prompt_builder_leaves_cloud_alone(self):
        s = _build_summarizer("cloud")
        prompt = s._create_markdown_prompt(_long_transcript())
        self.assertNotIn(LOCAL_TRANSCRIPT_TRUNCATION_NOTE, prompt)
        self.assertIn("TAIL-MARKER", prompt)


class NumCtxOptionsTests(unittest.TestCase):
    def test_local_chat_options_carry_num_ctx(self):
        s = _build_summarizer("local")
        self.assertEqual(s._local_chat_options(), {"num_ctx": LOCAL_OLLAMA_NUM_CTX})

    def test_non_local_chat_options_are_none(self):
        for provider in ("cloud", "remote", "adapter"):
            s = _build_summarizer(provider)
            self.assertIsNone(s._local_chat_options(), provider)

    def test_streaming_chat_passes_num_ctx_for_local(self):
        s = _build_summarizer("local")
        s._ensure_ollama_ready = MagicMock()
        s.client.chat.return_value = iter(
            [{"message": {"content": "chunk"}}]
        )
        chunks = list(s.summarize_transcript_streaming("short transcript"))
        self.assertEqual(chunks, ["chunk"])
        kwargs = s.client.chat.call_args.kwargs
        self.assertEqual(kwargs.get("options"), {"num_ctx": LOCAL_OLLAMA_NUM_CTX})

    def test_streaming_chat_omits_num_ctx_for_remote(self):
        s = _build_summarizer("remote")
        s.client.chat.return_value = iter(
            [{"message": {"content": "chunk"}}]
        )
        list(s.summarize_transcript_streaming("short transcript"))
        kwargs = s.client.chat.call_args.kwargs
        self.assertIsNone(kwargs.get("options"))


if __name__ == "__main__":
    unittest.main()
