"""Tests for the OpenAI chat-model filter used by `test-cloud-api` (#198).

OpenAI's /models endpoint returns ~50+ models in arbitrary order, mixing chat
models in with embeddings, speech, image and moderation models. The Settings
model picker should only offer models that actually answer chat completions, so
`_is_openai_chat_model` gates the list. These tests pin the keep/drop decisions
(the substance of the fix) without making a network call.
"""

import unittest

from simple_recorder import _is_openai_chat_model


class OpenAIChatModelFilterTests(unittest.TestCase):
    def test_keeps_chat_and_reasoning_families(self):
        for model_id in [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4.1",
            "gpt-4-turbo",
            "gpt-3.5-turbo",
            "chatgpt-4o-latest",
            "o1",
            "o1-mini",
            "o3",
            "o3-mini",
            "o4-mini",
            # web-search-grounded chat models — served via chat completions, so
            # the "search" substring must NOT exclude them (#198 follow-up).
            "gpt-4o-search-preview",
            "gpt-4o-mini-search-preview",
            # deep-research reasoning models pass the o\\d gate; "research"
            # contains "search", so they must not be excluded either.
            "o3-deep-research",
            "o4-mini-deep-research",
        ]:
            self.assertTrue(_is_openai_chat_model(model_id), msg=model_id)

    def test_drops_non_chat_families(self):
        for model_id in [
            "text-embedding-3-large",
            "whisper-1",
            "tts-1",
            "tts-1-hd",
            "dall-e-3",
            "gpt-image-1",
            "gpt-4o-audio-preview",
            "gpt-4o-realtime-preview",
            "gpt-4o-transcribe",
            "omni-moderation-latest",
            "babbage-002",
            "davinci-002",
        ]:
            self.assertFalse(_is_openai_chat_model(model_id), msg=model_id)

    def test_future_gpt_and_o_series_pass_without_a_code_change(self):
        # `gpt-` is a prefix match and the reasoning series is `o\d`, so models
        # that don't exist yet still surface — the whole point of #198.
        for model_id in ["gpt-5", "gpt-6-mini", "o5", "o9-pro"]:
            self.assertTrue(_is_openai_chat_model(model_id), msg=model_id)

    def test_case_insensitive(self):
        self.assertTrue(_is_openai_chat_model("GPT-4O"))
        self.assertFalse(_is_openai_chat_model("Whisper-1"))


if __name__ == "__main__":
    unittest.main()
