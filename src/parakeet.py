"""Parakeet TDT v3 ASR via MLX.

Single ASR engine for the app — replaces the whisper.cpp path. Exposes two
interfaces that share one underlying model:

* ``transcribe_file(path, language)`` — batch mode; the entire transcribe →
  segments → final text pipeline.
* ``StreamingSession`` — context manager for live mic input. Push float32
  chunks via ``push(chunk)``; iterate ``drain()`` for new finalised
  sentences and the trailing partial.

The model is loaded lazily on first use and cached at module scope so the
record-streaming CLI doesn't reload it on every invocation. parakeet-mlx
caches the weights under ``~/.cache/huggingface/`` via ``from_pretrained``.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

# Multilingual TDT v3 — covers the 25 European languages Parakeet supports
# at 0.6B params. The only model the app currently surfaces; if we ever add
# an English-only variant for speed it'd be a sibling entry, not a swap.
DEFAULT_MODEL_ID = "mlx-community/parakeet-tdt-0.6b-v3"

# Streaming context size in encoder frames. (left, right). 256 each ≈ ~10 s
# of left context and ~10 s right lookahead. parakeet-mlx's streaming
# transcriber re-decodes within this window as new audio arrives, which is
# what lets the trailing partial stabilise into a final sentence.
STREAM_CONTEXT = (256, 256)

_MODEL = None
_MODEL_LOCK = threading.Lock()


def _load_model(model_id: str):
    """Lazily load (and cache) the Parakeet model. Returns the model object.

    Raises ImportError if parakeet-mlx isn't available — caller decides how
    to surface that (CLI prints a friendly error, the recorder process exits
    before opening the audio stream).
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
    """Return the sample rate the model expects (used to configure the mic)."""
    m = _load_model(model_id)
    return int(m.preprocessor_config.sample_rate)


@dataclass(frozen=True)
class Segment:
    """A single transcribed segment — either a finalised sentence or a
    trailing partial. ``start`` and ``end`` are in seconds relative to the
    start of the stream (or file)."""

    text: str
    start: float
    end: float
    is_final: bool


def _segments_from_sentences(sentences) -> list[Segment]:
    """Convert parakeet-mlx AlignedSentence objects to our ``Segment`` type.

    The last sentence is always treated as the in-flight partial — it may be
    revised on the next ``push``. All earlier sentences are stable.
    """
    if not sentences:
        return []
    out: list[Segment] = []
    last_idx = len(sentences) - 1
    for i, s in enumerate(sentences):
        text = (getattr(s, "text", "") or "").strip()
        if not text:
            continue
        start = float(getattr(s, "start", 0.0) or 0.0)
        end = float(getattr(s, "end", 0.0) or 0.0)
        out.append(Segment(text=text, start=start, end=end, is_final=(i != last_idx)))
    return out


# ---------------------------------------------------------------------------
# Batch
# ---------------------------------------------------------------------------

def transcribe_file(
    audio_path: Path,
    language: Optional[str] = None,
    model_id: str = DEFAULT_MODEL_ID,
) -> dict:
    """Transcribe a WAV file end-to-end.

    Returns a dict matching the shape the existing transcriber pipeline
    expects: ``text``, ``segments`` (list of ``{text, start, end}``),
    ``duration_seconds``, ``detected_language``, ``detected_language_probability``.

    ``language`` is currently accepted for forward compatibility — Parakeet
    TDT v3 is multilingual and language-agnostic at inference time, so the
    arg is logged but not enforced. We surface the value the caller passed
    in ``detected_language`` when it's a concrete code (not "auto").
    """
    if not audio_path.exists():
        logger.error("Audio file not found: %s", audio_path)
        return {"text": None, "segments": [], "duration_seconds": None,
                "detected_language": None, "detected_language_probability": None}

    model = _load_model(model_id)
    logger.info("Transcribing (batch): %s", audio_path)
    result = model.transcribe(str(audio_path))

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


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------

