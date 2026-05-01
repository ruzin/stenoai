"""
Ollama manager for bundled Ollama binary.

Handles finding and running the bundled Ollama binary that ships with StenoAI,
eliminating the need for users to install Ollama separately.
"""

import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Ollama download URL for macOS
OLLAMA_DOWNLOAD_URL = "https://github.com/ollama/ollama/releases/download/v0.16.3/ollama-darwin.tgz"


def get_bundled_ollama_dir() -> Optional[Path]:
    """
    Get the path to the bundled Ollama directory.

    Returns:
        Path to the ollama directory, or None if not found
    """
    # When running from PyInstaller bundle
    if getattr(sys, 'frozen', False):
        # PyInstaller sets _MEIPASS to the temp directory where files are extracted
        base_path = Path(sys._MEIPASS)
        ollama_dir = base_path / 'ollama'
        if ollama_dir.exists():
            return ollama_dir

        # Also check relative to executable
        exe_dir = Path(sys.executable).parent
        ollama_dir = exe_dir / 'ollama'
        if ollama_dir.exists():
            return ollama_dir

    # Development mode - check bin directory
    dev_ollama_dir = Path(__file__).parent.parent / 'bin'
    if dev_ollama_dir.exists() and (dev_ollama_dir / 'ollama').exists():
        return dev_ollama_dir

    return None


def get_ollama_binary() -> Optional[Path]:
    """
    Get the path to the Ollama binary.

    Checks in order:
    1. Bundled Ollama (in PyInstaller bundle or dev bin/)
    2. System Ollama (in PATH or common locations)

    Returns:
        Path to ollama binary, or None if not found
    """
    # Check bundled first
    bundled_dir = get_bundled_ollama_dir()
    if bundled_dir:
        ollama_path = bundled_dir / 'ollama'
        if ollama_path.exists():
            logger.info(f"Using bundled Ollama: {ollama_path}")
            return ollama_path

    # Fall back to system Ollama
    system_paths = [
        '/opt/homebrew/bin/ollama',  # Homebrew on Apple Silicon
        '/usr/local/bin/ollama',     # Homebrew on Intel
        '/usr/bin/ollama',           # System installation
    ]

    # Check PATH first
    try:
        result = subprocess.run(['which', 'ollama'], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            path = Path(result.stdout.strip())
            if path.exists():
                logger.info(f"Using system Ollama from PATH: {path}")
                return path
    except Exception:
        pass

    # Check common locations
    for path_str in system_paths:
        path = Path(path_str)
        if path.exists():
            logger.info(f"Using system Ollama: {path}")
            return path

    logger.warning("No Ollama binary found")
    return None


def get_ollama_env() -> dict:
    """
    Get environment variables needed to run bundled Ollama.

    Sets up library paths for the bundled dylibs.

    Returns:
        Dictionary of environment variables
    """
    env = os.environ.copy()

    bundled_dir = get_bundled_ollama_dir()
    if bundled_dir:
        # Add bundled directory to library path for dylibs
        ollama_dir_str = str(bundled_dir)

        # macOS uses DYLD_LIBRARY_PATH
        existing = env.get('DYLD_LIBRARY_PATH', '')
        if existing:
            env['DYLD_LIBRARY_PATH'] = f"{ollama_dir_str}:{existing}"
        else:
            env['DYLD_LIBRARY_PATH'] = ollama_dir_str

        # Also set for Metal library
        env['MLX_METAL_PATH'] = str(bundled_dir / 'mlx.metallib')

        logger.debug(f"Set DYLD_LIBRARY_PATH: {env['DYLD_LIBRARY_PATH']}")

    return env


def is_ollama_running() -> bool:
    """
    Check if Ollama server is running.

    Returns:
        True if Ollama is responding, False otherwise
    """
    try:
        import httpx
        response = httpx.get('http://127.0.0.1:11434/api/tags', timeout=2)
        return response.status_code == 200
    except Exception:
        return False



def _get_pid_file() -> Path:
    """Get the path to the Ollama PID file."""
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS) / 'ollama.pid'
    return Path(__file__).parent.parent / 'ollama.pid'


def _write_pid(pid: int) -> None:
    """Write Ollama's PID to a file so Electron can kill it on quit."""
    try:
        _get_pid_file().write_text(str(pid))
    except Exception as e:
        logger.debug(f"Could not write Ollama PID file: {e}")


