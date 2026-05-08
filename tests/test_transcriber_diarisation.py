"""Tests for the diarisation-related helpers added in the system-audio branch.

Covers:
 - `_token_jaccard`: similarity should cleanly separate "true bleed"
   transcripts (identical or near-identical) from real two-party content.
 - `_parse_channels_from_ffmpeg_stderr` / `_parse_duration_from_ffmpeg_stderr`:
   regex parsers against representative ffmpeg `-i` stderr fixtures.
 - `_check_rms_energy`: scans the whole file (not just the first 5 seconds)
   so a recording where speech starts mid-stream isn't classified as silent.
"""

import math
import struct
import tempfile
import unittest
import wave
from pathlib import Path

from src.transcriber import (
    BLEED_JACCARD_THRESHOLD,
    MIN_RMS_THRESHOLD,
    WhisperTranscriber,
    _parse_channels_from_ffmpeg_stderr,
    _parse_duration_from_ffmpeg_stderr,
    _token_jaccard,
)


class TokenJaccardTests(unittest.TestCase):
    def test_identical_strings_score_one(self):
        self.assertEqual(_token_jaccard("hello world", "hello world"), 1.0)

    def test_disjoint_strings_score_zero(self):
        self.assertEqual(
            _token_jaccard("hi can you hear me", "trump has said many outrageous things"),
            0.0,
        )

    def test_empty_inputs_return_zero(self):
        self.assertEqual(_token_jaccard("", "anything"), 0.0)
        self.assertEqual(_token_jaccard("anything", ""), 0.0)
        self.assertEqual(_token_jaccard("", ""), 0.0)

    def test_case_and_whitespace_insensitive(self):
        self.assertEqual(
            _token_jaccard("Hello, World!", "hello world"),
            1.0,
        )

    def test_real_bleed_sample_crosses_threshold(self):
        # Lifted from the actual recording that triggered this fix: the
        # mic captures the user plus YouTube echo, the system loopback
        # captures the same YouTube cleanly. Sets share most words.
        mic = (
            "popping up I think it was originally Alexandria of liberal groups "
            "liberal opponents to the Muslim Brother liberal secular Egyptians "
            "we opposed the Morsi government as much as we opposed the Mubarak"
        )
        system = (
            "popping up I think it was originally Alexandria of liberal groups "
            "liberal opponents to the Muslim Brother liberal secular Egyptians "
            "We opposed the Morsi government as much as we opposed the Mubarak"
        )
        similarity = _token_jaccard(mic, system)
        self.assertGreaterEqual(similarity, BLEED_JACCARD_THRESHOLD)

    def test_real_two_party_sample_below_threshold(self):
        mic = "hi can you hear me okay let me share my screen now"
        system = "yes I can hear you fine please go ahead with the demo"
        similarity = _token_jaccard(mic, system)
        self.assertLess(similarity, BLEED_JACCARD_THRESHOLD)


class FfmpegStderrParseTests(unittest.TestCase):
    STEREO_OPUS = """\
Input #0, matroska,webm, from '/tmp/sample.webm':
  Metadata:
    encoder         : Chrome
  Duration: 00:00:28.62, start: -0.007000, bitrate: 128 kb/s
  Stream #0:0(eng): Audio: opus, 48000 Hz, stereo, fltp (default)
"""

    MONO_WAV = """\
Input #0, wav, from '/tmp/sample.wav':
  Duration: 00:01:05.40, bitrate: 256 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 16000 Hz, mono, s16, 256 kb/s
"""

    SIX_CHANNEL = """\
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/sample.m4a':
  Duration: 02:34:12.10, start: 0.000000, bitrate: 384 kb/s
  Stream #0:0: Audio: aac (LC), 48000 Hz, 6 channels, fltp, 384 kb/s
"""

    GIBBERISH = "ffmpeg version 7.1.1\nbuilt with Apple clang...\n"

    def test_parses_stereo(self):
        self.assertEqual(_parse_channels_from_ffmpeg_stderr(self.STEREO_OPUS), 2)

    def test_parses_mono(self):
        self.assertEqual(_parse_channels_from_ffmpeg_stderr(self.MONO_WAV), 1)

    def test_parses_six_channel(self):
        self.assertEqual(_parse_channels_from_ffmpeg_stderr(self.SIX_CHANNEL), 6)

    def test_returns_none_on_no_audio_stream(self):
        self.assertIsNone(_parse_channels_from_ffmpeg_stderr(self.GIBBERISH))

    def test_parses_short_duration(self):
        self.assertAlmostEqual(
            _parse_duration_from_ffmpeg_stderr(self.STEREO_OPUS),
            28.62,
            places=2,
        )

    def test_parses_long_duration(self):
        # 2h 34m 12.10s
        self.assertAlmostEqual(
            _parse_duration_from_ffmpeg_stderr(self.SIX_CHANNEL),
            2 * 3600 + 34 * 60 + 12.10,
            places=2,
        )

    def test_returns_none_when_no_duration(self):
        self.assertIsNone(_parse_duration_from_ffmpeg_stderr(self.GIBBERISH))


