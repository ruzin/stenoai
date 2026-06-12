"""Tests for the local-Ollama context cap (src/summarizer.py).

Small local models silently overrun their context on long transcripts and
summarise only the meeting's start. The cap applies ONLY to the bundled
local Ollama: cloud/remote/adapter providers must see the full transcript,
and only local chat calls get the num_ctx options hint.
"""

import unittest
import unittest.mock
from unittest.mock import MagicMock

from src.summarizer import (
    LOCAL_OLLAMA_NUM_CTX,
    LOCAL_TRANSCRIPT_CHAR_CAP,
    LOCAL_TRANSCRIPT_TRUNCATION_NOTE,
    LOCAL_TRUNCATION_USER_NOTE,
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


class DeterministicUserNoteTests(unittest.TestCase):
    """The user-facing truncation note is appended deterministically to the
    streamed summary — never trusted to the model to echo the in-prompt
    gap marker."""

    def _stream(self, s, transcript):
        s._ensure_ollama_ready = MagicMock()
        s.client.chat.return_value = iter([{"message": {"content": "summary text"}}])
        return list(s.summarize_transcript_streaming(transcript))

    def test_note_appended_when_local_and_truncated(self):
        s = _build_summarizer("local")
        chunks = self._stream(s, _long_transcript())
        self.assertEqual(chunks[-1], LOCAL_TRUNCATION_USER_NOTE)

    def test_no_note_when_local_and_short(self):
        s = _build_summarizer("local")
        chunks = self._stream(s, "short transcript")
        self.assertNotIn(LOCAL_TRUNCATION_USER_NOTE, chunks)

    def test_no_note_when_stream_yielded_nothing(self):
        # A failed/empty stream must not produce a summary consisting of
        # only the truncation note.
        s = _build_summarizer("local")
        s._ensure_ollama_ready = MagicMock()
        s.client.chat.return_value = iter([])
        chunks = list(s.summarize_transcript_streaming(_long_transcript()))
        self.assertEqual(chunks, [])

    def test_no_note_for_remote(self):
        s = _build_summarizer("remote")
        chunks = self._stream(s, _long_transcript())
        self.assertNotIn(LOCAL_TRUNCATION_USER_NOTE, chunks)


class QueryPathContextTests(unittest.TestCase):
    """The query/chat path gets the same local-context discipline as the
    summary path: capped prompt + num_ctx options for local only."""

    def test_query_prompt_caps_for_local(self):
        s = _build_summarizer("local")
        prompt = s._build_query_prompt(_long_transcript(), "what happened?")
        self.assertIn(LOCAL_TRANSCRIPT_TRUNCATION_NOTE, prompt)

    def test_query_prompt_full_for_cloud(self):
        s = _build_summarizer("cloud")
        prompt = s._build_query_prompt(_long_transcript(), "what happened?")
        self.assertNotIn(LOCAL_TRANSCRIPT_TRUNCATION_NOTE, prompt)
        self.assertIn("TAIL-MARKER", prompt)

    def test_streaming_query_passes_num_ctx_for_local(self):
        import src.summarizer as summarizer_mod
        s = _build_summarizer("local")
        s._ensure_ollama_ready = MagicMock()
        fake_client = MagicMock()
        fake_client.chat.return_value = iter([{"message": {"content": "answer"}}])
        with unittest.mock.patch.object(
            summarizer_mod.ollama, "Client", return_value=fake_client
        ):
            chunks = list(s.query_transcript_streaming("a transcript", "q?"))
        self.assertEqual(chunks, ["answer"])
        kwargs = fake_client.chat.call_args.kwargs
        self.assertEqual(kwargs.get("options"), {"num_ctx": LOCAL_OLLAMA_NUM_CTX})

    def test_nonstreaming_query_passes_num_ctx_for_local(self):
        s = _build_summarizer("local")
        s._ensure_ollama_ready = MagicMock()
        s.client.chat.return_value = {"message": {"content": "answer"}}
        out = s.query_transcript("a transcript", "q?")
        self.assertEqual(out, "answer")
        kwargs = s.client.chat.call_args.kwargs
        self.assertEqual(kwargs.get("options"), {"num_ctx": LOCAL_OLLAMA_NUM_CTX})


if __name__ == "__main__":
    unittest.main()
