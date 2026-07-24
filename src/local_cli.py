"""Non-interactive Codex/Claude CLI adapter for meeting AI tasks.

Steno assembles the complete prompt before calling this module.  The external
CLI receives that prompt on stdin and runs from an empty temporary directory,
so it never needs a path to the user's recordings or notes.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Callable, Optional


VALID_LOCAL_CLI_PROVIDERS = ("codex", "claude")
STENO_SECRET_ENV_VARS = (
    "STENOAI_ADAPTER_TOKEN",
    "STENOAI_ADAPTER_URL",
    "STENOAI_CLOUD_API_KEY",
)


class LocalCliError(RuntimeError):
    """A safe, user-facing failure from a local AI CLI invocation."""


def _candidate_directories() -> list[Path]:
    """Return common CLI install directories missing from packaged-app PATH."""
    home = Path.home()
    candidates = [
        home / ".local" / "bin",
        home / ".npm-global" / "bin",
        home / ".volta" / "bin",
        home / ".asdf" / "shims",
        home / ".bun" / "bin",
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
    ]
    candidates.extend(sorted((home / ".nvm" / "versions" / "node").glob("*/bin")))
    candidates.extend(
        sorted((home / ".fnm" / "node-versions").glob("*/installation/bin"))
    )

    appdata = os.environ.get("APPDATA")
    localappdata = os.environ.get("LOCALAPPDATA")
    if appdata:
        candidates.append(Path(appdata) / "npm")
    if localappdata:
        candidates.extend(
            [
                Path(localappdata) / "Programs" / "Claude",
                Path(localappdata) / "Programs" / "Codex",
            ]
        )
    return candidates


def find_local_cli(provider: str) -> Optional[str]:
    """Resolve a supported CLI without invoking a shell."""
    if provider not in VALID_LOCAL_CLI_PROVIDERS:
        return None

    on_path = shutil.which(provider)
    if on_path:
        return on_path

    suffixes = ("", ".exe", ".cmd", ".bat") if os.name == "nt" else ("",)
    for directory in _candidate_directories():
        for suffix in suffixes:
            candidate = directory / f"{provider}{suffix}"
            if candidate.is_file():
                return str(candidate)
    return None


def _command(provider: str, executable: str) -> list[str]:
    if provider == "codex":
        return [
            executable,
            "exec",
            "--ignore-user-config",
            "--ephemeral",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--ignore-rules",
            "-",
        ]
    if provider == "claude":
        return [
            executable,
            "-p",
            "--tools",
            "",
            "--disable-slash-commands",
            "--no-session-persistence",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            '{"mcpServers":{}}',
            "--output-format",
            "text",
        ]
    raise LocalCliError(f"Unsupported local CLI provider: {provider}")


def _sanitized_environment() -> dict[str, str]:
    """Keep normal CLI authentication without forwarding Steno credentials."""
    environment = os.environ.copy()
    for variable in STENO_SECRET_ENV_VARS:
        environment.pop(variable, None)
    return environment


def _display_name(provider: str) -> str:
    return "Codex CLI" if provider == "codex" else "Claude CLI"


def _looks_like_auth_error(stderr: str) -> bool:
    lowered = stderr.lower()
    markers = (
        "not logged in",
        "login required",
        "authentication required",
        "authentication failed",
        "unauthorized",
        "please run",
        "api key",
    )
    return any(marker in lowered for marker in markers)


def _terminate_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return

    pid = getattr(process, "pid", None)
    if os.name == "nt" and pid:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            shell=False,
        )
    elif pid:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    else:
        process.terminate()

    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        if os.name != "nt" and pid:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.wait(timeout=3)


def run_local_cli(
    provider: str,
    prompt: str,
    timeout_seconds: int = 300,
    *,
    resolver: Callable[[str], Optional[str]] = find_local_cli,
) -> str:
    """Run a one-shot local AI CLI call and return its final text response."""
    if provider not in VALID_LOCAL_CLI_PROVIDERS:
        raise LocalCliError(f"Unsupported local CLI provider: {provider}")
    if not prompt or not prompt.strip():
        raise LocalCliError("The local CLI prompt is empty.")

    executable = resolver(provider)
    name = _display_name(provider)
    if not executable:
        raise LocalCliError(
            f"{name} was not found. Install it and run `{provider}` once in "
            "Terminal to sign in, then try again."
        )

    creationflags = 0
    if os.name == "nt":
        creationflags = (
            subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        )

    cli_prompt = prompt
    if provider == "codex":
        cli_prompt = (
            "Answer the request directly from the supplied text. Do not run "
            "commands or use tools.\n\n"
            f"{prompt}"
        )

    with tempfile.TemporaryDirectory(prefix="steno-local-cli-") as cwd:
        try:
            process = subprocess.Popen(
                _command(provider, executable),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=cwd,
                env=_sanitized_environment(),
                shell=False,
                creationflags=creationflags,
                start_new_session=os.name != "nt",
            )
        except OSError as exc:
            raise LocalCliError(f"Could not start {name}: {exc}") from exc

        previous_sigterm = None
        can_install_handler = threading.current_thread() is threading.main_thread()
        if can_install_handler:
            previous_sigterm = signal.getsignal(signal.SIGTERM)

            def handle_sigterm(_signum, _frame):
                _terminate_process(process)
                raise SystemExit(143)

            signal.signal(signal.SIGTERM, handle_sigterm)

        try:
            stdout, stderr = process.communicate(
                input=cli_prompt,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            _terminate_process(process)
            raise LocalCliError(
                f"{name} timed out after {timeout_seconds} seconds."
            ) from exc
        except KeyboardInterrupt:
            _terminate_process(process)
            raise
        finally:
            if can_install_handler and previous_sigterm is not None:
                signal.signal(signal.SIGTERM, previous_sigterm)

    if process.returncode != 0:
        if _looks_like_auth_error(stderr):
            raise LocalCliError(
                f"{name} is not signed in. Run `{provider}` in Terminal, "
                "complete sign-in, and try again."
            )
        raise LocalCliError(
            f"{name} failed with exit code {process.returncode}. Run "
            f"`{provider}` in Terminal to check its setup."
        )

    response = stdout.strip()
    if not response:
        raise LocalCliError(f"{name} returned an empty response.")
    return response
