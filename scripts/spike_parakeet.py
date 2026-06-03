"""Parakeet TDT v3 spike — verify the model works end-to-end before we wire it
into the real pipeline. Run this two ways:

  Dev:        source venv/bin/activate && python scripts/spike_parakeet.py
  Packaged:   dist/stenoai/stenoai spike-parakeet   (after `pyinstaller stenoai.spec`)

The packaged run is the one that matters — it proves parakeet-mlx + MLX work
under PyInstaller + the hardened runtime. If dev passes but packaged fails,
that's the signal we need to find another model loader path.

What it does:
  1. Loads mlx-community/parakeet-tdt-0.6b-v3 (downloads ~600 MB on first run).
  2. Opens the default input device at 16 kHz mono.
  3. Records ~10 s and streams ~0.5 s chunks to transcribe_stream().
  4. Prints the running transcript after each chunk + final result as JSON.

Exits non-zero on any failure. Output goes to stdout as line-delimited JSON
so it's easy to eyeball or pipe through `jq`.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any

DURATION_SECONDS = 10
CHUNK_SECONDS = 0.5
MODEL_ID = "mlx-community/parakeet-tdt-0.6b-v3"


def emit(event: str, **fields: Any) -> None:
    payload = {"event": event, "t": round(time.monotonic(), 3), **fields}
    print(json.dumps(payload), flush=True)


def main() -> int:
    emit("start", model=MODEL_ID, duration_s=DURATION_SECONDS, chunk_s=CHUNK_SECONDS)

    try:
        from parakeet_mlx import from_pretrained
    except ImportError as e:
        emit("error", stage="import_parakeet", message=str(e))
        return 1

    try:
        import sounddevice as sd
        import numpy as np
    except ImportError as e:
        emit("error", stage="import_audio", message=str(e))
        return 1

    emit("loading_model")
    t0 = time.monotonic()
    try:
        model = from_pretrained(MODEL_ID)
    except Exception as e:
        emit("error", stage="load_model", message=str(e))
        return 1
    emit("model_loaded", elapsed_s=round(time.monotonic() - t0, 2))

    sr = model.preprocessor_config.sample_rate
    chunk_samples = int(sr * CHUNK_SECONDS)
    total_samples = int(sr * DURATION_SECONDS)
    emit("audio_config", sample_rate=sr, chunk_samples=chunk_samples)

    # Pull mic at the model's expected rate so we can feed chunks directly.
    # sounddevice gives us float32 numpy arrays — that's what parakeet wants.
    try:
        stream = sd.InputStream(samplerate=sr, channels=1, dtype="float32",
                                blocksize=chunk_samples)
        stream.start()
    except Exception as e:
        emit("error", stage="open_stream", message=str(e))
        return 1

    last_text = ""
    captured = 0
    try:
        with model.transcribe_stream(context_size=(256, 256)) as transcriber:
            emit("streaming_started")
            while captured < total_samples:
                frames, _overflowed = stream.read(chunk_samples)
                # Mono channel as 1-D float32 — that's the contract parakeet expects.
                chunk = np.asarray(frames, dtype=np.float32).reshape(-1)
                transcriber.add_audio(chunk)
                captured += len(chunk)

                text = (transcriber.result.text or "").strip()
                if text != last_text:
                    emit("partial", text=text)
                    last_text = text

            # Capture final state after stop. transcribe_stream's context exit
            # finalises any in-flight partial; result.sentences is the canonical
            # output once the context closes.
            result = transcriber.result
            sentences = [
                {
                    "text": s.text,
                    "start": float(getattr(s, "start", 0.0) or 0.0),
                    "end": float(getattr(s, "end", 0.0) or 0.0),
                }
                for s in (result.sentences or [])
            ]
            emit("final", text=(result.text or "").strip(), sentences=sentences)
    except Exception as e:
        emit("error", stage="streaming", message=str(e))
        return 1
    finally:
        try:
            stream.stop()
            stream.close()
        except Exception:
            pass

    emit("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
