"""Parakeet TDT v3 ASR — platform dispatcher.

On Apple Silicon (darwin) this re-exports the parakeet-mlx-backed
implementation in ``_parakeet_mlx``. On everything else (Windows, Linux)
it re-exports the onnx-asr-backed implementation in ``_parakeet_onnx``.

Both backends expose the same public surface — ``transcribe_file``,
``transcribe_samples``, ``ensure_loaded``, ``model_sample_rate``,
``DEFAULT_MODEL_ID``, ``SUPPORTS_PARTIALS`` — so call sites in
simple_recorder.py and src/transcriber.py don't branch on platform.

The model id and weights differ between backends (MLX uses
``mlx-community/parakeet-tdt-0.6b-v3``; ONNX uses
``istupakov/parakeet-tdt-0.6b-v3-onnx``), but the user-facing name
("Parakeet TDT v3") and behaviour (same NVIDIA NeMo architecture,
multilingual, 16 kHz mono input) are identical. See _parakeet_mlx and
_parakeet_onnx module docstrings for backend-specific tradeoffs.
"""

from __future__ import annotations

import sys

if sys.platform == "darwin":
    from src._parakeet_mlx import (  # noqa: F401
        DEFAULT_MODEL_ID,
        SUPPORTS_PARTIALS,
        ensure_loaded,
        model_sample_rate,
        transcribe_file,
        transcribe_samples,
    )
else:
    from src._parakeet_onnx import (  # noqa: F401
        DEFAULT_MODEL_ID,
        SUPPORTS_PARTIALS,
        ensure_loaded,
        model_sample_rate,
        transcribe_file,
        transcribe_samples,
    )

__all__ = [
    "DEFAULT_MODEL_ID",
    "SUPPORTS_PARTIALS",
    "ensure_loaded",
    "model_sample_rate",
    "transcribe_file",
    "transcribe_samples",
]
