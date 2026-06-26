import unittest
from unittest import mock
from src.config import Config
from src.summarizer import OllamaSummarizer


def _s(model="llama3.2:3b"):
    return OllamaSummarizer(model_name=model, ai_provider="local", config=Config())


class TemplatePromptTests(unittest.TestCase):
    def test_prompt_embeds_template_instructions_and_transcript(self):
        s = _s()
        p = s._create_template_report_prompt("ALICE: hi BOB: ok",
                                             "Write a status update.", language="en")
        self.assertIn("Write a status update.", p)
        self.assertIn("ALICE: hi BOB: ok", p)

    def test_prompt_adds_language_instruction_when_pinned(self):
        s = _s()
        p = s._create_template_report_prompt("t", "Summarise.", language="de")
        self.assertIn("German", p)

    def test_prompt_no_language_instruction_for_auto(self):
        s = _s()
        p = s._create_template_report_prompt("t", "Summarise.", language="auto")
        self.assertNotIn("CRITICAL: Write", p)

    def test_streaming_with_template_uses_direct_path_and_template_prompt(self):
        s = _s()
        long_t = "Speaker: words.\n" * 4000  # would chunk on the summary path
        seen = {}

        def fake_chat(**kwargs):
            seen["content"] = kwargs["messages"][0]["content"]
            seen["think"] = kwargs.get("think")
            return iter([{"message": {"content": "## Status\nok\n"}}])

        with mock.patch.object(s, "_ensure_ollama_ready"):
            with mock.patch.object(s.client, "chat", side_effect=fake_chat) as mock_chat:
                out = "".join(s.summarize_transcript_streaming(
                    long_t, 0, "en", None, template_prompt="Write a status update."))
        # one direct chat call (NOT N+1 map-reduce), template prompt used, think disabled
        self.assertEqual(mock_chat.call_count, 1)
        self.assertIn("Write a status update.", seen["content"])
        self.assertIs(seen["think"], False)
        self.assertIn("## Status", out)

    def test_streaming_with_template_uses_active_cloud_provider_not_ollama(self):
        # Regression: the free-form template path must honour the active provider.
        # In cloud mode self.client (Ollama) is None, so routing a template report
        # through _stream_direct would crash. It must go through the cloud client.
        s = _s()
        s.ai_provider = "cloud"
        s.cloud_provider = "openai"
        s.client = None  # cloud mode has no Ollama client

        captured = {}

        class _Delta:
            def __init__(self, c):
                self.content = c

        class _Choice:
            def __init__(self, c):
                self.delta = _Delta(c)

        class _Chunk:
            def __init__(self, c):
                self.choices = [_Choice(c)]

        def fake_create(**kwargs):
            captured["content"] = kwargs["messages"][0]["content"]
            captured["stream"] = kwargs.get("stream")
            return iter([_Chunk("## Status\n"), _Chunk("ok\n")])

        s.cloud_client = mock.Mock()
        s.cloud_client.chat.completions.create.side_effect = fake_create

        # Patch _ensure_ollama_ready so the buggy (pre-fix) path fails fast on the
        # None client instead of trying to spin up Ollama in cloud mode.
        with mock.patch.object(s, "_ensure_ollama_ready"):
            out = "".join(s.summarize_transcript_streaming(
                "Speaker: hi.", 0, "en", None, template_prompt="Write a status update."))

        self.assertEqual(s.cloud_client.chat.completions.create.call_count, 1)
        self.assertIn("Write a status update.", captured["content"])
        self.assertTrue(captured["stream"])
        self.assertIn("## Status", out)


if __name__ == "__main__":
    unittest.main()
