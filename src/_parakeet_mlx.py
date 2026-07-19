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

import inspect
import logging
import threading
from pathlib import Path
from typing import Optional

from src._heartbeat import _emit_heartbeat

logger = logging.getLogger(__name__)

# Multilingual TDT v3 — covers the 25 European languages Parakeet supports
# at 0.6B params. If we ever add an English-only v2 variant for speed it'd
# be a sibling entry, not a swap.
DEFAULT_MODEL_ID = "mlx-community/parakeet-tdt-0.6b-v3"

# In-memory MLX inference is fast enough on Apple Silicon to re-transcribe
# the trailing PARTIAL_WINDOW_S of speech every PARTIAL_INTERVAL_S without
# blowing the live consumer's budget. The whispercpp shim's mirror of this
# flag is False — see src/whispercpp.py for the rationale.
SUPPORTS_PARTIALS = True

# Batch-file chunking. Without it, parakeet-mlx builds the full mel + decode
# graph for the entire file in one shot: a 33-min meeting tries to allocate
# ~40 GB on MLX and SIGABRTs in metal::malloc, so long meetings came back as
# a fake-empty "no audio" transcript. With chunk_duration set, the library
# windows the audio, overlaps each window, and merges tokens with corrected
# global timestamps (merge_longest_contiguous) — peak memory stays bounded
# to one window. 60 s is a conservative balance: well below the previously
# guessed 120 s, and informed by OpenOats running 30 s on this same
# Parakeet-MLX engine. The overlap is stitched back out by the library merge.
# Kept equal to the ONNX backend's constants so behaviour matches per-platform.
PARAKEET_CHUNK_DURATION_S = 60.0
PARAKEET_CHUNK_OVERLAP_S = 15.0

_MODEL_CACHE: dict[str, object] = {}
_MODEL_LOCK = threading.Lock()


def _load_model(model_id: str):
    """Lazily load (and cache) a Parakeet model by id. Returns the model.

    Cache is keyed by ``model_id`` so a call with a non-default id (e.g. a
    future English-only TDT v2 variant) actually loads that model rather
    than silently returning the first one ever loaded. Today only
    ``DEFAULT_MODEL_ID`` is in use; this keeps the function contract
    correct against future variants without an API change.

    Raises ImportError if parakeet-mlx isn't available — caller decides how
    to surface that.
    """
    cached = _MODEL_CACHE.get(model_id)
    if cached is not None:
        return cached
    with _MODEL_LOCK:
        cached = _MODEL_CACHE.get(model_id)
        if cached is not None:
            return cached
        # Force offline resolution when the model is already cached so this
        # load makes no HuggingFace Hub network call. MUST run before the hub
        # is imported transitively by parakeet-mlx — huggingface_hub reads
        # HF_HUB_OFFLINE at import time. Gated on is_installed inside, so a
        # fresh download is left online.
        from src.parakeet_models import disable_implicit_hf_token, maybe_enable_offline
        maybe_enable_offline(model_id)
        # Public model — never send an inherited HF token, which would 401 the
        # anonymous fetch. Must precede the parakeet-mlx import (hub reads the
        # flag at import time), same as maybe_enable_offline.
        disable_implicit_hf_token()
        try:
            from parakeet_mlx import from_pretrained
        except ImportError as e:
            raise ImportError(
                "parakeet-mlx is not installed. Run `pip install parakeet-mlx` "
                "in the venv (dev) or rebuild the PyInstaller bundle (prod)."
            ) from e
        logger.info("Loading Parakeet model: %s", model_id)
        model = from_pretrained(model_id)
        _MODEL_CACHE[model_id] = model
        logger.info("Parakeet model loaded")
        return model


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

    # Per-chunk liveness signal for the Electron inactivity watchdog. The
    # pinned parakeet-mlx calls chunk_callback(end_sample, total_samples)
    # after each window, but the signature has varied across versions —
    # accept anything and never let a mismatch raise into the decode loop.
    def _heartbeat_cb(*args, **kwargs):
        try:
            done = int(args[0]) if len(args) >= 1 else 0
            total = int(args[1]) if len(args) >= 2 else 0
        except (TypeError, ValueError):
            done, total = 0, 0
        _emit_heartbeat(done, total)

    # Probe by signature rather than catching TypeError around the call —
    # a broad catch would silently re-run an hour of GPU work (and mask a
    # genuine TypeError from inside the decode loop) on the rare version
    # without the kwarg. Losing the heartbeat is acceptable; losing (or
    # doubling) transcription is not.
    extra_kwargs = {}
    try:
        if "chunk_callback" in inspect.signature(model.transcribe).parameters:
            extra_kwargs["chunk_callback"] = _heartbeat_cb
        else:
            logger.warning("parakeet-mlx transcribe() has no chunk_callback; no heartbeat")
    except (TypeError, ValueError) as e:
        # Un-inspectable callable (C extension / odd wrapper). Transcription
        # proceeds without a heartbeat — log it, or a watchdog timeout on a
        # long meeting would be undiagnosable from the logs.
        logger.warning("Could not probe parakeet-mlx transcribe() signature (%s); no heartbeat", e)

    # Always chunk: the library merges the windows back into one AlignedResult
    # with global timestamps, so _result_to_dict is unaffected, and short files
    # (< one chunk) just transcribe in a single window for free.
    result = model.transcribe(
        str(audio_path),
        chunk_duration=PARAKEET_CHUNK_DURATION_S,
        overlap_duration=PARAKEET_CHUNK_OVERLAP_S,
        **extra_kwargs,
    )
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
