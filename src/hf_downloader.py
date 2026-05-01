"""
Direct GGUF download from HuggingFace for the llamacpp-routed backend.

Why not ``huggingface_hub``: shipping yet another dependency for what's
fundamentally an HTTP GET-with-resume is overkill. The public file
endpoint at ``https://huggingface.co/<repo>/resolve/main/<filename>``
accepts a Range header and behaves like a regular static-file server.

This is *only* used for models routed through the llama.cpp backend
(currently Gemma 4 and Qwen 3.5). Models that route through Ollama keep
using ``ollama_manager.pull_with_fallback`` which goes through Ollama's
registry API.
"""

import logging
import re
import time
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# Total transfer timeout caps a stuck download. Independent of the
# read-byte timeout below.
DOWNLOAD_TIMEOUT_SECONDS = 60 * 60  # 1 hour

# How long without bytes flowing before we treat the connection as dead
# and either resume or abort. 30s is the same threshold a flaky-network
# user would tolerate; the resume path is cheap so this is forgiving.
READ_TIMEOUT_SECONDS = 30

# Resume retry budget when the connection drops mid-transfer.
MAX_RESUME_ATTEMPTS = 5


def _safe_subdir(repo: str) -> str:
    """Sanitise an HF repo name (``user/repo``) into a filesystem dir name."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", repo)


def model_target_path(repo: str, filename: str, base_dir: Path) -> Path:
    """
    Where a downloaded GGUF file lives on disk.

    Layout: ``<base_dir>/<repo_safe>/<filename>``. Mirroring the
    ``user_repo`` namespacing from HF avoids collisions when multiple
    repos publish files with the same name.
    """
    return base_dir / _safe_subdir(repo) / filename


def is_model_downloaded(repo: str, filename: str, base_dir: Path) -> bool:
    """
    True iff the GGUF for this model is fully present on disk.

    "Fully present" means the file exists and is non-empty. We do NOT
    verify hashes here — the in-flight Range-resume logic handles
    partial files separately by examining the on-disk size against the
    Content-Length advertised by HF.
    """
    target = model_target_path(repo, filename, base_dir)
    return target.exists() and target.stat().st_size > 0


def _hf_resolve_url(repo: str, filename: str, revision: str = "main") -> str:
    """The canonical 'resolve' URL HF serves files from."""
    return f"https://huggingface.co/{repo}/resolve/{revision}/{filename}"


ProgressCallback = Callable[[int, int], None]
"""``progress_callback(bytes_so_far, total_bytes)``"""


def download_gguf(
    repo: str,
    filename: str,
    base_dir: Path,
    progress_callback: Optional[ProgressCallback] = None,
    revision: str = "main",
) -> Path:
    """
    Download ``filename`` from HuggingFace ``repo`` into ``base_dir``.

    Resumes partially-downloaded files via HTTP Range. Retries on
    transient connection failures up to ``MAX_RESUME_ATTEMPTS`` times.
    Raises on permanent failure (404, 401 for gated repos, exhausted
    retries).

    Returns the path to the fully-downloaded file.
    """
    import httpx

    target = model_target_path(repo, filename, base_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    url = _hf_resolve_url(repo, filename, revision)
    partial = target.with_suffix(target.suffix + ".partial")

    logger.info(f"Downloading {repo}/{filename} -> {target}")

    # Determine total size up front so progress callbacks have a
    # denominator and we know when we're done.
    timeout = httpx.Timeout(connect=10.0, read=READ_TIMEOUT_SECONDS,
                            write=10.0, pool=10.0)
    head = httpx.head(url, timeout=timeout, follow_redirects=True)
    head.raise_for_status()
    total = int(head.headers.get("Content-Length", "0"))
    if total == 0:
        # HF should always provide Content-Length; if missing we fall
        # back to "stream and hope" without a progress denominator.
        logger.warning(f"No Content-Length for {url}; progress unknown")

    attempt = 0
    while attempt < MAX_RESUME_ATTEMPTS:
        attempt += 1
        existing = partial.stat().st_size if partial.exists() else 0
        if total and existing >= total:
            # Already complete; just promote to final name.
            partial.rename(target)
            if progress_callback:
                progress_callback(total, total)
            return target

        headers = {}
        if existing:
            headers["Range"] = f"bytes={existing}-"
            logger.info(f"Resuming from byte {existing} (attempt {attempt})")

        try:
            with httpx.stream("GET", url, headers=headers, timeout=timeout,
                              follow_redirects=True) as response:
                # 200 = full, 206 = partial; both fine. Anything else is
                # either an HF-side problem (404, 5xx) or an auth gate
                # (401, 403) we can't paper over.
                if response.status_code not in (200, 206):
                    response.raise_for_status()

                # On a 200 (server ignored Range), restart from zero.
                if response.status_code == 200 and existing > 0:
                    logger.info("Server returned 200 to Range request; restarting")
                    existing = 0
                    partial.write_bytes(b"")

                mode = "ab" if existing else "wb"
                with open(partial, mode) as f:
                    bytes_so_far = existing
                    for chunk in response.iter_bytes(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        f.write(chunk)
                        bytes_so_far += len(chunk)
                        if progress_callback and total:
                            progress_callback(bytes_so_far, total)

            # If we got here, the stream ended normally. Verify size.
            final_size = partial.stat().st_size
            if total and final_size != total:
                logger.warning(
                    f"Size mismatch after stream end: {final_size}/{total}; will resume"
                )
                # Don't promote; loop and resume.
                continue

            partial.rename(target)
            return target

        except (httpx.ReadTimeout, httpx.ConnectError, httpx.RemoteProtocolError) as e:
            logger.warning(f"Transient error on attempt {attempt}: {e}; retrying")
            # Exponential-ish backoff; 1s, 2s, 4s, 8s, 16s.
            time.sleep(min(2 ** (attempt - 1), 16))
            continue

    raise RuntimeError(
        f"Failed to download {repo}/{filename} after {MAX_RESUME_ATTEMPTS} attempts"
    )
