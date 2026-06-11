"""Chunk-progress heartbeat registry shared by the ASR backends.

Long batch transcriptions are silent on stdout until they finish, which
forces the Electron side to choose between a generous fixed kill-timeout
(kills slow-but-alive work) and none at all (hangs forever on a wedged
process). The fix is a liveness signal: each backend reports per-chunk
progress through the callback registered here, and the CLI entry points
print it as ``HEARTBEAT:`` protocol lines that reset an inactivity
watchdog in app/main.js.

Lives in its own module (not ``src.parakeet``) so the backend modules
can import it at module level without a circular import — tests and
the dispatcher both import the backends, and the dispatcher imports
this too to re-export ``set_chunk_heartbeat``.

A heartbeat must never break transcription: ``_emit_heartbeat`` swallows
any exception the callback raises.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

_callback: Optional[Callable[[int, int], None]] = None


def set_chunk_heartbeat(callback: Optional[Callable[[int, int], None]]) -> None:
    """Register (or clear, with ``None``) the chunk-progress callback.

    The callback receives ``(done, total)`` — unit depends on the backend
    (windows for ONNX, samples for MLX). Callers only use it as a liveness
    signal, so the unit mismatch is intentional and harmless.
    """
    global _callback
    _callback = callback


def _emit_heartbeat(done: int, total: int) -> None:
    """Invoke the registered callback, swallowing any exception it raises."""
    cb = _callback
    if cb is None:
        return
    try:
        cb(done, total)
    except Exception:
        logger.debug("chunk heartbeat callback raised; ignoring", exc_info=True)
