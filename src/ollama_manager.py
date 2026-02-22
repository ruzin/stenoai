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
        subprocess.Popen(
            [str(ollama_binary), 'serve'],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True  # Detach from parent process
        )

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
