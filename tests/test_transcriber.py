"""Tests for the Parakeet-backed batch transcriber.

The whisper.cpp auto-language-detect tests this file used to carry are
gone — Parakeet TDT v3 is multilingual at inference time and doesn't
expose a detect-then-transcribe split, so those code paths no longer
exist. The hallucination-filter tests are also gone — Parakeet returns
empty on silence and noise (no canned "Thank you." closers like
whisper.cpp had), so the filter that briefly lived here would now
strictly drop real speech without preventing anything.
"""

import unittest
from pathlib import Path
from unittest.mock import patch

from src.transcriber import WhisperTranscriber


class WhisperTranscriberShimTests(unittest.TestCase):
    """The class name is kept from the whisper era for back-compat; the
    internals are now a thin shim over ``src.parakeet.transcribe_file``."""

    def _build_transcriber(self) -> WhisperTranscriber:
        # Bypass __init__ to skip ffmpeg-PATH probing and the parakeet
        # import-availability gate — both are tested separately and
        # would add filesystem dependencies to these unit tests.
        transcriber = WhisperTranscriber.__new__(WhisperTranscriber)
        transcriber.model = None
        transcriber.model_size = "small"
        transcriber.backend = "parakeet-tdt-v3"
        return transcriber

    def test_run_parakeet_passes_concrete_language_through(self):
        transcriber = self._build_transcriber()
        fake_result = {
            "text": "Hello team.",
            "segments": [{"text": "Hello team.", "start": 0.0, "end": 1.5}],
            "duration_seconds": 1.5,
            "detected_language": "en",
            "detected_language_probability": None,
        }
        with patch("src.transcriber._parakeet_transcribe_file",
                   return_value=fake_result) as mock_call:
            out = transcriber._run_parakeet(Path("/tmp/nope.wav"), language="en")
        self.assertEqual(mock_call.call_args.kwargs["language"], "en")
        self.assertEqual(out["text"], "Hello team.")
        self.assertEqual(out["detected_language"], "en")

    def test_run_parakeet_auto_language_becomes_none(self):
        """"auto" means "let Parakeet decide" — we translate to None when
        calling, since parakeet doesn't expose a detect-only mode."""
        transcriber = self._build_transcriber()
        fake_result = {
            "text": "Hello.",
            "segments": [{"text": "Hello.", "start": 0.0, "end": 1.0}],
            "duration_seconds": 1.0,
            "detected_language": None,
            "detected_language_probability": None,
        }
        with patch("src.transcriber._parakeet_transcribe_file",
                   return_value=fake_result) as mock_call:
            transcriber._run_parakeet(Path("/tmp/nope.wav"), language="auto")
        self.assertIsNone(mock_call.call_args.kwargs["language"])

    def test_run_parakeet_returns_empty_when_model_returns_nothing(self):
        """Parakeet returns text=None and segments=[] when there's no speech
        (verified empirically on silence + noise). The shim should pass
        that straight through so the summariser sees "no content"."""
        transcriber = self._build_transcriber()
        fake_result = {
            "text": None,
            "segments": [],
            "duration_seconds": None,
            "detected_language": None,
            "detected_language_probability": None,
        }
        with patch("src.transcriber._parakeet_transcribe_file",
                   return_value=fake_result):
            out = transcriber._run_parakeet(Path("/tmp/nope.wav"), language="en")
        self.assertIsNone(out["text"])
        self.assertEqual(out["segments"], [])

    def test_run_parakeet_preserves_real_text_verbatim(self):
        """Things that look like whisper-era hallucinations ("Thank you.")
        but came out of Parakeet are real speech — the model only emits
        them when it actually heard them. Make sure we don't filter.
        """
        transcriber = self._build_transcriber()
        fake_result = {
            "text": "Thank you.",
            "segments": [{"text": "Thank you.", "start": 0.0, "end": 1.2}],
            "duration_seconds": 1.2,
            "detected_language": None,
            "detected_language_probability": None,
        }
        with patch("src.transcriber._parakeet_transcribe_file",
                   return_value=fake_result):
            out = transcriber._run_parakeet(Path("/tmp/nope.wav"), language="en")
        self.assertEqual(out["text"], "Thank you.")
        self.assertEqual([s["text"] for s in out["segments"]], ["Thank you."])

    def test_change_model_is_a_noop_but_records_request(self):
        """The whisper-era ``change_model`` API is kept for back-compat
        with code that still calls it; Parakeet has one model so the
        method just logs and updates the recorded ``model_size``."""
        transcriber = self._build_transcriber()
        self.assertTrue(transcriber.change_model("medium"))
        self.assertEqual(transcriber.model_size, "medium")

    def test_get_backend_info_reports_parakeet(self):
        transcriber = self._build_transcriber()
        info = transcriber.get_backend_info()
        self.assertEqual(info["backend"], "parakeet-tdt-v3")
        self.assertTrue(info["parakeet_available"])
        # Legacy keys retained for code that hasn't migrated yet —
        # both are now always False.
        self.assertFalse(info["whisper_cpp_available"])
        self.assertFalse(info["openai_whisper_available"])


if __name__ == "__main__":
    unittest.main()
