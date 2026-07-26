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
_PIPE_READ_CHUNK_BYTES = 64 * 1024
_PIPE_THREAD_JOIN_SECONDS = 3


class LocalCliError(RuntimeError):
    """A safe, user-facing failure from a local AI CLI invocation."""


def _split_windows_command_line(command_line: str) -> list[str]:
    """Split a command using Windows CommandLineToArgvW-style quoting rules."""
    arguments: list[str] = []
    length = len(command_line)
    index = 0

    while index < length:
        while index < length and command_line[index] in (" ", "\t"):
            index += 1
        if index >= length:
            break

        argument: list[str] = []
        in_quotes = False
        while index < length:
            if command_line[index] in (" ", "\t") and not in_quotes:
                break

            backslash_count = 0
            while index < length and command_line[index] == "\\":
                backslash_count += 1
                index += 1

            if index < length and command_line[index] == '"':
                argument.extend("\\" * (backslash_count // 2))
                if backslash_count % 2:
                    argument.append('"')
                    index += 1
                else:
                    in_quotes = not in_quotes
                    index += 1
                continue

            argument.extend("\\" * backslash_count)
            if index >= length:
                break
            if command_line[index] in (" ", "\t") and not in_quotes:
                break

            argument.append(command_line[index])
            index += 1

        if in_quotes:
            raise ValueError("No closing quotation")
        arguments.append("".join(argument))

        while index < length and command_line[index] in (" ", "\t"):
            index += 1

    return arguments


def _split_command_template(
    command_template: str,
    *,
    platform: Optional[str] = None,
) -> list[str]:
    """Split a configured command according to the target OS."""
    if (platform or os.name) == "nt":
        return _split_windows_command_line(command_template)
    return shlex.split(command_template, posix=True)


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
        tokens = _split_command_template(template)
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
    tokens = _split_command_template(template)
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
    process_has_exited = process.poll() is not None
    pid = getattr(process, "pid", None)
    if os.name == "nt" and pid:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            shell=False,
        )
        if not process_has_exited:
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        return
    elif pid:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except OSError:
            if not process_has_exited:
                process.terminate()

        if not process_has_exited:
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass

        # A parent can exit while descendants in its process group keep running
        # or retain the output pipes. Force-stop any such descendants.
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        if process.poll() is None:
            process.wait(timeout=3)
        return

    if process_has_exited:
        return

    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


class _BoundedPipeCapture:
    """Consume one binary pipe while retaining at most a fixed byte count."""

    def __init__(
        self,
        stream,
        limit: int,
        terminate_process: Callable[[], None],
    ) -> None:
        self._stream = stream
        self._limit = limit
        self._terminate_process = terminate_process
        self._chunks: list[bytes] = []
        self._size = 0
        self.exceeded = False

    def consume(self) -> None:
        try:
            while True:
                chunk = self._stream.read(_PIPE_READ_CHUNK_BYTES)
                if not chunk:
                    return
                if isinstance(chunk, str):
                    chunk = chunk.encode("utf-8", errors="replace")

                remaining = self._limit - self._size
                if remaining > 0:
                    retained = chunk[:remaining]
                    self._chunks.append(retained)
                    self._size += len(retained)
                if len(chunk) > remaining:
                    self.exceeded = True
                    self._terminate_process()
                    return
        except (OSError, ValueError):
            # Closing a pipe while stopping the child may interrupt a blocked read.
            return

    def text(self) -> str:
        return b"".join(self._chunks).decode("utf-8", errors="replace")


def _write_prompt(stream, prompt: str) -> None:
    try:
        stream.write(prompt.encode("utf-8"))
        stream.flush()
    except (BrokenPipeError, OSError, ValueError):
        pass
    finally:
        try:
            stream.close()
        except (OSError, ValueError):
            pass


def _close_pipe(stream) -> None:
    if stream is None:
        return
    try:
        stream.close()
    except (OSError, ValueError):
        pass


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

    with tempfile.TemporaryDirectory(prefix="steno-local-cli-") as cwd:
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                cwd=cwd,
                env=_sanitized_environment(),
                shell=False,
                creationflags=creationflags,
                start_new_session=os.name != "nt",
            )
        except OSError as exc:
            raise LocalCliError(f"Could not start {name}: {exc}") from exc

        termination_lock = threading.Lock()
        termination_requested = threading.Event()

        def terminate_once() -> None:
            if termination_requested.is_set():
                return
            with termination_lock:
                if termination_requested.is_set():
                    return
                termination_requested.set()
                _terminate_process(process)

        stdout_capture = _BoundedPipeCapture(
            process.stdout,
            MAX_OUTPUT_BYTES,
            terminate_once,
        )
        stderr_capture = _BoundedPipeCapture(
            process.stderr,
            MAX_STDERR_BYTES,
            terminate_once,
        )
        threads = [
            threading.Thread(
                target=stdout_capture.consume,
                name="steno-local-cli-stdout",
                daemon=True,
            ),
            threading.Thread(
                target=stderr_capture.consume,
                name="steno-local-cli-stderr",
                daemon=True,
            ),
            threading.Thread(
                target=_write_prompt,
                args=(process.stdin, prompt),
                name="steno-local-cli-stdin",
                daemon=True,
            ),
        ]
        for thread in threads:
            thread.start()

        previous_sigterm = None
        can_install_handler = threading.current_thread() is threading.main_thread()
        if can_install_handler:
            previous_sigterm = signal.getsignal(signal.SIGTERM)

            def handle_sigterm(_signum, _frame):
                terminate_once()
                raise SystemExit(143)

            signal.signal(signal.SIGTERM, handle_sigterm)

        timed_out = False
        try:
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                terminate_once()
            except KeyboardInterrupt:
                terminate_once()
                raise
        finally:
            if can_install_handler and previous_sigterm is not None:
                signal.signal(signal.SIGTERM, previous_sigterm)

            for thread in threads:
                thread.join(timeout=_PIPE_THREAD_JOIN_SECONDS)
            if any(thread.is_alive() for thread in threads):
                terminate_once()
                _close_pipe(process.stdin)
                _close_pipe(process.stdout)
                _close_pipe(process.stderr)
                for thread in threads:
                    thread.join(timeout=_PIPE_THREAD_JOIN_SECONDS)

            _close_pipe(process.stdin)
            _close_pipe(process.stdout)
            _close_pipe(process.stderr)

        stdout = stdout_capture.text()
        stderr = stderr_capture.text()

    if stdout_capture.exceeded:
        raise LocalCliError(
            f"{name} returned more than {MAX_OUTPUT_BYTES:,} bytes."
        )
    if stderr_capture.exceeded:
        raise LocalCliError(
            f"{name} wrote more than {MAX_STDERR_BYTES:,} bytes to standard error."
        )
    if timed_out:
        raise LocalCliError(f"{name} timed out after {timeout} seconds.")
    if process.returncode != 0:
        if _looks_like_auth_error(stderr):
            raise LocalCliError(
                f"{name} could not authenticate. Check its setup outside Steno."
            )
        raise LocalCliError(
            f"{name} failed with exit code {process.returncode}. "
            "Run the configured command outside Steno to check its setup."
        )

    response = stdout.strip()
    if not response:
        raise LocalCliError(f"{name} returned an empty response.")
    return response