def _write_wav_with_segments(path: Path, segments) -> None:
    """Write a 16 kHz mono WAV. `segments` is [(seconds_silent_or_loud, kind), ...]
    where kind is 'silent' or 'loud'. 'loud' fills with a low-amplitude tone
    well above MIN_RMS_THRESHOLD; 'silent' fills with zeros.
    """
    sr = 16000
    frames = bytearray()
    for seconds, kind in segments:
        n = int(seconds * sr)
        if kind == 'silent':
            frames.extend(struct.pack(f'<{n}h', *([0] * n)))
        elif kind == 'loud':
            # Sine wave at amplitude 0.05 (-26 dB) — well above the gate.
            samples = [
                int(0.05 * 32767 * math.sin(2 * math.pi * 440 * i / sr))
                for i in range(n)
            ]
            frames.extend(struct.pack(f'<{n}h', *samples))
        else:
            raise ValueError(kind)
    with wave.open(str(path), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(bytes(frames))


class CheckRmsEnergyTests(unittest.TestCase):
    """The whole-file scan is the *point* of this function. Confirm it
    catches audio that the old "first 5 seconds only" implementation would
    have missed."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmp.name)
        self.transcriber = WhisperTranscriber.__new__(WhisperTranscriber)

    def tearDown(self):
        self._tmp.cleanup()

    def test_all_silent_returns_false(self):
        path = self.tmpdir / 'silent.wav'
        _write_wav_with_segments(path, [(10, 'silent')])
        self.assertFalse(self.transcriber._check_rms_energy(path))

    def test_loud_throughout_returns_true(self):
        path = self.tmpdir / 'loud.wav'
        _write_wav_with_segments(path, [(10, 'loud')])
        self.assertTrue(self.transcriber._check_rms_energy(path))

    def test_speech_starting_after_5s_is_caught(self):
        # The pre-fix implementation read only the first 5 seconds; this
        # file has 10 s of silence then 5 s of audio. New scan should
        # surface the late-arriving energy and return True.
        path = self.tmpdir / 'late_speech.wav'
        _write_wav_with_segments(path, [(10, 'silent'), (5, 'loud')])
        self.assertTrue(self.transcriber._check_rms_energy(path))

    def test_zero_frame_file_returns_false(self):
        path = self.tmpdir / 'empty.wav'
        # Wave file with header but no frames.
        with wave.open(str(path), 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(b'')
        self.assertFalse(self.transcriber._check_rms_energy(path))

    def test_sub_one_second_clip_with_audio_is_not_silent(self):
        # Regression: the windowed scan used to require a full 1 s window
        # before it would compute any RMS. A 0.4 s loud clip would never
        # enter the loop and was falsely returned as silent — disabling
        # diarisation on short recordings.
        path = self.tmpdir / 'short_loud.wav'
        _write_wav_with_segments(path, [(0.4, 'loud')])
        self.assertTrue(self.transcriber._check_rms_energy(path))

    def test_sub_one_second_silent_clip_is_silent(self):
        path = self.tmpdir / 'short_silent.wav'
        _write_wav_with_segments(path, [(0.4, 'silent')])
        self.assertFalse(self.transcriber._check_rms_energy(path))

    def test_explicit_high_threshold_skips_quiet_audio(self):
        path = self.tmpdir / 'loud.wav'
        _write_wav_with_segments(path, [(5, 'loud')])
        # Loud test fixture is at ~-26 dB RMS; threshold 0.5 (~ -6 dB)
        # is well above and should not match.
        self.assertFalse(self.transcriber._check_rms_energy(path, threshold=0.5))

    def test_default_threshold_matches_constant(self):
        # Guards against accidental drift between the default arg and the
        # exported constant — they're meant to be the same thing.
        import inspect
        sig = inspect.signature(self.transcriber._check_rms_energy)
        self.assertEqual(sig.parameters['threshold'].default, MIN_RMS_THRESHOLD)


class ResolveFfmpegTests(unittest.TestCase):
    """Sanity check that the resolver runs and returns a string when ffmpeg
    is available on the test machine (CI runs on macOS with homebrew). If
    none of the candidate paths work this returns None, which is also a
    valid outcome — we just don't assert non-None to keep the test
    portable."""

    def test_resolve_returns_str_or_none(self):
        from src.transcriber import _resolve_ffmpeg
        result = _resolve_ffmpeg()
        self.assertTrue(result is None or isinstance(result, str))


if __name__ == '__main__':
    unittest.main()
