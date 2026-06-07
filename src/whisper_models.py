"""Whisper model registry + downloader.

Mirrors the Ollama model UX: each entry has display name, size, and a
download path. UI calls into ``list_supported`` / ``is_installed`` and
``download_with_progress`` to stream progress while pulling models from
HuggingFace.

The keys here MUST be members of ``pywhispercpp.constants.AVAILABLE_MODELS``
(plain ``large`` is intentionally absent — pywhispercpp rejects it and the
native loader segfaults on the resulting NULL path).
"""
from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)


SUPPORTED_WHISPER_MODELS: dict[str, dict] = {
    "small": {
        "name": "Whisper Small",
        "size": "466MB",
        "description": "Balanced speed and accuracy (default)",
        "speed": "fast",
        "quality": "good",
    },
    "large-v3-turbo": {
        "name": "Whisper Large V3 Turbo",
        "size": "1.6GB",
        "description": "Best accuracy, optimised speed",
        "speed": "medium",
        "quality": "excellent",
    },
}


def get_models_dir() -> Path:
    """Return the directory pywhispercpp uses for ggml weights."""
    try:
        from pywhispercpp.constants import MODELS_DIR
        return Path(MODELS_DIR)
    except Exception:
        from platformdirs import user_data_dir
        return Path(user_data_dir("pywhispercpp")) / "models"


def model_file_path(model_name: str) -> Path:
    return get_models_dir() / f"ggml-{model_name}.bin"


def is_installed(model_name: str) -> bool:
    return model_file_path(model_name).exists()


def download_with_progress(
    model_name: str,
    progress_callback: Callable[[int, int, int], None],
) -> bool:
    """Download a whisper.cpp ggml weight file from HuggingFace.

    progress_callback receives ``(percent, downloaded_bytes, total_bytes)``
    on each percent change. Returns True on success.
    """
    if model_name not in SUPPORTED_WHISPER_MODELS:
        logger.error("Unknown whisper model: %s", model_name)
        return False

    try:
        import requests
    except ImportError:
        logger.error("requests not available — cannot download whisper model")
        return False

    models_dir = get_models_dir()
    models_dir.mkdir(parents=True, exist_ok=True)
    dest = model_file_path(model_name)
    if dest.exists():
        size = dest.stat().st_size
        progress_callback(100, size, size)
        return True

    url = (
        "https://huggingface.co/ggerganov/whisper.cpp/"
        f"resolve/main/ggml-{model_name}.bin"
    )
    # Per-process unique temp file so two concurrent downloads of the same
    # model (rare — second app instance, or a double-click before the first
    # request has registered) can't clobber each other's bytes. The losing
    # writer's tmp is cleaned up by its own exception path; whoever renames
    # first wins, the other rename overwrites atomically with identical bytes.
    tmp = dest.with_suffix(dest.suffix + f".part-{os.getpid()}-{secrets.token_hex(4)}")

    try:
        with requests.get(url, stream=True, timeout=30) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            last_pct = -1
            with open(tmp, "wb") as f:
                for chunk in resp.iter_content(chunk_size=128 * 1024):
                    if not chunk:
                        continue
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = int(downloaded * 100 / total)
                        if pct != last_pct:
                            progress_callback(pct, downloaded, total)
                            last_pct = pct
        tmp.rename(dest)
        return True
    except Exception as e:
        logger.error("Whisper model download failed: %s", e)
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        return False
