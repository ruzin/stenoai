"""Parakeet TDT v3 ASR via ONNX Runtime.

Cross-platform sibling of ``_parakeet_mlx``. Uses ``onnx-asr`` to run
the istupakov/parakeet-tdt-0.6b-v3-onnx weights with the int8-quantised
encoder so the bundle size stays comparable to the MLX path (~670 MB
model vs ~600 MB for MLX), and pure CPU so Windows alpha testers
without an NVIDIA GPU get the same behaviour as anyone else.

Public surface matches ``_parakeet_mlx`` so the platform dispatcher in
``src.parakeet`` can swap us in transparently — the live consumer in
simple_recorder.py and the batch caller in src.transcriber.py do not
branch on engine.

A few intentional differences from the MLX path:

* Partials are supported (``SUPPORTS_PARTIALS = True``). onnx-asr's CPU
  inference is fast enough on a modern x86 CPU to keep up with the live
  consumer's 400 ms cadence; the trailing-window re-decode pattern in
  simple_recorder.py already throttles this to a fixed cost per call.
* Sentence-level segments are reconstructed from the model's
  token-level timestamps by grouping on sentence-ending punctuation
  and trailing whitespace boundaries. MLX's parakeet-mlx exposes
  ``result.sentences`` directly; onnx-asr's ``TimestampedResult`` only
  surfaces tokens + per-token start/end times, so we grouping is done
  in ``_result_to_dict``.
"""

from __future__ import annotations

import logging
import re
import threading
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# istupakov's canonical ONNX export of NVIDIA's Parakeet TDT v3 0.6B model.
# Same architecture and capabilities as the MLX variant — multilingual,
# 25 European languages. The "-onnx" suffix is part of the HF repo id.
DEFAULT_MODEL_ID = "istupakov/parakeet-tdt-0.6b-v3-onnx"

# onnx-asr exposes this id under a built-in alias ("nemo-parakeet-tdt-0.6b-v3")
# so we don't have to manage the HF download separately. The alias resolves to
# the same istupakov repo above.
_ONNX_ASR_ALIAS = "nemo-parakeet-tdt-0.6b-v3"

# Use the int8-quantised encoder. The fp32 encoder is ~2.4 GB on disk; int8 is
# ~650 MB with negligible WER impact (<0.5% on Open ASR Leaderboard). Shipping
# fp32 would balloon the Windows installer by 2 GB for no real quality gain.
_QUANTIZATION = "int8"

# Live partials are viable on CPU — see module docstring.
SUPPORTS_PARTIALS = True

# Parakeet TDT v3 expects 16 kHz mono input regardless of backend.
_SAMPLE_RATE = 16000

# (text-only, with-timestamps) pair, keyed by model_id. Two adapter objects
# wrap the same underlying ORT session — onnx-asr's adapter is lightweight,
# the heavy weight lives in the session. Avoiding a single adapter means we
# can serve the live partial path (text-only is marginally faster) and the
# batch path (needs token timestamps for segments) without re-creating
# either on every call.
_MODEL_CACHE: dict[str, tuple[Any, Any]] = {}
_MODEL_LOCK = threading.Lock()


