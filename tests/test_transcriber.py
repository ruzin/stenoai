import unittest
from pathlib import Path
from unittest.mock import Mock

from src.transcriber import WhisperTranscriber


class WhisperTranscriberAutoLanguageTests(unittest.TestCase):
    def _build_transcriber(self, model: Mock) -> WhisperTranscriber:
        audio_path = Path("/tmp/stenoai-test.wav")
        transcriber = WhisperTranscriber.__new__(WhisperTranscriber)
        transcriber.model = model
        transcriber.backend = "whisper.cpp"
        transcriber._convert_to_16khz = Mock(return_value=(audio_path, 12.3))
        return transcriber

    def test_auto_mode_uses_detected_language(self):
        model = Mock()
        model.auto_detect_language.return_value = (("nl", 0.97), {"nl": 0.97})
        segment = Mock()
        segment.text = " Hallo "
        model.transcribe.return_value = [segment]

        transcriber = self._build_transcriber(model)
        result = transcriber._transcribe_whisper_cpp(Path("/tmp/stenoai-test.wav"), language="auto")

        self.assertEqual(result["text"], "Hallo")
        self.assertEqual(result["detected_language"], "nl")
        self.assertEqual(model.transcribe.call_args.kwargs.get("language"), "nl")

    def test_auto_mode_falls_back_when_detection_fails(self):
        model = Mock()
        model.auto_detect_language.side_effect = RuntimeError("detection failed")
        segment = Mock()
        segment.text = " Hello "
        model.transcribe.return_value = [segment]

        transcriber = self._build_transcriber(model)
        result = transcriber._transcribe_whisper_cpp(Path("/tmp/stenoai-test.wav"), language="auto")

        self.assertEqual(result["text"], "Hello")
        self.assertIsNone(result["detected_language"])
        self.assertNotIn("language", model.transcribe.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
