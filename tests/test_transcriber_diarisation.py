"""Tests for the diarisation-related helpers added in the system-audio branch.

Covers:
 - `_token_jaccard`: similarity should cleanly separate "true bleed"
   transcripts (identical or near-identical) from real two-party content.
 - `_parse_channels_from_ffmpeg_stderr` / `_parse_duration_from_ffmpeg_stderr`:
   regex parsers against representative ffmpeg `-i` stderr fixtures.
 - `_check_rms_energy`: scans the whole file (not just the first 5 seconds)
   so a recording where speech starts mid-stream isn't classified as silent.
"""

import json
import math
import struct
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import Mock, patch

from src.transcriber import (
    BLEED_JACCARD_THRESHOLD,
    DIARISED_SPLIT_TIMEOUT_S,
    MIN_RMS_THRESHOLD,
    STENO_DIARIZE_MERGE_GAP_S,
    WhisperTranscriber,
    _assign_asr_segments_to_diar_segments,
    _cluster_channel_labels,
    _diarised_split_timeout,
    _format_timestamp,
    _merge_close_diar_segments,
    _parse_channels_from_ffmpeg_stderr,
    _parse_duration_from_ffmpeg_stderr,
    _resolve_speaker_placeholders,
    _run_steno_diarize,
    _tag_channel_segments,
    _token_jaccard,
)


