"""Silero VAD via ONNX Runtime.

Why ONNX-runtime directly instead of the silero-vad PyPI package: the PyPI
wrapper imports torch at module load, and shipping torch in the PyInstaller
bundle would balloon the DMG by ~1 GB. The ONNX model itself is 1.2 MB and
runs on a few-MB onnxruntime CPU build. We pay only the runtime cost.

This module exposes two layers:

* ``SileroVAD`` — the raw ONNX model wrapped in a stateful predict() that
  consumes 512-sample float32 chunks at 16 kHz (the model's native chunk
  size) and returns a speech probability.
* ``SileroProcessor`` — a higher-level state machine that turns a stream
  of arbitrary-size audio buffers into ``SpeechStart`` / ``SpeechEnd``
  events. Mirrors the silero-rs / FluidAudio VadManager contract: hysteresis
  between positive and negative thresholds, a redemption window for natural
  pauses inside an utterance, and a minimum-duration filter so the consumer
  isn't woken by 40 ms speech fragments.

The defaults are the same values OpenOats and Meetily settled on after
real-world tuning — see SETTINGS_RATIONALE below for why each one.
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


# --- Tuning constants -------------------------------------------------------
# Silero VAD's native chunk size at 16 kHz. The ONNX graph reshapes the input
# internally — passing any other size raises a runtime shape error.
VAD_CHUNK_SAMPLES = 512  # 32 ms at 16 kHz
VAD_SAMPLE_RATE = 16000

# SETTINGS_RATIONALE
# positive_threshold = 0.50    Silero default. Higher → fewer false positives,
#                              but you start clipping the leading word.
# negative_threshold = 0.35    Lower than positive (hysteresis): once we're in
#                              speech, we need clearer silence to exit.
# min_speech_ms      = 250     Filters out 40-100 ms "speech" events Silero
#                              fires on door clicks / lip smacks. Parakeet
#                              rejects sub-250ms clips anyway.
# redemption_ms      = 600     Bridges natural sentence-internal pauses. Lower
#                              than Meetily's 2000 ms because we want shorter
#                              segments live (more responsive UX); we still
#                              re-run the full diarised pipeline on stop.
# pre_pad_ms         = 300     VAD always fires late. Without this, the first
#                              syllable of every utterance gets clipped.
# post_pad_ms        = 400     Captures trailing breath / consonants so the
#                              decoder doesn't see a mid-word cut.
DEFAULT_POSITIVE_THRESHOLD = 0.50
DEFAULT_NEGATIVE_THRESHOLD = 0.35
DEFAULT_MIN_SPEECH_MS = 250
DEFAULT_REDEMPTION_MS = 600
DEFAULT_PRE_PAD_MS = 300
DEFAULT_POST_PAD_MS = 400


def _resolve_model_path() -> Path:
    """Find the bundled ONNX model in both dev and PyInstaller layouts."""
    # PyInstaller's data files end up under _MEIPASS; dev runs use the
    # source tree directly.
    candidates: list[Path] = []
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        candidates.append(Path(sys._MEIPASS) / "src" / "data" / "silero_vad.onnx")
    candidates.append(Path(__file__).parent / "data" / "silero_vad.onnx")
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(
        f"silero_vad.onnx not found in any of: {candidates}"
    )


# ---------------------------------------------------------------------------
# Low-level ONNX wrapper
# ---------------------------------------------------------------------------

class SileroVAD:
    """Stateful per-chunk inference. One instance per audio stream.

    Two pieces of state MUST be preserved across ``predict()`` calls on
    the same stream:

    * ``_state``: the 2-layer LSTM hidden state.
    * ``_context``: the trailing 64 samples of the *previous* chunk. The
      v5 model expects the caller to prepend this before running — its
      conv front-end needs continuity at chunk boundaries. Without it
      the model sees disjoint 512-sample fragments and outputs ~0
      probability regardless of speech content.

    ``reset()`` zeros both for a new stream."""

    # The v5 model prepends this many samples of prior audio before each
    # 512-sample chunk. 64 for 16 kHz, 32 for 8 kHz — we only support 16k.
    _CONTEXT_SAMPLES = 64

    def __init__(self, model_path: Optional[Path] = None):
        import onnxruntime as ort  # local import: keep module-level light
        self._ort = ort
        self._model_path = Path(model_path) if model_path else _resolve_model_path()
        # CPUExecutionProvider is fine — the model is tiny and CoreML
        # provider for such a small graph adds more overhead than it saves.
        sess_opts = ort.SessionOptions()
        sess_opts.log_severity_level = 3
        self._sess = ort.InferenceSession(
            str(self._model_path),
            sess_opts,
            providers=["CPUExecutionProvider"],
        )
        self._sr = np.array(VAD_SAMPLE_RATE, dtype=np.int64)
        self.reset()

    def reset(self) -> None:
        """Zero the LSTM state + context. Call when starting a new stream."""
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, self._CONTEXT_SAMPLES), dtype=np.float32)

    def predict(self, chunk: np.ndarray) -> float:
        """Return speech probability ∈ [0, 1] for one 512-sample chunk."""
        if chunk.shape != (VAD_CHUNK_SAMPLES,):
            raise ValueError(
                f"SileroVAD.predict expects ({VAD_CHUNK_SAMPLES},) chunks, "
                f"got {chunk.shape}"
            )
        if chunk.dtype != np.float32:
            chunk = chunk.astype(np.float32)
        # Prepend the carryover context so the model's front-end sees a
        # continuous 576-sample window. The next call's context is the
        # trailing 64 samples of THIS window.
        full = np.concatenate(
            [self._context, chunk.reshape(1, -1)], axis=1
        )
        feeds = {
            "input": full,
            "state": self._state,
            "sr": self._sr,
        }
        prob, self._state = self._sess.run(None, feeds)
        self._context = full[:, -self._CONTEXT_SAMPLES:]
        return float(prob[0, 0])


# ---------------------------------------------------------------------------
# Event-driven processor
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SpeechStart:
    """Fired when VAD transitions from silence → speech. ``timestamp_samples``
    is the position in the input stream (NOT a wall clock) where speech
    began, in 16 kHz samples."""
    timestamp_samples: int


@dataclass(frozen=True)
class SpeechEnd:
    """Fired when VAD has seen ``redemption_ms`` of continuous silence after
    a speech run. ``start_timestamp_samples`` matches the SpeechStart that
    opened this utterance."""
    start_timestamp_samples: int
    end_timestamp_samples: int


SpeechEvent = SpeechStart | SpeechEnd


class SileroProcessor:
    """High-level VAD: chunks → ``SpeechEvent`` stream.

    Stateful across calls. Feed ``process(samples)`` arbitrary-size buffers;
    it slices them into 512-sample sub-chunks, runs Silero, and emits
    SpeechStart / SpeechEnd events on transitions. Callers manage the
    associated audio buffer + preroll / post-pad themselves so this module
    stays small and reusable.

    The state machine is intentionally simple — Silero's own LSTM does the
    hard work; we just apply hysteresis + minimum-duration + redemption.
    """

    def __init__(
        self,
        model_path: Optional[Path] = None,
        positive_threshold: float = DEFAULT_POSITIVE_THRESHOLD,
        negative_threshold: float = DEFAULT_NEGATIVE_THRESHOLD,
        min_speech_ms: int = DEFAULT_MIN_SPEECH_MS,
        redemption_ms: int = DEFAULT_REDEMPTION_MS,
    ):
        self._vad = SileroVAD(model_path)
        self.positive_threshold = positive_threshold
        self.negative_threshold = negative_threshold
        self._min_speech_samples = int(VAD_SAMPLE_RATE * min_speech_ms / 1000)
        self._redemption_samples = int(VAD_SAMPLE_RATE * redemption_ms / 1000)

        self._in_speech: bool = False
        # Position in the input stream of the chunk currently being
        # processed (16 kHz samples). Incremented by VAD_CHUNK_SAMPLES per
        # chunk so timestamps are exact.
        self._cursor_samples: int = 0
        self._speech_start_sample: Optional[int] = None
        # Counters for the silence-redemption window; reset whenever a
        # positive frame arrives during a speech run.
        self._silence_run_samples: int = 0
        # Tracks how long the candidate speech has been going so we can
        # reject runs shorter than ``min_speech_ms``.
        self._speech_run_samples: int = 0
        # Hold-back buffer for chunks that haven't filled a 512-sample
        # window yet (when the caller hands us, say, 4096 + 100 samples).
        self._tail: np.ndarray = np.empty((0,), dtype=np.float32)

    def reset(self) -> None:
        """Discard internal state. Use between independent streams."""
        self._vad.reset()
        self._in_speech = False
        self._cursor_samples = 0
        self._speech_start_sample = None
        self._silence_run_samples = 0
        self._speech_run_samples = 0
        self._tail = np.empty((0,), dtype=np.float32)

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    @property
    def chunk_samples(self) -> int:
        return VAD_CHUNK_SAMPLES

    def process(self, samples: np.ndarray) -> list[SpeechEvent]:
        """Feed an arbitrary-length buffer; return any state transitions.

        Multiple events can fire for one call when the buffer spans a
        long silence followed by speech (or vice versa). Order is
        preserved.
        """
        if samples.dtype != np.float32:
            samples = samples.astype(np.float32)
        if samples.ndim > 1:
            samples = samples.reshape(-1)

        # Prepend leftover tail so we don't lose audio across calls.
        if self._tail.size:
            samples = np.concatenate([self._tail, samples])
            self._tail = np.empty((0,), dtype=np.float32)

        events: list[SpeechEvent] = []
        n = len(samples)
        # Process whole 512-sample windows; stash any tail for next call.
        full = (n // VAD_CHUNK_SAMPLES) * VAD_CHUNK_SAMPLES
        for i in range(0, full, VAD_CHUNK_SAMPLES):
            chunk = samples[i : i + VAD_CHUNK_SAMPLES]
            prob = self._vad.predict(chunk)
            self._update(prob, events)
            self._cursor_samples += VAD_CHUNK_SAMPLES
        if full < n:
            self._tail = samples[full:].copy()
        return events

    def flush(self) -> list[SpeechEvent]:
        """End any in-progress speech run. Call once when the input stream
        closes so the consumer sees a final SpeechEnd.

        Includes the tail buffer's length in the final timestamp — the tail
        is audio that hadn't yet filled a 512-sample VAD window when the
        stream ended, but the consumer has been adding it to its speech
        buffer all along, so the SpeechEnd timestamp needs to reflect the
        actual end of the audio (not just the last fully-processed chunk).
        Without this the final segment's ``end`` was off by up to ~32 ms.
        """
        events: list[SpeechEvent] = []
        if self._in_speech and self._speech_start_sample is not None:
            events.append(SpeechEnd(
                start_timestamp_samples=self._speech_start_sample,
                end_timestamp_samples=self._cursor_samples + len(self._tail),
            ))
            self._in_speech = False
            self._speech_start_sample = None
        # Drop the tail — it's never enough to fire a transition anyway.
        self._tail = np.empty((0,), dtype=np.float32)
        return events

    # --- internal --------------------------------------------------------

    def _update(self, prob: float, events: list[SpeechEvent]) -> None:
        if self._in_speech:
            if prob >= self.negative_threshold:
                # Still speech (or marginal — stay in)
                self._silence_run_samples = 0
                self._speech_run_samples += VAD_CHUNK_SAMPLES
            else:
                # Silence
                self._silence_run_samples += VAD_CHUNK_SAMPLES
                self._speech_run_samples += VAD_CHUNK_SAMPLES
                if self._silence_run_samples >= self._redemption_samples:
                    # Speech end — but only honor it if the run was long
                    # enough to be a real utterance.
                    end_at = self._cursor_samples + VAD_CHUNK_SAMPLES \
                        - self._silence_run_samples
                    if (self._speech_run_samples - self._silence_run_samples
                            >= self._min_speech_samples
                            and self._speech_start_sample is not None):
                        events.append(SpeechEnd(
                            start_timestamp_samples=self._speech_start_sample,
                            end_timestamp_samples=end_at,
                        ))
                    self._in_speech = False
                    self._speech_start_sample = None
                    self._silence_run_samples = 0
                    self._speech_run_samples = 0
        else:
            if prob >= self.positive_threshold:
                self._in_speech = True
                # Mark speech as starting at the START of the chunk that
                # triggered it — the caller is responsible for prepending
                # preroll to recover anything earlier.
                self._speech_start_sample = self._cursor_samples
                self._silence_run_samples = 0
                self._speech_run_samples = VAD_CHUNK_SAMPLES
                events.append(SpeechStart(
                    timestamp_samples=self._speech_start_sample,
                ))
