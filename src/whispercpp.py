"""Whisper.cpp ASR shim for the live VAD-gated pipeline.

Mirrors ``src.parakeet``'s public surface — ``transcribe_samples`` /
``ensure_loaded`` / ``model_sample_rate`` — so the live consumer in
``simple_recorder.py`` can dispatch to either engine without knowing
which is active. Engine selection is config-driven; see
``Config.get_transcription_engine``.

Why this exists separately from ``src.transcriber.WhisperTranscriber``:
that class owns the post-stop file-based pipeline (stereo split,
ffmpeg 16 kHz conversion, hallucination dedup). The live consumer
already operates on in-memory float32 at 16 kHz mono, so it doesn't need
any of that — just the smallest possible "samples in, dict out" call.

``SUPPORTS_PARTIALS = False`` is the load-bearing flag: re-transcribing
a growing speech buffer every 400 ms on whisper.cpp dominates decode
time even with the small model, so the live consumer skips the partial
pass for this engine and emits text only on Silero's SpeechEnd. Same
final-only UX Meetily and OpenOats use for Whisper. The Parakeet path
keeps partials because in-memory MLX inference on Apple Silicon is
fast enough.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Whisper.cpp expects 16 kHz mono float32. Silero VAD is also 16 kHz,
# so the live pipeline upstream already delivers samples at this rate.
SAMPLE_RATE = 16000

SUPPORTS_PARTIALS = False

_MODEL_CACHE: dict[str, object] = {}
_MODEL_LOCK = threading.Lock()


def _load_model(model_name: str):
    """Lazily load + cache a pywhispercpp Model by name.

    Raises ImportError if pywhispercpp isn't available — caller decides
    how to surface that (the live consumer maps it to LIVE_ERROR).
    """
    cached = _MODEL_CACHE.get(model_name)
    if cached is not None:
        return cached
    with _MODEL_LOCK:
        cached = _MODEL_CACHE.get(model_name)
        if cached is not None:
            return cached
        try:
            from pywhispercpp.model import Model
        except ImportError as e:
            raise ImportError(
                "pywhispercpp is not installed. Run `pip install -r requirements.txt` "
                "in the venv (dev) or rebuild the PyInstaller bundle (prod)."
            ) from e
        import multiprocessing
        # Matches src.transcriber._load_whisper_cpp — leave two cores for
        # the audio thread + main loop so a long final doesn't starve the
        # VAD callback path.
        n_threads = max(1, multiprocessing.cpu_count() - 2)
        logger.info("Loading whisper.cpp model: %s (threads=%d)", model_name, n_threads)
        model = Model(model_name, n_threads=n_threads)
        _MODEL_CACHE[model_name] = model
        logger.info("Whisper.cpp model loaded")
        return model


def _active_model_name() -> str:
    """Resolve the user-selected Whisper variant from config."""
    from src.config import get_config
    return get_config().get_whisper_model()


def model_sample_rate() -> int:
    """Sample rate the engine expects (matches parakeet.py's signature)."""
    return SAMPLE_RATE


def ensure_loaded(model_name: Optional[str] = None) -> None:
    """Pre-load the model so the first SpeechEnd doesn't pay warm-load cost.

    The live consumer calls this from ``_LiveVadPipeline.create()`` after
    announcing LIVE_READY. ``model_name`` defaults to the active config
    selection; pass an explicit name to force a specific variant.
    """
    _load_model(model_name or _active_model_name())


def transcribe_samples(
    samples_16k,
    language: Optional[str] = None,
    model_name: Optional[str] = None,
) -> dict:
    """Transcribe an in-memory float32 buffer at 16 kHz mono.

    Returns the same dict shape as ``src.parakeet.transcribe_samples`` so
    the live consumer doesn't have to branch on engine:

        {text, segments, duration_seconds,
         detected_language, detected_language_probability}

    ``language="auto"`` (or None) lets whisper.cpp run language detection
    internally on the snippet. A concrete code biases the decoder toward
    that language (matches the file-based path in ``src.transcriber``).
    """
    import numpy as np

    model = _load_model(model_name or _active_model_name())
    arr = np.asarray(samples_16k, dtype=np.float32).reshape(-1)
    # Mirrors parakeet.py's sub-100 ms guard — whisper.cpp returns no
    # segments on too-short input but we'd rather not pay the call
    # overhead just to throw the result away.
    if arr.size < int(SAMPLE_RATE * 0.1):
        return _empty_result(language)

    # Always pass language through — pywhispercpp's Model defaults its
    # language to 'en' if you don't, so "no language hint" silently means
    # "decode as English" rather than auto-detect. Passing "auto" enables
    # whisper.cpp's own language detection on the segment. Auto-detect on
    # 2-4 s VAD chunks is less reliable than a concrete code; users who
    # know the meeting language should still set it in Settings.
    transcribe_kwargs: dict = {"media": arr, "language": language or "auto"}

    try:
        segments = model.transcribe(**transcribe_kwargs)
    except Exception:
        logger.exception("Whisper.cpp transcribe failed")
        return _empty_result(language)

    if not segments:
        return _empty_result(language)

    normalised = []
    for s in segments:
        text = (getattr(s, "text", "") or "").strip()
        if not text:
            continue
        # pywhispercpp.Segment exposes t0/t1 in centiseconds (whisper.cpp's
        # native unit). Fall back to 0 if a future version renames them —
        # the live consumer doesn't actually consume per-segment times,
        # it derives start/end from the speech-buffer offsets it owns.
        t0 = float(getattr(s, "t0", 0) or 0) / 100.0
        t1 = float(getattr(s, "t1", 0) or 0) / 100.0
        normalised.append({"text": text, "start": t0, "end": t1})

    full_text = " ".join(n["text"] for n in normalised).strip()
    duration = normalised[-1]["end"] if normalised else None
    detected_language = language if (language and language != "auto") else None
    return {
        "text": full_text or None,
        "segments": normalised,
        "duration_seconds": duration,
        "detected_language": detected_language,
        "detected_language_probability": None,
    }


def _empty_result(language: Optional[str]) -> dict:
    detected_language = language if (language and language != "auto") else None
    return {
        "text": None,
        "segments": [],
        "duration_seconds": None,
        "detected_language": detected_language,
        "detected_language_probability": None,
    }