def _clear_pid() -> None:
    """Remove the PID file."""
    try:
        _get_pid_file().unlink(missing_ok=True)
    except Exception:
        pass


def start_ollama_server(wait: bool = True, timeout: int = 30) -> bool:
    """
    Start the Ollama server if not already running.

    Args:
        wait: If True, wait for server to be ready
        timeout: Maximum seconds to wait for server

    Returns:
        True if server is running, False if failed to start
    """
    if is_ollama_running():
        logger.info("Ollama server is already running")
        return True

    ollama_binary = get_ollama_binary()
    if not ollama_binary:
        logger.error("Cannot start Ollama - binary not found")
        return False

    try:
        env = get_ollama_env()

        # Start Ollama server in background
        logger.info(f"Starting Ollama server: {ollama_binary}")
        proc = subprocess.Popen(
            [str(ollama_binary), 'serve'],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True  # Detach from parent process
        )
        _write_pid(proc.pid)

        if not wait:
            return True

        # Wait for server to be ready
        start_time = time.time()
        while time.time() - start_time < timeout:
            if is_ollama_running():
                logger.info("Ollama server is ready")
                return True
            time.sleep(0.5)

        logger.error(f"Ollama server did not start within {timeout} seconds")
        return False

    except Exception as e:
        logger.error(f"Failed to start Ollama server: {e}")
        return False


