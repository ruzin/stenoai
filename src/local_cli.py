"""Generic non-interactive CLI adapter for meeting AI tasks.

Steno assembles the complete prompt before calling this module. The configured
command runs from an empty temporary directory and receives the prompt on
standard input, so it never needs paths to recordings or notes. Commands are
always executed directly (never through an implicit shell).
"""

from __future__ import annotations

import os
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Callable, Optional


MAX_DISPLAY_NAME_LENGTH = 80
MAX_COMMAND_TEMPLATE_LENGTH = 4096
MAX_TIMEOUT_SECONDS = 35 * 60
MIN_TIMEOUT_SECONDS = 30
MAX_OUTPUT_BYTES = 2_000_000
MAX_STDERR_BYTES = 64_000
DEFAULT_DISPLAY_NAME = "Locally invoked CLI"
STENO_SECRET_ENV_VARS = (
    "STENOAI_ADAPTER_TOKEN",
    "STENOAI_ADAPTER_URL",
    "STENOAI_CLOUD_API_KEY",
    "STENOAI_LOCAL_CLI_NAME",
    "STENOAI_LOCAL_CLI_COMMAND",
    "STENOAI_LOCAL_CLI_TIMEOUT_SECONDS",
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
    if appdata:
        candidates.append(Path(appdata) / "npm")
    return candidates


def find_local_cli(executable: str) -> Optional[str]:
    """Resolve a configured executable without invoking a shell."""
    expanded = os.path.expanduser(executable)
    candidate_path = Path(expanded)
    if candidate_path.is_absolute():
        return str(candidate_path) if candidate_path.is_file() else None
    if candidate_path.parent != Path("."):
        return None

    on_path = shutil.which(expanded)
    if on_path:
        return on_path

    suffixes = ("", ".exe", ".cmd", ".bat") if os.name == "nt" else ("",)
    for directory in _candidate_directories():
        for suffix in suffixes:
            candidate = directory / f"{expanded}{suffix}"
            if candidate.is_file():
                return str(candidate)
    return None


def normalize_local_cli_config(
    display_name: str,
    command_template: str,
    timeout_seconds: int,
) -> tuple[str, str, int]:
    """Validate and normalize user-facing local CLI configuration."""
    name = (display_name or "").strip()
    template = (command_template or "").strip()

    if not name:
        raise LocalCliError("Enter a display name for the command.")
    if len(name) > MAX_DISPLAY_NAME_LENGTH:
        raise LocalCliError(
            f"The display name must be {MAX_DISPLAY_NAME_LENGTH} characters or fewer."
        )
    if any(ord(character) < 32 or ord(character) == 127 for character in name):
        raise LocalCliError("The display name cannot contain control characters.")
    if not template:
        raise LocalCliError("Enter a command that reads its prompt from standard input.")
    if len(template) > MAX_COMMAND_TEMPLATE_LENGTH:
        raise LocalCliError(
            f"The command must be {MAX_COMMAND_TEMPLATE_LENGTH} characters or fewer."
        )
    if "\x00" in template or "\n" in template or "\r" in template:
        raise LocalCliError("The command must be a single line without null bytes.")
    try:
        tokens = shlex.split(template, posix=True)
    except ValueError as exc:
        raise LocalCliError(f"The command has invalid quoting: {exc}") from exc
    if not tokens:
        raise LocalCliError("Enter an executable and its arguments.")
    try:
        timeout = int(timeout_seconds)
    except (TypeError, ValueError) as exc:
        raise LocalCliError("The timeout must be a whole number of seconds.") from exc
    if timeout < MIN_TIMEOUT_SECONDS or timeout > MAX_TIMEOUT_SECONDS:
        raise LocalCliError(
            f"The timeout must be between {MIN_TIMEOUT_SECONDS} and "
            f"{MAX_TIMEOUT_SECONDS} seconds."
        )

    return name, template, timeout


def _command(
    command_template: str,
    *,
    resolver: Callable[[str], Optional[str]] = find_local_cli,
) -> list[str]:
    """Build an argv list without shell expansion."""
    _, template, _ = normalize_local_cli_config(
        DEFAULT_DISPLAY_NAME,
        command_template,
        MIN_TIMEOUT_SECONDS,
    )
    tokens = shlex.split(template, posix=True)
    executable = resolver(tokens[0])
    if not executable:
        raise LocalCliError(
            "The configured executable was not found. Install it or use an absolute path."
        )
    return [executable, *tokens[1:]]


def validate_summary_output(output: str) -> None:
    """Require the standard Steno summary contract from a configured command."""
    required = ("Summary", "Key Topics", "Key Points", "Action Items")
    for heading in required:
        section = re.search(
            rf"(?ms)^## {re.escape(heading)}[ \t]*\r?\n(.*?)(?=^## |\Z)",
            output,
        )
        if not section:
            raise LocalCliError(
                f"The command output is missing the required '## {heading}' section."
            )
        if not section.group(1).strip():
            if heading == "Summary":
                raise LocalCliError("The command returned an empty summary section.")
            raise LocalCliError(
                f"The command returned an empty '{heading}' section."
            )


def _sanitized_environment() -> dict[str, str]:
    """Keep CLI authentication without forwarding Steno-owned credentials."""
    environment = os.environ.copy()
    for variable in STENO_SECRET_ENV_VARS:
        environment.pop(variable, None)
    return environment


def _looks_like_auth_error(stderr: str) -> bool:
    lowered = stderr.lower()
    markers = (
        "not logged in",
        "login required",
        "authentication required",
        "authentication failed",
        "unauthorized",
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
    command_template: str,
    prompt: str,
    display_name: str = DEFAULT_DISPLAY_NAME,
    timeout_seconds: int = 300,
    *,
    resolver: Callable[[str], Optional[str]] = find_local_cli,
) -> str:
    """Run a one-shot configured CLI call and return its final text response."""
    name, template, timeout = normalize_local_cli_config(
        display_name,
        command_template,
        timeout_seconds,
    )
    if not prompt or not prompt.strip():
        raise LocalCliError("The local CLI prompt is empty.")
    if "\x00" in prompt:
        raise LocalCliError("The local CLI prompt contains an unsupported null byte.")

    command = _command(template, resolver=resolver)
    creationflags = 0
    if os.name == "nt":
        creationflags = (
            subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        )

    output_too_large = False
    with (
        tempfile.TemporaryDirectory(prefix="steno-local-cli-") as cwd,
        tempfile.TemporaryFile() as stdout_sink,
        tempfile.TemporaryFile() as stderr_sink,
    ):
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=stdout_sink,
                stderr=stderr_sink,
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
            returned_stdout, returned_stderr = process.communicate(
                input=prompt,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            _terminate_process(process)
            raise LocalCliError(
                f"{name} timed out after {timeout} seconds."
            ) from exc
        except KeyboardInterrupt:
            _terminate_process(process)
            raise
        finally:
            if can_install_handler and previous_sigterm is not None:
                signal.signal(signal.SIGTERM, previous_sigterm)

        if returned_stdout is None:
            output_size = os.fstat(stdout_sink.fileno()).st_size
            output_too_large = output_size > MAX_OUTPUT_BYTES
            stdout_sink.seek(0)
            stdout = stdout_sink.read(MAX_OUTPUT_BYTES + 1).decode(
                "utf-8",
                errors="replace",
            )
        else:
            # Test doubles may return captured strings even though production
            # subprocesses write to the bounded temporary file.
            stdout = returned_stdout
            output_too_large = len(stdout.encode("utf-8")) > MAX_OUTPUT_BYTES

        if returned_stderr is None:
            stderr_sink.seek(0)
            stderr = stderr_sink.read(MAX_STDERR_BYTES).decode(
                "utf-8",
                errors="replace",
            )
        else:
            stderr = returned_stderr[:MAX_STDERR_BYTES]

    if process.returncode != 0:
        if _looks_like_auth_error(stderr):
            raise LocalCliError(
                f"{name} could not authenticate. Check its setup outside Steno."
            )
        raise LocalCliError(
            f"{name} failed with exit code {process.returncode}. "
            "Run the configured command outside Steno to check its setup."
        )

    if output_too_large:
        raise LocalCliError(
            f"{name} returned more than {MAX_OUTPUT_BYTES:,} bytes."
        )
    response = stdout.strip()
    if not response:
        raise LocalCliError(f"{name} returned an empty response.")
    return response
