"""Tests for OllamaSummarizer.generate_title response cleanup.

Reasoning models (e.g. deepseek-r1) frequently ignore the "just the title"
instruction and wrap the answer in a <think> block, a "TITLE:" label line, or
markdown emphasis. Those wrappers used to leak into the saved meeting title
(e.g. "**Reissuing after Completion**") or collapse it to nothing, silently
leaving the placeholder name. These tests pin the cleanup + the now-visible
empty-title path. Pure — the model call is mocked, no Ollama required.
"""

import unittest
from unittest import mock

import ollama

from src.summarizer import OllamaSummarizer


def _title_from(raw: str):
    """Run generate_title with the model returning ``raw``, everything else stubbed."""
    s = OllamaSummarizer.__new__(OllamaSummarizer)  # bypass __init__/Ollama boot
    s.ai_provider = "local"
    s.model_name = "deepseek-r1:8b"
    s.remote_url = None
    s.ollama_process = None  # let __del__/cleanup no-op quietly (we bypassed __init__)
    with mock.patch.object(s, "_chat_no_think", return_value={"message": {"content": raw}}), \
            mock.patch.object(s, "_ollama_options", return_value={}), \
            mock.patch.object(s, "_ensure_ollama_ready", return_value=None), \
            mock.patch.object(ollama, "Client", return_value=object()):
        return s.generate_title("A summary about the topic.", "transcript text", language="en")


class GenerateTitleCleanupTests(unittest.TestCase):
    def test_strips_surrounding_bold(self):
        self.assertEqual(_title_from("**Reissuing after Completion**"), "Reissuing after Completion")

    def test_strips_bold_with_leading_newline(self):
        self.assertEqual(_title_from("\n**Border Security Meeting**"), "Border Security Meeting")

    def test_strips_think_block_and_keeps_title(self):
        raw = "<think>What should I call this? It's about onboarding.</think>\nProject Onboarding Plan"
        self.assertEqual(_title_from(raw), "Project Onboarding Plan")

    def test_title_label_on_its_own_line(self):
        self.assertEqual(
            _title_from("\nTITLE:\nBorder Control and Retreat Decision"),
            "Border Control and Retreat Decision",
        )

    def test_strips_backticks_and_heading(self):
        self.assertEqual(_title_from("`Quarterly Roadmap Review`"), "Quarterly Roadmap Review")
        self.assertEqual(_title_from("## Team Sync Notes"), "Team Sync Notes")

    def test_plain_title_passes_through(self):
        self.assertEqual(_title_from("Border Security & Retreat Discussion"),
                         "Border Security & Retreat Discussion")

    def test_caps_at_six_words(self):
        self.assertEqual(
            _title_from("One Two Three Four Five Six Seven Eight"),
            "One Two Three Four Five Six",
        )

    def test_empty_response_returns_none(self):
        self.assertIsNone(_title_from("\n\n"))

    def test_reasoning_only_response_returns_none(self):
        self.assertIsNone(_title_from("<think>no clear topic here</think>"))

    def test_empty_title_is_logged_not_silent(self):
        # The empty path must leave a trace (content-free) so a stuck placeholder
        # name is diagnosable instead of vanishing silently.
        with self.assertLogs("src.summarizer", level="WARNING") as cm:
            self.assertIsNone(_title_from(""))
        self.assertTrue(any("no usable title" in line for line in cm.output))


if __name__ == "__main__":
    unittest.main()
