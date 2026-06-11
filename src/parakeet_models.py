"""Parakeet model registry + installer.

Mirrors ``src/whisper_models.py`` so the Settings / Setup IPC handlers
can list both engines through one shape — name, size, description,
``is_installed`` — without branching on engine in the renderer.

The active model id comes from ``src.parakeet`` which dispatches
between the MLX backend (mac) and the ONNX backend (Windows / Linux).
The user-facing name and behaviour are the same on every platform;
only the underlying HuggingFace repo (and thus the on-disk size +
cache layout) differs. Sizes here reflect the int8-quantised ONNX
encoder on Windows and the float16 MLX weights on mac.
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Callable, Optional

from src.parakeet import DEFAULT_MODEL_ID  # platform-dispatched

logger = logging.getLogger(__name__)


SUPPORTED_PARAKEET_MODELS: dict[str, dict] = {
    DEFAULT_MODEL_ID: {
        "name": "Parakeet TDT v3",
        "size": "670MB" if sys.platform != "darwin" else "572MB",
        "description": (
            "Highest quality. Supports live transcription in English "
            "and 25 European languages — Spanish, French, German, "
            "Italian, Portuguese, Dutch, Russian, Polish, Czech, and "
            "16 others."
        ),
        "speed": "very fast",
        "quality": "excellent",
    },
}


def _hf_cache_dir_for(model_id: str) -> Path:
    """HuggingFace hub cache directory for a given repo id.

    HF's on-disk layout is ``<hub>/models--<org>--<repo>/``. Resolution
    matches huggingface_hub's own precedence:

    1. ``HF_HUB_CACHE`` — newest, preferred env var.
    2. ``HUGGINGFACE_HUB_CACHE`` — older alias still honoured by HF.
    3. ``$HF_HOME/hub`` — when only the umbrella home is set.
    4. ``~/.cache/huggingface/hub`` — platform default.

    Without HF_HUB_CACHE in the precedence chain, anyone using the
    modern env var would see ``is_installed`` falsely report False even
    after a successful download.
    """
    hub_cache = (
        os.environ.get("HF_HUB_CACHE")
        or os.environ.get("HUGGINGFACE_HUB_CACHE")
    )
    if not hub_cache:
        hf_home = os.environ.get("HF_HOME")
        if hf_home:
            hub_cache = str(Path(hf_home) / "hub")
        else:
            hub_cache = str(Path.home() / ".cache" / "huggingface" / "hub")
    folder_name = "models--" + model_id.replace("/", "--")
    return Path(hub_cache) / folder_name


def is_installed(model_id: str = DEFAULT_MODEL_ID) -> bool:
    """Return True iff the model has at least one downloaded snapshot on disk.

    Checks the HuggingFace cache directly so we don't import parakeet-mlx
    (and trigger model loading) just to answer the question — Settings polls
    this on tab load and the import cost would visibly stall the UI.
    """
    cache_dir = _hf_cache_dir_for(model_id)
    snapshots = cache_dir / "snapshots"
    if not snapshots.is_dir():
        return False
    for snap in snapshots.iterdir():
        if snap.is_dir() and any(snap.iterdir()):
            return True
    return False


def maybe_enable_offline(model_id: str = DEFAULT_MODEL_ID) -> bool:
    """Force fully-offline HuggingFace resolution when the model is already
    on disk, so loading a cached model makes ZERO network calls (and can't
    hang on a flaky network). Returns whether offline mode was enabled.

    ``huggingface_hub`` reads ``HF_HUB_OFFLINE`` once, at import time, so this
    must run BEFORE the hub is first imported. The backends call it at the top
    of ``_load_model``, immediately before importing parakeet-mlx / onnx-asr,
    which is the latest-safe and only symmetric point.

    Gated on ``is_installed`` so a first-ever run (model absent) is left
    online and ``download`` proceeds normally — offline-loading a
    just-downloaded model is correct. Edge case: ``is_installed`` only checks
    that a snapshot dir is non-empty, so a corrupt/partial snapshot would read
    as installed and offline mode would then block a repair re-fetch. Low
    probability and accepted — the existing code already trusts
    ``is_installed``.

    ``setdefault`` so an operator who explicitly exported ``HF_HUB_OFFLINE=0``
    for debugging isn't overridden.
    """
    if not is_installed(model_id):
        return False
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    return True


def download(
    model_id: str = DEFAULT_MODEL_ID,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> bool:
    """Download (or no-op-load-from-cache) a Parakeet model snapshot.

    ``progress_callback`` is invoked with stage strings — ``"downloading"``
    at start and ``"loading"`` once the snapshot is on disk and we're
    warming MLX weights. Returns True on success, False on any failure
    (caller surfaces).

    We delegate to ``src.parakeet.ensure_loaded`` so download caching and
    HuggingFace hub interaction stay owned by the same module the live
    pipeline imports — no risk of two divergent code paths fetching the
    same snapshot.
    """
    if model_id not in SUPPORTED_PARAKEET_MODELS:
        logger.error("Unknown Parakeet model: %s", model_id)
        return False

    try:
        if progress_callback is not None:
            progress_callback("downloading")
        from src.parakeet import ensure_loaded
        if progress_callback is not None:
            progress_callback("loading")
        ensure_loaded(model_id)
        return True
    except Exception as e:
        logger.error("Parakeet model download/load failed: %s", e)
        return False