class FormatTimestampTests(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(_format_timestamp(0), "00:00")

    def test_under_a_minute_pads_seconds(self):
        self.assertEqual(_format_timestamp(5), "00:05")

    def test_minutes_and_seconds(self):
        self.assertEqual(_format_timestamp(65), "01:05")

    def test_floors_fractional_seconds(self):
        self.assertEqual(_format_timestamp(1.8), "00:01")

    def test_hour_switches_to_h_mm_ss(self):
        self.assertEqual(_format_timestamp(3661), "1:01:01")

    def test_exactly_one_hour(self):
        self.assertEqual(_format_timestamp(3600), "1:00:00")

    def test_negative_clamps_to_zero(self):
        self.assertEqual(_format_timestamp(-5), "00:00")

    def test_non_finite_falls_back_to_zero(self):
        # A backend emitting NaN/inf in a segment's start must not crash the
        # diarised assembly (int(NaN) raises ValueError, int(inf) OverflowError).
        self.assertEqual(_format_timestamp(float("nan")), "00:00")
        self.assertEqual(_format_timestamp(float("inf")), "00:00")
        self.assertEqual(_format_timestamp(float("-inf")), "00:00")


class TranscribeDiarisedTimestampTests(unittest.TestCase):
    """The diarised transcript prefixes each turn with an [MM:SS] timestamp
    from the turn's first segment. Mocks the per-channel transcription so no
    model/audio is needed. Disjoint mock text avoids the bleed-correction RMS
    read (which would need real WAVs)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        d = Path(self._tmp.name)
        self.audio_path = d / "source.wav"
        self.mic_path = d / "mic.wav"
        self.system_path = d / "system.wav"
        for p in (self.audio_path, self.mic_path, self.system_path):
            p.write_bytes(b"stub")
        self.transcriber = WhisperTranscriber.__new__(WhisperTranscriber)
        self.transcriber.backend = "parakeet"
        self.transcriber._split_stereo_to_channels = Mock(
            return_value=(self.mic_path, self.system_path, 3.0)
        )
        self.transcriber._check_rms_energy = Mock(return_value=True)
        # These are pinned-contract tests for the legacy You/Others-only
        # behaviour, so the sidecar must be explicitly forced off — without
        # this they'd pass by accident on a clean checkout (no binary) and
        # break the moment a contributor has one built locally (see
        # TranscribeDiarisedMultiSpeakerTests for the sidecar-present cases).
        self._diar_patcher = patch("src.transcriber._run_steno_diarize", return_value=None)
        self._diar_patcher.start()

    def tearDown(self):
        self._diar_patcher.stop()
        self._tmp.cleanup()

    def test_interleaves_diarised_segments_with_timestamps(self):
        self.transcriber.transcribe_audio = Mock(side_effect=[
            {"text": "Hello. Later.", "segments": [
                {"text": "Hello.", "start": 1.2, "end": 1.8},
                {"text": "Later.", "start": 4.0, "end": 4.5},
            ]},
            {"text": "Reply.", "segments": [{"text": "Reply.", "start": 2.1, "end": 2.8}]},
        ])
        result = self.transcriber.transcribe_diarised(self.audio_path)
        self.assertTrue(result["is_diarised"])
        self.assertEqual(
            result["diarised_text"],
            "[00:01] [You] Hello.\n\n[00:02] [Others] Reply.\n\n[00:04] [You] Later.",
        )
        # The plain text field stays timestamp- and label-free.
        self.assertNotIn("[00:0", result["text"])
        self.assertNotIn("[You]", result["text"])

    def test_single_source_is_not_timestamped_or_diarised(self):
        self.transcriber.transcribe_audio = Mock(side_effect=[
            {"text": "Only mic.", "segments": [{"text": "Only mic.", "start": 0.4, "end": 1.0}]},
            {"text": "", "segments": []},
        ])
        result = self.transcriber.transcribe_diarised(self.audio_path)
        self.assertFalse(result["is_diarised"])
        self.assertIsNone(result["diarised_text"])


class TranscribeDiarisedMultiSpeakerTests(unittest.TestCase):
    """Acoustic per-channel diarization (steno-diarize sidecar) layered on
    top of the legacy You/Others channel split. Mocks _run_steno_diarize
    directly (module-level, not an instance method) since transcribe_diarised
    calls it as a free function via _tag_channel_segments."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        d = Path(self._tmp.name)
        self.audio_path = d / "source.wav"
        self.mic_path = d / "mic.wav"
        self.system_path = d / "system.wav"
        for p in (self.audio_path, self.mic_path, self.system_path):
            p.write_bytes(b"stub")
        self.transcriber = WhisperTranscriber.__new__(WhisperTranscriber)
        self.transcriber.backend = "parakeet"
        self.transcriber._split_stereo_to_channels = Mock(
            return_value=(self.mic_path, self.system_path, 10.0)
        )
        self.transcriber._check_rms_energy = Mock(return_value=True)

    def tearDown(self):
        self._tmp.cleanup()

    def test_two_speakers_on_mic_channel_become_you_and_speaker_two(self):
        # Mic channel has two acoustic clusters (SPEAKER_0 dominant at 5s
        # total, SPEAKER_1 minor at 2s total); system channel has a single
        # trivial cluster so is_diarised (which requires both channels to
        # contribute) stays True.
        mic_diar = [
            {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_0"},
            {"start": 2.5, "end": 4.5, "speaker": "SPEAKER_1"},
            {"start": 5.0, "end": 8.0, "speaker": "SPEAKER_0"},
        ]
        system_diar = [{"start": 9.0, "end": 9.5, "speaker": "SPEAKER_0"}]
        with patch("src.transcriber._run_steno_diarize", side_effect=[mic_diar, system_diar]):
            self.transcriber.transcribe_audio = Mock(side_effect=[
                {"text": "Hi there. Not bad. Great.", "segments": [
                    {"text": "Hi there.", "start": 0.5, "end": 1.5},
                    {"text": "Not bad.", "start": 3.0, "end": 3.8},
                    {"text": "Great.", "start": 6.0, "end": 6.8},
                ]},
                {"text": "Ok.", "segments": [{"text": "Ok.", "start": 9.2, "end": 9.4}]},
            ])
            result = self.transcriber.transcribe_diarised(self.audio_path)
        self.assertTrue(result["is_diarised"])
        self.assertIn("[You] Hi there.", result["diarised_text"])
        self.assertIn("[Speaker 2] Not bad.", result["diarised_text"])
        self.assertIn("[You] Great.", result["diarised_text"])
        self.assertIn("[Others] Ok.", result["diarised_text"])

    def test_mic_only_multi_speaker_is_diarised_even_with_system_silent(self):
        # Regression: an in-person conversation with no computer audio
        # playing at all (system channel genuinely silent, not bled/dropped)
        # must still produce a labelled transcript from the mic channel's
        # own acoustic diarization. The old is_diarised computation
        # (bool(mic_segments) and bool(system_segments)) discarded the
        # whole labelled transcript whenever system was empty, even though
        # _tag_channel_segments had already split mic into You + Speaker 2.
        mic_diar = [
            {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_0"},
            {"start": 2.5, "end": 4.5, "speaker": "SPEAKER_1"},
            {"start": 5.0, "end": 8.0, "speaker": "SPEAKER_0"},
        ]
        with patch("src.transcriber._run_steno_diarize", return_value=mic_diar):
            self.transcriber._check_rms_energy = Mock(side_effect=[True, False])
            self.transcriber.transcribe_audio = Mock(return_value={
                "text": "Hi there. Not bad. Great.", "segments": [
                    {"text": "Hi there.", "start": 0.5, "end": 1.5},
                    {"text": "Not bad.", "start": 3.0, "end": 3.8},
                    {"text": "Great.", "start": 6.0, "end": 6.8},
                ],
            })
            result = self.transcriber.transcribe_diarised(self.audio_path)
        self.assertTrue(result["is_diarised"])
        self.assertIsNotNone(result["diarised_text"])
        self.assertIn("[You] Hi there.", result["diarised_text"])
        self.assertIn("[Speaker 2] Not bad.", result["diarised_text"])
        self.assertIn("[You] Great.", result["diarised_text"])

    def test_speaker_numbering_is_chronological_across_both_channels(self):
        # System's placeholder speaker turns up chronologically before
        # mic's placeholder speaker, so it must be numbered "Speaker 2"
        # even though the mic channel's diarization result is processed
        # first in transcribe_diarised. Dominant/minor durations are
        # clearly unequal (4s vs 1s) so cluster dominance is unambiguous.
        system_diar = [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_1"},    # minor, first chronologically
            {"start": 10.0, "end": 14.0, "speaker": "SPEAKER_0"},  # dominant -> "Others"
        ]
        mic_diar = [
            {"start": 15.0, "end": 16.0, "speaker": "SPEAKER_1"},  # minor
            {"start": 20.0, "end": 24.0, "speaker": "SPEAKER_0"},  # dominant -> "You"
        ]
        with patch("src.transcriber._run_steno_diarize", side_effect=[mic_diar, system_diar]):
            self.transcriber.transcribe_audio = Mock(side_effect=[
                {"text": "Mic minor. Mic dominant.", "segments": [
                    {"text": "Mic minor.", "start": 15.2, "end": 15.8},
                    {"text": "Mic dominant.", "start": 21.0, "end": 21.5},
                ]},
                {"text": "Sys minor. Sys dominant.", "segments": [
                    {"text": "Sys minor.", "start": 0.2, "end": 0.8},
                    {"text": "Sys dominant.", "start": 11.0, "end": 11.5},
                ]},
            ])
            result = self.transcriber.transcribe_diarised(self.audio_path)
        # System's minority cluster appears first chronologically (t=0.0)
        # so it gets "Speaker 2"; mic's minority cluster (t=15.0) gets
        # "Speaker 3" even though mic is diarized first in the pipeline.
        # Each turn is timestamped by the diarizer's own segment boundary
        # (not the ASR sentence start) — see _tag_channel_segments.
        self.assertEqual(
            result["diarised_text"],
            "[00:00] [Speaker 2] Sys minor."
            "\n\n[00:10] [Others] Sys dominant."
            "\n\n[00:15] [Speaker 3] Mic minor."
            "\n\n[00:20] [You] Mic dominant.",
        )

    def test_single_cluster_per_channel_is_byte_identical_to_legacy(self):
        # Sidecar runs successfully but finds only one speaker per channel —
        # must fall back to plain You/Others, not "Speaker 1" everywhere.
        mic_diar = [{"start": 0.0, "end": 5.0, "speaker": "SPEAKER_0"}]
        system_diar = [{"start": 0.0, "end": 5.0, "speaker": "SPEAKER_0"}]
        with patch("src.transcriber._run_steno_diarize", side_effect=[mic_diar, system_diar]):
            self.transcriber.transcribe_audio = Mock(side_effect=[
                {"text": "Hello.", "segments": [{"text": "Hello.", "start": 1.0, "end": 1.5}]},
                {"text": "Reply.", "segments": [{"text": "Reply.", "start": 2.0, "end": 2.5}]},
            ])
            result = self.transcriber.transcribe_diarised(self.audio_path)
        self.assertEqual(
            result["diarised_text"],
            "[00:01] [You] Hello.\n\n[00:02] [Others] Reply.",
        )

    def test_sidecar_failure_falls_back_without_failing_meeting(self):
        # Missing binary / timeout / bad JSON all surface as None from
        # _run_steno_diarize — transcribe_diarised must never fail the
        # meeting because of it.
        with patch("src.transcriber._run_steno_diarize", return_value=None):
            self.transcriber.transcribe_audio = Mock(side_effect=[
                {"text": "Hello.", "segments": [{"text": "Hello.", "start": 1.0, "end": 1.5}]},
                {"text": "Reply.", "segments": [{"text": "Reply.", "start": 2.0, "end": 2.5}]},
            ])
            result = self.transcriber.transcribe_diarised(self.audio_path)
        self.assertNotIn("transcription_failed", result)
        self.assertEqual(
            result["diarised_text"],
            "[00:01] [You] Hello.\n\n[00:02] [Others] Reply.",
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


class DiarisedSplitTimeoutTests(unittest.TestCase):
    """The per-channel split timeout must scale with recording length so a
    multi-hour stereo meeting isn't cut off mid-decode and silently dropped
    to a mono transcript (the old fixed 120 s did exactly that)."""

    def test_long_meeting_scales_well_above_old_fixed_cap(self):
        # A 4-hour file would never decode in the old 120 s on CPU.
        four_hours = 4 * 3600
        timeout = _diarised_split_timeout(four_hours)
        self.assertGreater(timeout, 120)
        self.assertEqual(timeout, four_hours * 2)

    def test_unknown_and_short_durations_fall_back_to_floor(self):
        self.assertEqual(_diarised_split_timeout(None), DIARISED_SPLIT_TIMEOUT_S)
        self.assertEqual(_diarised_split_timeout(0), DIARISED_SPLIT_TIMEOUT_S)
        # A short clip whose 2x is under the floor still gets the full floor.
        self.assertEqual(_diarised_split_timeout(30), DIARISED_SPLIT_TIMEOUT_S)

    def test_returns_int(self):
        self.assertIsInstance(_diarised_split_timeout(1234.5), int)


class MergeCloseDiarSegmentsTests(unittest.TestCase):
    def test_empty_input_returns_empty(self):
        self.assertEqual(_merge_close_diar_segments([], 0.3), [])

    def test_merges_same_speaker_within_gap(self):
        segments = [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"},
            {"start": 1.2, "end": 2.0, "speaker": "SPEAKER_0"},
        ]
        merged = _merge_close_diar_segments(segments, 0.3)
        self.assertEqual(merged, [{"start": 0.0, "end": 2.0, "speaker": "SPEAKER_0"}])

    def test_does_not_merge_across_gap_larger_than_threshold(self):
        segments = [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"},
            {"start": 2.0, "end": 3.0, "speaker": "SPEAKER_0"},
        ]
        merged = _merge_close_diar_segments(segments, 0.3)
        self.assertEqual(len(merged), 2)

    def test_does_not_merge_different_speakers(self):
        segments = [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"},
            {"start": 1.1, "end": 2.0, "speaker": "SPEAKER_1"},
        ]
        merged = _merge_close_diar_segments(segments, 0.3)
        self.assertEqual(len(merged), 2)

    def test_does_not_mutate_input(self):
        segments = [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"}]
        _merge_close_diar_segments(segments, STENO_DIARIZE_MERGE_GAP_S)
        self.assertEqual(segments, [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"}])


class AssignAsrSegmentsToDiarSegmentsTests(unittest.TestCase):
    def test_empty_diar_segments_is_a_no_op(self):
        diar_segments = []
        _assign_asr_segments_to_diar_segments(
            [{"text": "Hello", "start": 0.0, "end": 1.0}], diar_segments
        )
        self.assertEqual(diar_segments, [])

    def test_assigns_sentence_within_segment_bounds(self):
        diar_segments = [{"start": 0.0, "end": 5.0, "speaker": "SPEAKER_0"}]
        _assign_asr_segments_to_diar_segments(
            [{"text": "Hello there", "start": 1.0, "end": 2.0}], diar_segments
        )
        self.assertEqual(diar_segments[0]["text"], "Hello there")

    def test_assigns_multiple_sentences_to_nearest_segment(self):
        diar_segments = [
            {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_0"},
            {"start": 3.0, "end": 5.0, "speaker": "SPEAKER_1"},
        ]
        _assign_asr_segments_to_diar_segments(
            [
                {"text": "First.", "start": 0.5, "end": 1.0},
                {"text": "Second.", "start": 3.5, "end": 4.0},
                # Falls in the gap between segments (2.0-3.0) but its
                # midpoint (2.6) is closer to the second segment's start.
                {"text": "Gap.", "start": 2.4, "end": 2.8},
            ],
            diar_segments,
        )
        self.assertEqual(diar_segments[0]["text"], "First.")
        self.assertEqual(diar_segments[1]["text"], "Second. Gap.")

    def test_blank_sentences_are_skipped(self):
        diar_segments = [{"start": 0.0, "end": 5.0, "speaker": "SPEAKER_0"}]
        _assign_asr_segments_to_diar_segments(
            [{"text": "  ", "start": 1.0, "end": 2.0}], diar_segments
        )
        self.assertEqual(diar_segments[0]["text"], "")

    def test_long_sentence_spanning_multiple_speakers_splits_by_word(self):
        # Regression for a real observed failure: a single mic capturing two
        # people can produce one long Parakeet "sentence" (no punctuation
        # break) that actually spans a genuine back-and-forth. Whole-block
        # midpoint assignment forced the entire run onto one speaker;
        # word-level splitting should recover the real turn boundaries.
        diar_segments = [
            {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_0"},
            {"start": 3.0, "end": 6.0, "speaker": "SPEAKER_1"},
        ]
        tokens = [
            {"text": " one", "start": 0.5, "end": 1.0},
            {"text": " two", "start": 1.0, "end": 1.5},
            {"text": " three", "start": 4.5, "end": 5.0},
            {"text": " four", "start": 5.0, "end": 5.5},
        ]
        _assign_asr_segments_to_diar_segments(
            [{"text": "one two three four", "start": 0.5, "end": 5.5, "tokens": tokens}],
            diar_segments,
        )
        self.assertEqual(diar_segments[0]["text"], "one two")
        self.assertEqual(diar_segments[1]["text"], "three four")

    def test_long_sentence_within_single_speaker_is_not_split(self):
        # Long duration alone isn't enough to trigger splitting — the
        # diarizer segments it overlaps must belong to more than one
        # distinct speaker. Fragmented same-speaker segments (diarizer
        # flicker) should still be treated as one block.
        diar_segments = [
            {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_0"},
            {"start": 3.0, "end": 6.0, "speaker": "SPEAKER_0"},
        ]
        tokens = [
            {"text": " one", "start": 0.5, "end": 1.0},
            {"text": " two", "start": 5.0, "end": 5.5},
        ]
        _assign_asr_segments_to_diar_segments(
            [{"text": "one two", "start": 0.5, "end": 5.5, "tokens": tokens}],
            diar_segments,
        )
        self.assertEqual(diar_segments[0]["text"], "one two")
        self.assertEqual(diar_segments[1]["text"], "")

    def test_short_sentence_not_split_even_across_speakers(self):
        # Below LONG_SENTENCE_SPLIT_THRESHOLD_S — must stay whole-block
        # (matching the historical short-sentence behaviour) even though it
        # technically overlaps two different speakers, to avoid tearing
        # short utterances apart on noisy diarizer boundaries.
        diar_segments = [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"},
            {"start": 1.0, "end": 2.0, "speaker": "SPEAKER_1"},
        ]
        tokens = [
            {"text": " hi", "start": 0.8, "end": 1.0},
            {"text": " there", "start": 1.0, "end": 1.2},
        ]
        _assign_asr_segments_to_diar_segments(
            [{"text": "hi there", "start": 0.8, "end": 1.2, "tokens": tokens}],
            diar_segments,
        )
        texts = [d["text"] for d in diar_segments]
        self.assertEqual(texts.count("hi there"), 1)

    def test_long_sentence_without_tokens_falls_back_to_whole_block(self):
        # No word-level timing (e.g. the whisper.cpp backend never
        # populates "tokens") must never crash — falls back to the same
        # whole-block nearest assignment as a normal sentence.
        diar_segments = [
            {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_0"},
            {"start": 3.0, "end": 6.0, "speaker": "SPEAKER_1"},
        ]
        _assign_asr_segments_to_diar_segments(
            [{"text": "one two three four", "start": 0.5, "end": 5.5}],
            diar_segments,
        )
        texts = [d["text"] for d in diar_segments]
        self.assertEqual(texts.count("one two three four"), 1)


class ClusterChannelLabelsTests(unittest.TestCase):
    def test_single_speaker_returns_none(self):
        segments = [{"start": 0.0, "end": 5.0, "speaker": "SPEAKER_0"}]
        self.assertIsNone(_cluster_channel_labels(segments, "You"))

    def test_empty_segments_returns_none(self):
        self.assertIsNone(_cluster_channel_labels([], "You"))

    def test_dominant_speaker_by_total_duration_keeps_legacy_label(self):
        segments = [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"},   # 1s
            {"start": 1.0, "end": 6.0, "speaker": "SPEAKER_1"},   # 5s, dominant
        ]
        labels = _cluster_channel_labels(segments, "You")
        self.assertEqual(labels["SPEAKER_1"], "You")
        self.assertEqual(labels["SPEAKER_0"], "__diar__You__SPEAKER_0")


class ResolveSpeakerPlaceholdersTests(unittest.TestCase):
    def test_legacy_labels_are_untouched(self):
        tagged = [(0.0, "You", "hi"), (1.0, "Others", "hey")]
        self.assertEqual(_resolve_speaker_placeholders(tagged), tagged)

    def test_placeholders_numbered_from_two_by_first_appearance(self):
        tagged = [
            (0.0, "You", "a"),
            (1.0, "__diar__You__SPEAKER_1", "b"),
            (2.0, "__diar__Others__SPEAKER_1", "c"),
            (3.0, "__diar__You__SPEAKER_1", "d"),
        ]
        resolved = _resolve_speaker_placeholders(tagged)
        self.assertEqual(resolved[0], (0.0, "You", "a"))
        self.assertEqual(resolved[1], (1.0, "Speaker 2", "b"))
        self.assertEqual(resolved[2], (2.0, "Speaker 3", "c"))
        # Same placeholder key reuses the same number on a later turn.
        self.assertEqual(resolved[3], (3.0, "Speaker 2", "d"))


class TagChannelSegmentsTests(unittest.TestCase):
    def test_empty_asr_segments_returns_empty_without_diarizing(self):
        with patch("src.transcriber._run_steno_diarize") as mock_run:
            result = _tag_channel_segments([], Path("/fake/mic.wav"), 5.0, "You")
        mock_run.assert_not_called()
        self.assertEqual(result, [])

    def test_no_channel_path_uses_legacy_labeling(self):
        asr_segments = [{"text": "Hi.", "start": 0.0, "end": 1.0}]
        result = _tag_channel_segments(asr_segments, None, 5.0, "You")
        self.assertEqual(result, [(0.0, "You", "Hi.")])


class RunStenoDiarizeTests(unittest.TestCase):
    """_run_steno_diarize must survive the sidecar's real quirks: a
    diagnostic warning printed to stdout ahead of the JSON payload, and any
    kind of failure (missing binary, timeout, bad exit, bad JSON)."""

    def test_returns_none_when_binary_unresolved(self):
        with patch("src.transcriber._resolve_steno_diarize", return_value=None):
            self.assertIsNone(_run_steno_diarize(Path("/fake/mic.wav"), 60))

    def test_parses_json_with_e5rt_warning_prefix_on_stdout(self):
        payload = json.dumps([
            {"speakerId": "SPEAKER_1", "start": 1.0, "end": 2.0},
            {"speakerId": "SPEAKER_0", "start": 0.0, "end": 0.9},
        ]).encode()
        stdout = b"E5RT encountered an STL exception. msg = unordered_map::at: key not found." + payload
        with patch("src.transcriber._resolve_steno_diarize", return_value="/fake/steno-diarize"), \
             patch("subprocess.run", return_value=Mock(returncode=0, stdout=stdout, stderr=b"")):
            result = _run_steno_diarize(Path("/fake/mic.wav"), 60)
        self.assertEqual(
            result,
            [
                {"start": 0.0, "end": 0.9, "speaker": "SPEAKER_0"},
                {"start": 1.0, "end": 2.0, "speaker": "SPEAKER_1"},
            ],
        )

    def test_nonzero_exit_returns_none(self):
        with patch("src.transcriber._resolve_steno_diarize", return_value="/fake/steno-diarize"), \
             patch("subprocess.run", return_value=Mock(returncode=1, stdout=b"", stderr=b"boom")):
            self.assertIsNone(_run_steno_diarize(Path("/fake/mic.wav"), 60))

    def test_unparseable_json_returns_none(self):
        with patch("src.transcriber._resolve_steno_diarize", return_value="/fake/steno-diarize"), \
             patch("subprocess.run", return_value=Mock(returncode=0, stdout=b"[not json", stderr=b"")):
            self.assertIsNone(_run_steno_diarize(Path("/fake/mic.wav"), 60))

    def test_no_bracket_in_stdout_returns_none(self):
        with patch("src.transcriber._resolve_steno_diarize", return_value="/fake/steno-diarize"), \
             patch("subprocess.run", return_value=Mock(returncode=0, stdout=b"nothing useful", stderr=b"")):
            self.assertIsNone(_run_steno_diarize(Path("/fake/mic.wav"), 60))

    def test_timeout_returns_none(self):
        with patch("src.transcriber._resolve_steno_diarize", return_value="/fake/steno-diarize"), \
             patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="steno-diarize", timeout=60)):
            self.assertIsNone(_run_steno_diarize(Path("/fake/mic.wav"), 60))


if __name__ == '__main__':
    unittest.main()