def run_ollama_command(args: list, timeout: int = 300) -> Tuple[bool, str, str]:
    """
    Run an Ollama CLI command.

    Args:
        args: Command arguments (e.g., ['pull', 'llama3.2:3b'])
        timeout: Command timeout in seconds

    Returns:
        Tuple of (success, stdout, stderr)
    """
    ollama_binary = get_ollama_binary()
    if not ollama_binary:
        return False, "", "Ollama binary not found"

    try:
        env = get_ollama_env()
        result = subprocess.run(
            [str(ollama_binary)] + args,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", f"Command timed out after {timeout} seconds"
    except Exception as e:
        return False, "", str(e)


def pull_model(model_name: str, progress_callback=None) -> bool:
    """
    Pull an Ollama model.

    Args:
        model_name: Name of model to pull (e.g., 'llama3.2:3b')
        progress_callback: Optional callback function for progress updates

    Returns:
        True if model was pulled successfully
    """
    # Ensure server is running
    if not start_ollama_server():
        return False

    ollama_binary = get_ollama_binary()
    if not ollama_binary:
        return False

    try:
        env = get_ollama_env()

        logger.info(f"Pulling model: {model_name}")

        # Run pull command with streaming output
        process = subprocess.Popen(
            [str(ollama_binary), 'pull', model_name],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        # Stream output
        for line in iter(process.stdout.readline, ''):
            line = line.strip()
            if line:
                logger.debug(f"Ollama pull: {line}")
                if progress_callback:
                    progress_callback(line)

        process.wait()

        if process.returncode == 0:
            logger.info(f"Successfully pulled model: {model_name}")
            return True
        else:
            logger.error(f"Failed to pull model: {model_name}")
            return False

    except Exception as e:
        logger.error(f"Error pulling model: {e}")
        return False


def list_models() -> list:
    """
    List available Ollama models.

    Returns:
        List of model names, or empty list if failed
    """
    if not is_ollama_running():
        if not start_ollama_server():
            return []

    success, stdout, stderr = run_ollama_command(['list'], timeout=10)
    if not success:
        return []

    models = []
    for line in stdout.strip().split('\n')[1:]:  # Skip header
        if line.strip():
            parts = line.split()
            if parts:
                models.append(parts[0])

    return models


def has_model(model_name: str) -> bool:
    """
    Check if a model is available locally.

    Args:
        model_name: Name of model to check

    Returns:
        True if model is available
    """
    models = list_models()
    return model_name in models


def find_installed_tag(internal_id: str) -> Optional[str]:
    """
    Check if any candidate tag for this internal ID is installed locally.

    Walks through the internal ID and its HuggingFace mirror (if any),
    returning the first tag actually present in `ollama list`. Used so a model
    pulled via the HF fallback is still recognised as installed on later runs.
    """
    from src.config import Config

    try:
        import ollama
        response = ollama.list()
        models_list = getattr(response, 'models', []) or []
        installed = [getattr(m, 'model', '') for m in models_list]
    except Exception as e:
        logger.error(f"Failed to list installed models: {e}")
        return None

    for tag in Config.get_pull_candidates(internal_id):
        if tag in installed:
            return tag
    return None


def _pull_stream(tag: str, no_progress_timeout: float = 10.0):
    """
    Stream a model pull with a per-read timeout on the underlying HTTP socket.

    The vanilla ``ollama.pull(stream=True)`` has no read timeout, so when the
    Ollama server is internally retrying a blob fetch (e.g. corporate proxy
    allows the manifest endpoint but kills blob connections), the pull-stream
    goes silent for ~60s while Ollama exhausts its 5-attempt backoff budget
    (1+2+4+8+16+32s). Setting a 10s read timeout here means we bail out as
    soon as the stream stalls, letting the fallback fire ~50s sooner.

    On healthy networks Ollama emits progress updates every ~50-100ms so the
    timeout never trips.
    """
    import httpx
    import ollama

    client = ollama.Client(timeout=httpx.Timeout(
        connect=10.0,
        read=no_progress_timeout,
        write=10.0,
        pool=10.0,
    ))
    return client.pull(tag, stream=True)


def _registry_reachable(host: str = "registry.ollama.ai", timeout: float = 3.0) -> bool:
    """
    Quick liveness check for the Ollama registry.

    Used to decide whether to even attempt the primary pull when an HF mirror
    is available. Without this, a blocked VPN forces Ollama through ~60s of
    internal exponential-backoff retries (5 attempts: 1s+2s+4s+8s+16s+32s)
    before our fallback fires. Probing first cuts that to ~3s.

    Returns True for any HTTP response below 500 (treats 401 / 404 as "host
    is reachable" — registry.ollama.ai responds 401 to unauthenticated /v2/).
    """
    try:
        import httpx
        r = httpx.head(
            f"https://{host}/v2/",
            timeout=timeout,
            follow_redirects=False,
        )
        return r.status_code < 500
    except Exception:
        return False


def pull_with_fallback(internal_id: str, progress_callback=None) -> Tuple[bool, Optional[str]]:
    """
    Pull a model via the HTTP API, falling back to its HuggingFace mirror on failure.

    The first attempt uses the canonical Ollama tag (e.g. ``llama3.2:3b``). If
    that fails (commonly because ``registry.ollama.ai`` is blocked by a corporate
    VPN), and a HuggingFace mirror is configured for this model, retry against
    ``hf.co/...`` which usually reaches ``huggingface.co`` instead.

    When a mirror is available, we also probe registry connectivity up-front
    so a blocked registry skips straight to the mirror without waiting through
    Ollama's ~60s internal retry budget.

    Args:
        internal_id: Internal model identifier (e.g. ``llama3.2:3b``).
        progress_callback: Optional callable receiving (tag, status, completed, total).

    Returns:
        (success, resolved_tag). resolved_tag is the actual Ollama tag the model
        was pulled as, which may differ from internal_id when the fallback fires.
    """
    from src.config import Config

    if not start_ollama_server():
        return False, None

    try:
        import ollama  # noqa: F401  -- imported to fail-fast if missing
    except ImportError:
        logger.error("ollama Python client not available")
        return False, None

    candidates = Config.get_pull_candidates(internal_id)

    # If a mirror exists, probe the registry first; on a blocked network this
    # saves ~60s of Ollama-internal retries before our fallback kicks in.
    if len(candidates) > 1 and not _registry_reachable():
        logger.info(
            "registry.ollama.ai not reachable in 3s — skipping primary, "
            "going straight to HF mirror"
        )
        candidates = candidates[1:]

    last_error: Optional[Exception] = None

    for idx, tag in enumerate(candidates):
        attempt_label = "primary" if idx == 0 and tag == internal_id else "HF mirror fallback"
        logger.info(f"Pulling {tag} ({attempt_label}, internal: {internal_id})")
        try:
            for progress in _pull_stream(tag):
                status = getattr(progress, 'status', '') or ''
                total = getattr(progress, 'total', 0) or 0
                completed = getattr(progress, 'completed', 0) or 0
                if progress_callback:
                    progress_callback(tag, status, completed, total)
            logger.info(f"Successfully pulled {tag}")
            return True, tag
        except Exception as e:
            last_error = e
            logger.warning(f"Pull failed for {tag}: {e}")
            if idx < len(candidates) - 1:
                logger.info(f"Trying next candidate for {internal_id}")

    logger.error(f"All pull candidates failed for {internal_id}: {last_error}")
    return False, None
