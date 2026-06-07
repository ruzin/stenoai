"""Parakeet model registry + installer.

Mirrors ``src/whisper_models.py`` so the Settings / Setup IPC handlers
can list both engines through one shape — name, size, description,
``is_installed`` — without branching on engine in the renderer.

Parakeet TDT v3 is the only model today; a future English-only TDT v2
variant would slot in as a sibling entry here, with the same id-keyed
``is_installed`` lookup.

Downloads are not byte-quantised. ``parakeet-mlx.from_pretrained`` pulls
multiple files from the HuggingFace snapshot, and threading custom tqdm
progress through ``huggingface_hub`` isn't worth the wire complexity
for a ~600 MB one-time download — the Setup wizard already shows an
indeterminate state for the Ollama pull, so the UX is consistent.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)


DEFAULT_MODEL_ID = "mlx-community/parakeet-tdt-0.6b-v3"

SUPPORTED_PARAKEET_MODELS: dict[str, dict] = {
    DEFAULT_MODEL_ID: {
        "name": "Parakeet TDT v3",
        "size": "572MB",
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
