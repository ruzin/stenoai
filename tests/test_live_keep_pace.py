"""Regression tests for the live-transcript keep-pace guard (issue #357).

On fanless Apple Silicon (e.g. an M1 MacBook Air) a Parakeet partial decode can
take ~670 ms, well over the 400 ms partial interval. Because read + VAD +
partial/final decode run synchronously on the single stdin-consumer thread, a
partial that runs longer than the audio it represents back-pressures the stdin
pipe and the sidecar drifts behind real time.

The fix (``_LiveVadPipeline``): partials are best-effort display only — finals
accumulate every sample regardless — so when the measured partial-decode
wall-time exceeds the interval budget we stretch the *effective* partial cadence
to an EWMA of that decode time, dropping the partials that would otherwise queue
up while always draining stdin. On fast machines the cadence is unchanged.

These tests pin that contract without loading any real model: a fake VAD keeps
the pipeline permanently "in speech", a stub ``transcribe_samples`` stands in for
the decoder, and a fake monotonic clock makes each decode "take" a controlled
amount of wall-time so the assertions are deterministic (no real sleeps).
"""

import unittest
from unittest import mock

try:
    import numpy as np
    _HAVE_NUMPY = True
except ImportError:  # pragma: no cover - numpy is a hard backend dep
    _HAVE_NUMPY = False

from simple_recorder import _LiveVadPipeline


class _FakeVAD:
    """Minimal VAD stub: permanently in speech, emits no boundary events, so
    ``process()`` accumulates every chunk and drives ``_maybe_emit_partial``
    without ever finalising."""

    def __init__(self):
        self.in_speech = True

    def process(self, chunk):
        return []

    def flush(self):
        return []


class _FakeCoordinator:
    """Stand-in for the shared pending-finals coordinator (unused here since the
    fake VAD never finalises)."""

    def add(self, **kwargs):
        pass

    def flush_ready(self, other_idle):
        return []


class _SpeechStart:  # sentinel types; the fake VAD never emits them
    pass


class _SpeechEnd:
    pass


class _FakeClock:
    """Deterministic ``time.monotonic`` replacement. ``_maybe_emit_partial``
    reads the clock exactly twice per decode (start, then end); this advances by
    ``decode_s`` on every second read so each decode measures ``decode_s`` of
    wall-time regardless of real time."""

    def __init__(self, decode_s):
        self.t = 0.0
        self.decode_s = decode_s
        self._reads = 0

    def monotonic(self):
        self._reads += 1
        if self._reads % 2 == 0:
            self.t += self.decode_s
        return self.t


def _make_pipeline(transcribe_samples, sr=16000):
    pipe = _LiveVadPipeline(
        np=np,
        vad=_FakeVAD(),
        sr=sr,
        SpeechStart=_SpeechStart,
        SpeechEnd=_SpeechEnd,
        transcribe_samples=transcribe_samples,
        speaker="You",
        pending_finals=_FakeCoordinator(),
        language="auto",
    )
    # Silence the stdout LIVE_SEG emission; we only care about decode cadence.
    pipe._emit = lambda *a, **k: None
    return pipe


