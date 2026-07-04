"""Privacy regression: the summarizer's diagnostic log lines must emit
lengths/counts, not meeting-derived content.

These lines reach the shareable debug console (Settings > Developer) and the
on-disk processing.log, so a leaked title or question would end up in any log a
user pastes into Discord/GitHub. See
docs/superpowers/specs/2026-07-04-diagnostics-privacy-design.md (PR1).
"""

import unittest
from unittest import mock

from src.config import Config
from src.summarizer import OllamaSummarizer


def _make_summarizer(model_name="llama3.2:3b", ai_provider="local"):
    return OllamaSummarizer(model_name=model_name, ai_provider=ai_provider, config=Config())


class TitleLoggingPrivacyTests(unittest.TestCase):
    def test_generated_title_logs_length_not_text(self):
        s = _make_summarizer()
        title_text = "Confidential Board Compensation"
        with mock.patch.object(
            s, "_chat_no_think", return_value={"message": {"content": title_text}}
        ):
            with self.assertLogs("src.summarizer", level="INFO") as cm:
                out = s.generate_title(summary="Some meeting summary text", transcript="")
        self.assertEqual(out, title_text)
        joined = "\n".join(cm.output)
        self.assertIn(f"Generated meeting title ({len(title_text)} chars)", joined)
        self.assertNotIn(title_text, joined)


class QueryLoggingPrivacyTests(unittest.TestCase):
    def test_query_logs_question_length_not_text(self):
        s = _make_summarizer()
        question = "What did we decide about the confidential acquisition price?"
        s.client = mock.Mock()
        s.client.chat.return_value = {"message": {"content": "An answer."}}
        with self.assertLogs("src.summarizer", level="INFO") as cm:
            s.query_transcript(transcript="Speaker A: hello.", question=question)
        joined = "\n".join(cm.output)
        self.assertIn(f"Querying transcript with question ({len(question)} chars)", joined)
        self.assertNotIn(question, joined)


class _FakeStreamResponse:
    """Minimal stand-in for the urlopen() context manager: a context manager
    that iterates the raw NDJSON byte lines the adapter would stream."""

    def __init__(self, lines):
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter(self._lines)


class AdapterStreamLoggingPrivacyTests(unittest.TestCase):
    def test_malformed_ndjson_logs_length_not_content(self):
        s = _make_summarizer()
        s.adapter_url = "http://adapter.test"
        s.adapter_token = "token"
        secret = "not-json but definitely CONFIDENTIAL response body content"
        lines = [
            b'{"type": "chunk", "text": "hi"}\n',
            (secret + "\n").encode("utf-8"),
            b'{"type": "done"}\n',
        ]
        with mock.patch("urllib.request.urlopen", return_value=_FakeStreamResponse(lines)):
            with self.assertLogs("src.summarizer", level="WARNING") as cm:
                list(s._adapter_stream("prompt"))
        joined = "\n".join(cm.output)
        self.assertIn(f"malformed NDJSON line dropped ({len(secret)} chars)", joined)
        self.assertNotIn(secret, joined)
        self.assertNotIn("CONFIDENTIAL", joined)


if __name__ == "__main__":
    unittest.main()