class StreamingSession:
    """Live ASR over a chunk-fed float32 mic stream.

    Usage:

        with StreamingSession() as s:
            while recording:
                chunk = mic.read(...)
                s.push(chunk)
                for seg in s.drain():
                    emit(seg)

    The trailing partial is re-emitted (with ``is_final=False``) every time
    its text changes. Once a newer sentence appears after it, the previous
    partial is promoted to ``is_final=True`` and the new tail becomes the
    next partial. Callers should treat partials as overwrite-the-last-line
    UI updates and finals as append-only.
    """

    def __init__(self, model_id: str = DEFAULT_MODEL_ID,
                 context_size: tuple[int, int] = STREAM_CONTEXT):
        self._model = _load_model(model_id)
        self._context_size = context_size
        self._ctx = None
        self._transcriber = None
        self._emitted_finals: int = 0
        self._last_partial_text: str = ""

    def __enter__(self) -> "StreamingSession":
        self._ctx = self._model.transcribe_stream(context_size=self._context_size)
        self._transcriber = self._ctx.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._ctx is not None:
            self._ctx.__exit__(exc_type, exc, tb)
            self._ctx = None
            self._transcriber = None

    @property
    def sample_rate(self) -> int:
        return int(self._model.preprocessor_config.sample_rate)

    def push(self, chunk) -> None:
        """Feed a float32 mono chunk at ``sample_rate``. Safe to call with
        arbitrary chunk sizes — parakeet-mlx buffers internally.

        ``chunk`` may be either an ``mx.array`` or a numpy float32 array;
        callers commonly have numpy in hand (sounddevice gives numpy). We
        coerce here because parakeet-mlx's internal ``mx.concat`` will
        otherwise fail with an opaque "incompatible function arguments"
        when its audio buffer ends up mixed-type.
        """
        if self._transcriber is None:
            raise RuntimeError("StreamingSession used outside `with` block")
        try:
            import mlx.core as mx  # local: keep module-level import light
        except ImportError as e:
            raise RuntimeError("mlx is not installed") from e
        if not isinstance(chunk, mx.array):
            chunk = mx.array(chunk)
        self._transcriber.add_audio(chunk)

    def drain(self) -> Iterator[Segment]:
        """Yield any new segments since the last call.

        Emits previously-unfinalised sentences as ``is_final=True`` (in
        order), then optionally the trailing partial if its text changed
        since the last drain.
        """
        if self._transcriber is None:
            return
        sentences = list(getattr(self._transcriber.result, "sentences", None) or [])
        # All but the trailing sentence are stable — anything past
        # ``_emitted_finals`` we haven't yet sent as final.
        stable_count = max(0, len(sentences) - 1)
        for i in range(self._emitted_finals, stable_count):
            s = sentences[i]
            text = (getattr(s, "text", "") or "").strip()
            if not text:
                continue
            yield Segment(
                text=text,
                start=float(getattr(s, "start", 0.0) or 0.0),
                end=float(getattr(s, "end", 0.0) or 0.0),
                is_final=True,
            )
        self._emitted_finals = stable_count

        if sentences:
            tail = sentences[-1]
            tail_text = (getattr(tail, "text", "") or "").strip()
            if tail_text and tail_text != self._last_partial_text:
                self._last_partial_text = tail_text
                yield Segment(
                    text=tail_text,
                    start=float(getattr(tail, "start", 0.0) or 0.0),
                    end=float(getattr(tail, "end", 0.0) or 0.0),
                    is_final=False,
                )

    def finalize(self) -> Iterator[Segment]:
        """Call once after the last ``push`` to promote the trailing partial
        to final. Safe to call inside the ``with`` block before exit."""
        if self._transcriber is None:
            return
        sentences = list(getattr(self._transcriber.result, "sentences", None) or [])
        for i in range(self._emitted_finals, len(sentences)):
            s = sentences[i]
            text = (getattr(s, "text", "") or "").strip()
            if not text:
                continue
            yield Segment(
                text=text,
                start=float(getattr(s, "start", 0.0) or 0.0),
                end=float(getattr(s, "end", 0.0) or 0.0),
                is_final=True,
            )
        self._emitted_finals = len(sentences)
        self._last_partial_text = ""