@unittest.skipUnless(_HAVE_NUMPY, "numpy required for _LiveVadPipeline")
class EffectiveIntervalTests(unittest.TestCase):
    """Unit coverage of the pure cadence math."""

    def setUp(self):
        self.pipe = _make_pipeline(lambda samples, language="auto": {"text": "x"})

    def test_base_interval_before_any_decode_timed(self):
        # EWMA starts at 0 → fast path returns the unmodified base interval.
        self.assertEqual(
            self.pipe._effective_partial_interval_samples(),
            self.pipe.partial_interval_samples,
        )

    def test_fast_decode_keeps_base_interval(self):
        # 150 ms decode is well under the 400 ms budget → cadence unchanged.
        self.pipe._record_partial_decode_time(0.15)
        self.assertEqual(
            self.pipe._effective_partial_interval_samples(),
            self.pipe.partial_interval_samples,
        )

    def test_slow_decode_widens_interval(self):
        # 800 ms decode → require ~800 ms × safety of audio between partials.
        self.pipe._record_partial_decode_time(0.8)
        expected = int(0.8 * _LiveVadPipeline.KEEP_PACE_SAFETY * self.pipe.sr)
        self.assertEqual(
            self.pipe._effective_partial_interval_samples(), expected,
        )
        self.assertGreater(
            self.pipe._effective_partial_interval_samples(),
            self.pipe.partial_interval_samples,
        )

    def test_interval_is_capped(self):
        # A pathological decode can't stretch the cadence without bound.
        self.pipe._record_partial_decode_time(10.0)
        self.assertEqual(
            self.pipe._effective_partial_interval_samples(),
            int(_LiveVadPipeline.KEEP_PACE_MAX_INTERVAL_S * self.pipe.sr),
        )

    def test_ewma_smooths_successive_samples(self):
        # First sample seeds the EWMA directly; the second blends by ALPHA.
        self.pipe._record_partial_decode_time(0.4)
        self.pipe._record_partial_decode_time(0.8)
        alpha = _LiveVadPipeline.KEEP_PACE_ALPHA
        self.assertAlmostEqual(
            self.pipe._partial_decode_ewma_s,
            (1.0 - alpha) * 0.4 + alpha * 0.8,
            places=6,
        )

    def test_negative_decode_time_ignored(self):
        self.pipe._record_partial_decode_time(-1.0)
        self.assertEqual(self.pipe._partial_decode_ewma_s, 0.0)


@unittest.skipUnless(_HAVE_NUMPY, "numpy required for _LiveVadPipeline")
class KeepPaceThrottlingTests(unittest.TestCase):
    """End-to-end: driving the same audio through a slow decoder produces fewer
    partial decodes than a fast one, proving the guard drops partials instead of
    queuing them up."""

    def _drive(self, decode_s, audio_seconds=6.0, chunk_seconds=0.1):
        calls = {"n": 0}

        def transcribe(samples, language="auto"):
            calls["n"] += 1
            return {"text": f"partial-{calls['n']}"}

        pipe = _make_pipeline(transcribe)
        chunk = np.zeros(int(pipe.sr * chunk_seconds), dtype=np.float32)
        n_chunks = int(audio_seconds / chunk_seconds)
        clock = _FakeClock(decode_s)
        with mock.patch("simple_recorder.time.monotonic", clock.monotonic):
            for _ in range(n_chunks):
                pipe.process(chunk.copy())
        return calls["n"]

    def test_slow_decode_throttles_partials(self):
        fast = self._drive(decode_s=0.15)  # under budget → base cadence
        slow = self._drive(decode_s=0.6)   # over budget → stretched cadence
        self.assertGreater(
            fast, slow,
            msg=f"expected the slow decoder to run fewer partials (fast={fast}, slow={slow})",
        )

    def test_failed_partial_still_records_decode_time(self):
        # A decoder that burns wall-time and then throws must still widen the
        # cadence — otherwise a failing decoder rebuilds the very backlog the
        # guard exists to relieve (cross-family review, #357).
        def transcribe(samples, language="auto"):
            raise RuntimeError("decode blew up")

        pipe = _make_pipeline(transcribe)
        chunk = np.zeros(int(pipe.sr * 0.1), dtype=np.float32)
        clock = _FakeClock(0.7)  # each (failed) decode measures 0.7 s
        with mock.patch("simple_recorder.time.monotonic", clock.monotonic):
            for _ in range(12):  # ~1.2 s of audio → at least one partial attempt
                pipe.process(chunk.copy())
        self.assertGreater(pipe._partial_decode_ewma_s, 0.0)
        self.assertGreater(
            pipe._effective_partial_interval_samples(),
            pipe.partial_interval_samples,
        )

    def test_fast_decode_matches_base_cadence(self):
        # Over 6 s of audio at the 0.4 s base interval, a fast decoder should run
        # roughly audio/interval partials (minus the MIN_UTTERANCE warm-up).
        fast = self._drive(decode_s=0.05, audio_seconds=6.0)
        naive = int(6.0 / _LiveVadPipeline.PARTIAL_INTERVAL_S)
        self.assertGreaterEqual(fast, naive - 3)
        self.assertLessEqual(fast, naive)


if __name__ == "__main__":
    unittest.main()
