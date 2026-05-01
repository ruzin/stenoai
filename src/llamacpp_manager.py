"""
Process lifecycle for the bundled ``llama-server`` (llama.cpp) binary.

This is a *second* local inference backend alongside the existing Ollama
service. It exists because Ollama 0.17.x can't load multimodal split-GGUF
models (Gemma 4, Qwen 3.5 — see ollama/ollama#14575). llama-server can.

Patterns are mirrored from ``ollama_manager.py``:
- Detect bundled binary path (PyInstaller _MEIPASS in packaged builds, or
  the ``bin/`` dir in dev).
- Spawn detached so the Python CLI can exit without taking the runner down.
- Write a PID file so the Electron quit handler can find and SIGTERM the
  process.
- HTTP health probe on ``/health`` for readiness.

One model loads at a time. Switching to a different llamacpp-routed model
means SIGTERMing the runner and respawning with a new ``--model`` path.
"""

import logging
import os
import platform
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# llama-server listens here. Different from Ollama's 11434 so both can run
# concurrently — text-only models still go through Ollama, llama-server
# handles only the multimodal-split-GGUF cases.
LLAMACPP_PORT = 18080
LLAMACPP_BASE_URL = f"http://127.0.0.1:{LLAMACPP_PORT}"

# Tuneable: how long to wait for the runner to become ready after spawn.
# On Apple Silicon the spike loaded gemma4:e2b in ~4s; 30s is generous
# headroom for first-load model warmup on slower hardware.
DEFAULT_READY_TIMEOUT_SECONDS = 30


def _arch_subdir() -> str:
    """Return ``llamacpp-arm64`` or ``llamacpp-x64`` based on host arch."""
    machine = platform.machine().lower()
    if machine in ("arm64", "aarch64"):
        return "llamacpp-arm64"
    return "llamacpp-x64"


def get_bundled_llamacpp_dir() -> Optional[Path]:
    """
    Find the directory containing ``llama-server`` and its dylibs.

    Search order matches ``ollama_manager.get_bundled_ollama_dir`` but
    with the per-architecture subdirectory layout we use to ship both
    arm64 and x64 binaries side-by-side.
    """
    arch_dir = _arch_subdir()

    if getattr(sys, "frozen", False):
        # PyInstaller bundle.
        base_path = Path(sys._MEIPASS)
        candidate = base_path / arch_dir
        if candidate.exists():
            return candidate
        # Sibling-of-executable layout used by the COLLECT bundle.
        exe_dir = Path(sys.executable).parent
        candidate = exe_dir / arch_dir
        if candidate.exists():
            return candidate

    # Dev mode — repo-local bin/.
    repo_dir = Path(__file__).parent.parent / "bin" / arch_dir
    if repo_dir.exists():
        return repo_dir

    return None


def get_llamacpp_binary() -> Optional[Path]:
    """Return the path to the ``llama-server`` executable, or None."""
    base = get_bundled_llamacpp_dir()
    if base is None:
        return None
    binary = base / "llama-server"
    if binary.exists():
        return binary
    return None


def _llamacpp_env() -> dict:
    """Environment for the llama-server child process.

    Adds the bundled directory to DYLD_LIBRARY_PATH so the dylibs ship
    next to the binary load correctly under the macOS hardened runtime.
    The ``allow-dyld-environment-variables`` entitlement (already enabled
    in app/build/entitlements.mac.plist for Ollama) covers this.
    """
    env = os.environ.copy()
    base = get_bundled_llamacpp_dir()
    if base is not None:
        existing = env.get("DYLD_LIBRARY_PATH", "")
        env["DYLD_LIBRARY_PATH"] = (
            f"{base}:{existing}" if existing else str(base)
        )
    return env


def is_llamacpp_running(port: int = LLAMACPP_PORT) -> bool:
    """True iff ``llama-server`` answers /health on the expected port."""
    try:
        import httpx
        response = httpx.get(f"http://127.0.0.1:{port}/health", timeout=2)
        return response.status_code == 200
    except Exception:
        return False