def _load_model(model_id: str) -> tuple[Any, Any]:
    """Lazily load (and cache) the ONNX Parakeet adapter pair for a model id.

    Returns ``(text_model, timestamped_model)``. Both wrap the same ORT
    session; only the result-shaping differs. CPU-only — we set the
    provider explicitly so onnx-asr doesn't try CUDA/DML and emit a
    confusing warning when those aren't present.

    Raises ImportError if onnx-asr isn't available — caller decides how
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
        # load makes no HuggingFace Hub network call. MUST run before onnx-asr
        # (and thus huggingface_hub) is imported — HF_HUB_OFFLINE is read at
        # import time. Gated on is_installed inside, so a fresh download is
        # left online.
        from src.parakeet_models import maybe_enable_offline
        maybe_enable_offline(model_id)
        try:
            import onnx_asr
        except ImportError as e:
            raise ImportError(
                "onnx-asr is not installed. Run `pip install onnx-asr[cpu,hub]` "
                "in the venv (dev) or rebuild the PyInstaller bundle (prod)."
            ) from e
        logger.info("Loading Parakeet (ONNX) model: %s [int8, CPU]", model_id)
        text_model = onnx_asr.load_model(
            _ONNX_ASR_ALIAS,
            quantization=_QUANTIZATION,
            providers=["CPUExecutionProvider"],
        )
        ts_model = text_model.with_timestamps()
        _MODEL_CACHE[model_id] = (text_model, ts_model)
        logger.info("Parakeet (ONNX) model loaded")
        return _MODEL_CACHE[model_id]


def model_sample_rate(model_id: str = DEFAULT_MODEL_ID) -> int:
    """Sample rate the model expects (used to configure the mic + VAD).

    Parakeet TDT v3 is hard-pinned to 16 kHz mono on every backend, so
    we return the constant rather than touching the model — avoids a
    cold-import + load just to answer this question at startup.
    """
    return _SAMPLE_RATE


def ensure_loaded(model_id: str = DEFAULT_MODEL_ID) -> None:
    """Pre-load the model on a background thread.

    Mirrors ``_parakeet_mlx.ensure_loaded``. The first transcribe call
    pays the warm-load cost (~2 s for ONNX session init + int8 encoder
    mmap; ~30 s on first ever run when the snapshot still has to
    download from HuggingFace).
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
    """Transcribe a WAV file end-to-end.

    Returns the shape the existing pipeline expects: ``text``,
    ``segments`` (list of ``{text, start, end}``), ``duration_seconds``,
    ``detected_language``, ``detected_language_probability``.

    ``language`` is accepted for forward compatibility — Parakeet TDT v3
    is multilingual and language-agnostic at inference time. We surface
    the value the caller passed in ``detected_language`` when concrete.
    """
    if not audio_path.exists():
        logger.error("Audio file not found: %s", audio_path)
        return _empty_result()

    _, ts_model = _load_model(model_id)
    logger.info("Transcribing (batch file): %s", audio_path)
    # onnx-asr accepts a path string or numpy array for `waveform`; we pass
    # the string so it handles the file open + resample to 16 kHz internally.
    result = ts_model.recognize(str(audio_path), sample_rate=_SAMPLE_RATE)
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

    Hot path for the live VAD-gated consumer — both throttled partials
    and per-utterance finals call this on speech buffers that already
    live in memory.

    ``samples_16k`` may be a numpy float32 array (mono) or any sequence
    onnx-asr can interpret as one. The live consumer always passes
    numpy.
    """
    import numpy as np

    text_model, _ = _load_model(model_id)
    arr = np.asarray(samples_16k, dtype=np.float32).reshape(-1)
    # Sub-100 ms inputs are below ONNX's minimum feasible frame count and
    # produce empty/garbage output. Bail early — mirrors the MLX path.
    if arr.shape[0] < (_SAMPLE_RATE // 10):
        return _empty_result()
    # Use the text-only adapter for partials — timestamps aren't read by
    # the live consumer and skipping them shaves a small amount of CPU.
    result = text_model.recognize(arr, sample_rate=_SAMPLE_RATE)
    # text_model returns a TextResult (just text). Wrap to the dict shape.
    text = _extract_text(result)
    return {
        "text": text or None,
        "segments": [],
        "duration_seconds": float(arr.shape[0]) / _SAMPLE_RATE,
        "detected_language": language if (language and language != "auto") else None,
        "detected_language_probability": None,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Sentence-boundary punctuation. Same set for all Parakeet languages — the
# model emits ASCII punctuation even for Cyrillic/Greek output, so we don't
# need locale-aware sentence splitters here.
_SENTENCE_END = re.compile(r"[.!?]+")


def _extract_text(result: Any) -> str:
    """Pull a plain text string out of any onnx-asr result type.

    ``TextResult`` exposes ``.text``; ``TimestampedResult`` likewise.
    Some onnx-asr versions return a bare string directly. Be permissive
    so a library bump doesn't quietly break the live path.
    """
    if isinstance(result, str):
        return result.strip()
    text = getattr(result, "text", None)
    if isinstance(text, str):
        return text.strip()
    return ""


def _result_to_dict(result: Any, language: Optional[str]) -> dict:
    """Convert a TimestampedResult into the pipeline's expected dict shape.

    onnx-asr's TimestampedResult exposes ``text`` plus parallel
    ``tokens`` / ``timestamps`` lists. We reconstruct sentence-level
    segments by walking tokens and cutting on sentence-ending
    punctuation, so downstream callers (diarisation, summarisation)
    get the same ``{text, start, end}`` shape parakeet-mlx returns
    via ``result.sentences``.
    """
    text = _extract_text(result)
    tokens = list(getattr(result, "tokens", None) or [])
    timestamps = list(getattr(result, "timestamps", None) or [])

    segments = _group_tokens_into_sentences(tokens, timestamps)
    duration = segments[-1]["end"] if segments else None
    if duration is None and timestamps:
        # Fall back to last token's end time when we couldn't group cleanly.
        last_ts = timestamps[-1]
        duration = float(_ts_end(last_ts))

    detected_language = language if (language and language != "auto") else None
    return {
        "text": text or None,
        "segments": segments,
        "duration_seconds": duration,
        "detected_language": detected_language,
        "detected_language_probability": None,
    }


def _ts_start(ts: Any) -> float:
    """Normalise a single timestamp entry to a float start time.

    onnx-asr timestamps come through as ``(start, end)`` tuples in
    current releases; tolerate dict or object shapes too in case the
    API tightens later.
    """
    if isinstance(ts, (tuple, list)) and len(ts) >= 1:
        return float(ts[0] or 0.0)
    if isinstance(ts, dict):
        return float(ts.get("start", 0.0) or 0.0)
    return float(getattr(ts, "start", 0.0) or 0.0)


def _ts_end(ts: Any) -> float:
    if isinstance(ts, (tuple, list)) and len(ts) >= 2:
        return float(ts[1] or 0.0)
    if isinstance(ts, dict):
        return float(ts.get("end", ts.get("start", 0.0)) or 0.0)
    return float(getattr(ts, "end", getattr(ts, "start", 0.0)) or 0.0)


def _group_tokens_into_sentences(tokens: list, timestamps: list) -> list[dict]:
    """Walk paired (token, timestamp) entries, cut on sentence-ending
    punctuation, emit ``{text, start, end}`` dicts.

    If tokens and timestamps lengths don't agree (defensive — newer
    onnx-asr versions may insert a leading <eos> token without a
    timestamp), we fall back to a single whole-utterance segment so
    callers still get something usable.
    """
    if not tokens or not timestamps or len(tokens) != len(timestamps):
        return _fallback_segment(tokens, timestamps)

    segments: list[dict] = []
    current_tokens: list[str] = []
    current_start: Optional[float] = None
    current_end: float = 0.0

    for tok, ts in zip(tokens, timestamps):
        tok_str = tok if isinstance(tok, str) else str(tok)
        if not tok_str:
            continue
        start = _ts_start(ts)
        end = _ts_end(ts)
        if current_start is None:
            current_start = start
            # Seed current_end from the segment start so a segment whose tokens
            # all carry end==0.0 (unrecognised timestamp shape) never emits an
            # end < start span to diarisation/summarisation.
            current_end = start
        current_tokens.append(tok_str)
        current_end = end if end > current_end else current_end
        if _SENTENCE_END.search(tok_str):
            text = "".join(current_tokens).strip()
            if text:
                segments.append({"text": text, "start": current_start, "end": current_end})
            current_tokens = []
            current_start = None
            current_end = 0.0

    # Tail: tokens after the last sentence-ending punctuation become one
    # final segment so they're not silently dropped.
    if current_tokens and current_start is not None:
        text = "".join(current_tokens).strip()
        if text:
            segments.append({"text": text, "start": current_start, "end": current_end})

    return segments


def _fallback_segment(tokens: list, timestamps: list) -> list[dict]:
    """Build a single segment spanning the whole utterance when token-level
    grouping isn't possible (mismatched lengths, empty timestamps).

    Better than returning an empty segments list — the diarisation /
    summarisation pipeline still gets a usable transcript with rough
    start/end bounds.
    """
    if not tokens:
        return []
    text = "".join(tok if isinstance(tok, str) else str(tok) for tok in tokens).strip()
    if not text:
        return []
    start = _ts_start(timestamps[0]) if timestamps else 0.0
    end = _ts_end(timestamps[-1]) if timestamps else 0.0
    return [{"text": text, "start": start, "end": end}]


def _empty_result() -> dict:
    return {
        "text": None,
        "segments": [],
        "duration_seconds": None,
        "detected_language": None,
        "detected_language_probability": None,
    }
