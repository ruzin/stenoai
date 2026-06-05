"""Parakeet TDT v3 ASR via MLX.

Two interfaces share one lazily-loaded model:

* ``transcribe_file(path, language)`` — batch over a WAV on disk. Used by
  the post-stop pipeline.
* ``transcribe_samples(samples_16k)`` — batch over an in-memory float32
  array. Used by the live VAD-gated path, which already has the speech
  buffer in memory and shouldn't pay temp-file round-trip cost per
  partial/final.

Streaming inference (parakeet-mlx's RealtimeTranscriber) used to live here
but was ripped out — it produces unstable partials, requires careful chunk
sizing, and made the live-feel UX worse than a plain VAD-gated batch loop.
See src/silero_vad.py and the consumer in simple_recorder.py for the new
architecture.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Multilingual TDT v3 — covers the 25 European languages Parakeet supports
# at 0.6B params. If we ever add an English-only v2 variant for speed it'd
# be a sibling entry, not a swap.
DEFAULT_MODEL_ID = "mlx-community/parakeet-tdt-0.6b-v3"

_MODEL = None
_MODEL_LOCK = threading.Lock()


def _load_model(model_id: str):
    """Lazily load (and cache) the Parakeet model. Returns the model object.

    Raises ImportError if parakeet-mlx isn't available — caller decides how
    to surface that.
    """
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL
        try:
            from parakeet_mlx import from_pretrained
        except ImportError as e:
            raise ImportError(
                "parakeet-mlx is not installed. Run `pip install parakeet-mlx` "
                "in the venv (dev) or rebuild the PyInstaller bundle (prod)."
            ) from e
        logger.info("Loading Parakeet model: %s", model_id)
        _MODEL = from_pretrained(model_id)
        logger.info("Parakeet model loaded")
        return _MODEL


def model_sample_rate(model_id: str = DEFAULT_MODEL_ID) -> int:
    """Sample rate the model expects (used to configure the mic + VAD)."""
    m = _load_model(model_id)
    return int(m.preprocessor_config.sample_rate)


def ensure_loaded(model_id: str = DEFAULT_MODEL_ID) -> None:
    """Pre-load the model on a background thread.

    Useful at app startup or when the user enters the recording view: the
    first transcribe call pays the ~1 s warm-load cost (or ~30 s download +
    load on first ever run) and we'd rather not have that latency block
    the user's very first utterance.
    """
    _load_model(model_id)


# ---------------------------------------------------------------------------
# Batch — file
# ---------------------------------------------------------------------------

def transcribe_file(
    audio_path: Path,
    language: Optional[str] = None,
    model_id: str = DEFAULT_MODEL_ID,
) -> dict:
    """Transcribe a WAV file end-to-end. Returns the shape the existing
    pipeline expects: ``text``, ``segments`` (list of ``{text, start, end}``),
    ``duration_seconds``, ``detected_language``, ``detected_language_probability``.

    ``language`` is accepted for forward compatibility — Parakeet TDT v3 is
    multilingual and language-agnostic at inference time. We surface the
    value the caller passed in ``detected_language`` when it's concrete.
    """
    if not audio_path.exists():
        logger.error("Audio file not found: %s", audio_path)
        return {"text": None, "segments": [], "duration_seconds": None,
                "detected_language": None, "detected_language_probability": None}

    model = _load_model(model_id)
    logger.info("Transcribing (batch file): %s", audio_path)
    result = model.transcribe(str(audio_path))
    return _result_to_dict(result, language)


# ---------------------------------------------------------------------------
# Batch — in-memory samples
# ---------------------------------------------------------------------------

def transcribe_samples(
    samples_16k,
    language: Optional[str] = None,
    model_id: str = DEFAULT_MODEL_ID,
) -> dict:
    """Transcribe an in-memory float32 buffer at 16 kHz.

    Skips the load_audio → file path by calling ``get_logmel`` + ``generate``
    directly. This is the hot path for the live VAD-gated consumer — both
    the throttled 400 ms partials and the per-utterance final pass call
    this on speech buffers that already live in memory.

    ``samples_16k`` may be either a numpy float32 array or an mlx array
    at the model's sample rate (16 kHz for Parakeet TDT v3). Mono.
    """
    import mlx.core as mx
    import numpy as np
    from parakeet_mlx.audio import get_logmel

    model = _load_model(model_id)
    if not isinstance(samples_16k, mx.array):
        arr = np.asarray(samples_16k, dtype=np.float32).reshape(-1)
        samples_16k = mx.array(arr)
    # Sub-100ms inputs produce zero-length mel; bail early.
    if int(samples_16k.shape[0]) < model.preprocessor_config.hop_length * 4:
        return {"text": None, "segments": [], "duration_seconds": None,
                "detected_language": None, "detected_language_probability": None}
    mel = get_logmel(samples_16k, model.preprocessor_config)
    result = model.generate(mel)[0]
    return _result_to_dict(result, language)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _result_to_dict(result, language: Optional[str]) -> dict:
    sentences = list(getattr(result, "sentences", None) or [])
    segments = [
        {
            "text": (getattr(s, "text", "") or "").strip(),
            "start": float(getattr(s, "start", 0.0) or 0.0),
            "end": float(getattr(s, "end", 0.0) or 0.0),
        }
        for s in sentences
        if (getattr(s, "text", "") or "").strip()
    ]
    text = (getattr(result, "text", "") or "").strip()
    duration = segments[-1]["end"] if segments else None
    detected_language = language if (language and language != "auto") else None
    return {
        "text": text or None,
        "segments": segments,
        "duration_seconds": duration,
        "detected_language": detected_language,
        "detected_language_probability": None,
    }