def _get_pid_file() -> Path:
    """Where the running runner's PID is recorded."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "llamacpp.pid"
    return Path(__file__).parent.parent / "llamacpp.pid"


def _write_pid(pid: int) -> None:
    try:
        _get_pid_file().write_text(str(pid))
    except Exception as e:
        logger.debug(f"Could not write llamacpp PID file: {e}")


def _read_pid() -> Optional[int]:
    try:
        return int(_get_pid_file().read_text().strip())
    except Exception:
        return None


def _clear_pid() -> None:
    try:
        _get_pid_file().unlink(missing_ok=True)
    except Exception:
        pass


def stop_llamacpp_server() -> bool:
    """Send SIGTERM to the recorded runner PID, if any. Idempotent."""
    pid = _read_pid()
    if pid is None:
        return True
    try:
        os.kill(pid, 15)  # SIGTERM
        # Wait briefly for graceful exit; HTTP poll is the readable signal.
        for _ in range(20):
            if not is_llamacpp_running():
                _clear_pid()
                return True
            time.sleep(0.1)
        # Still up — escalate to SIGKILL.
        os.kill(pid, 9)
        time.sleep(0.5)
    except ProcessLookupError:
        # Already gone.
        pass
    except Exception as e:
        logger.warning(f"Failed to stop llama-server pid={pid}: {e}")
    _clear_pid()
    return True


def start_llamacpp_server(
    model_path: Path,
    port: int = LLAMACPP_PORT,
    ctx_size: int = 4096,
    ready_timeout: int = DEFAULT_READY_TIMEOUT_SECONDS,
    extra_args: Optional[list] = None,
) -> bool:
    """
    Spawn ``llama-server`` against ``model_path``. If a runner is already
    bound to the port, stops and restarts it (necessary for switching
    between different llamacpp-routed models).

    Returns True iff the server is healthy on the port within ``ready_timeout``.
    """
    binary = get_llamacpp_binary()
    if binary is None:
        logger.error("llama-server binary not found in bundled directory")
        return False

    if not model_path.exists():
        logger.error(f"Model file not found: {model_path}")
        return False

    # If something's already on the port, assume it's a previous runner
    # bound to a different model; tear it down before respawning.
    if is_llamacpp_running(port=port):
        logger.info("llama-server already running; restarting for new model")
        stop_llamacpp_server()

    args = [
        str(binary),
        "-m", str(model_path),
        "--port", str(port),
        "--ctx-size", str(ctx_size),
        "--no-webui",
    ]
    if extra_args:
        args.extend(extra_args)

    env = _llamacpp_env()
    logger.info(f"Spawning llama-server: {' '.join(args)}")
    try:
        proc = subprocess.Popen(
            args,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as e:
        logger.error(f"Failed to spawn llama-server: {e}")
        return False

    _write_pid(proc.pid)

    deadline = time.time() + ready_timeout
    while time.time() < deadline:
        if is_llamacpp_running(port=port):
            logger.info(f"llama-server ready on port {port}")
            return True
        # If the process exited early (bad model, port conflict, etc.),
        # bail quickly rather than waiting the full timeout.
        if proc.poll() is not None:
            logger.error(f"llama-server exited prematurely with code {proc.returncode}")
            _clear_pid()
            return False
        time.sleep(0.5)

    logger.error(f"llama-server did not become ready within {ready_timeout}s")
    return False


def get_local_models_dir() -> Path:
    """
    Where llamacpp-routed model GGUFs live on disk.

    We use the app-support tree rather than ~/.ollama so that:
    1. Ollama doesn't try to manage these files;
    2. Uninstalling the app cleans them up via the standard macOS
       Application Support deletion path;
    3. The directory is writable from a sandboxed-style packaged app.
    """
    base = Path.home() / "Library" / "Application Support" / "stenoai" / "models"
    base.mkdir(parents=True, exist_ok=True)
    return base
