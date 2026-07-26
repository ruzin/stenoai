import io
import json
import os
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from src.config import Config
from src.local_cli import (
    LocalCliError,
    _split_command_template,
    _terminate_process,
    normalize_local_cli_config,
    run_local_cli,
    validate_summary_output,
)
from src.summarizer import OllamaSummarizer


class _RecordingInput:
    def __init__(self):
        self.data = bytearray()
        self.closed = False

    def write(self, data):
        self.data.extend(data)
        return len(data)

    def flush(self):
        pass

    def close(self):
        self.closed = True


class _FakeProcess:
    def __init__(self, stdout="answer", stderr="", returncode=0, timeout=False):
        self.stdin = _RecordingInput()
        self.stdout = io.BytesIO(stdout.encode("utf-8"))
        self.stderr = io.BytesIO(stderr.encode("utf-8"))
        self.returncode = returncode
        self.timeout = timeout
        self.terminated = False
        self.killed = False

    @property
    def input(self):
        return bytes(self.stdin.data).decode("utf-8")

    def wait(self, timeout=None):
        if self.timeout and not self.terminated and not self.killed:
            raise subprocess.TimeoutExpired("local-cli", timeout)
        return self.returncode

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 143

    def kill(self):
        self.killed = True
        self.returncode = -9


class LocalCliRunnerTests(unittest.TestCase):
    TEMPLATE = "meeting-agent --mode summary"

    @staticmethod
    def _python_command(script):
        arguments = ["python", "-c", script]
        if os.name == "nt":
            return subprocess.list2cmdline(arguments)
        return shlex.join(arguments)

    def _run(self, process, prompt="private meeting context", template=None):
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process) as popen:
            result = run_local_cli(
                template or self.TEMPLATE,
                prompt,
                "My meeting command",
                timeout_seconds=42,
                resolver=lambda _executable: "/bin/meeting-agent",
            )
        return result, popen

    def test_prompt_is_sent_on_stdin_without_a_shell(self):
        process = _FakeProcess(stdout="final response\n")
        result, popen = self._run(process)

        self.assertEqual(result, "final response")
        args = popen.call_args.args[0]
        self.assertEqual(
            args,
            [
                "/bin/meeting-agent",
                "--mode",
                "summary",
            ],
        )
        self.assertEqual(process.input, "private meeting context")
        self.assertFalse(popen.call_args.kwargs["shell"])
        self.assertEqual(popen.call_args.kwargs["stdin"], subprocess.PIPE)

    def test_shell_operators_are_plain_arguments(self):
        process = _FakeProcess()
        _, popen = self._run(
            process,
            template='meeting-agent "|" another-command',
        )

        self.assertEqual(
            popen.call_args.args[0],
            [
                "/bin/meeting-agent",
                "|",
                "another-command",
            ],
        )
        self.assertEqual(process.input, "private meeting context")
        self.assertFalse(popen.call_args.kwargs["shell"])

    def test_steno_credentials_are_not_forwarded_to_cli(self):
        process = _FakeProcess()
        steno_environment = {
            "STENOAI_CLOUD_API_KEY": "cloud-secret",
            "STENOAI_ADAPTER_URL": "https://adapter.example",
            "STENOAI_ADAPTER_TOKEN": "adapter-secret",
            "AGENT_API_KEY": "cli-auth",
        }
        with mock.patch.dict("src.local_cli.os.environ", steno_environment, clear=True):
            _, popen = self._run(process)

        environment = popen.call_args.kwargs["env"]
        self.assertNotIn("STENOAI_CLOUD_API_KEY", environment)
        self.assertNotIn("STENOAI_ADAPTER_URL", environment)
        self.assertNotIn("STENOAI_ADAPTER_TOKEN", environment)
        self.assertEqual(environment["AGENT_API_KEY"], "cli-auth")

    def test_missing_cli_has_actionable_error(self):
        with self.assertRaisesRegex(LocalCliError, "not found"):
            run_local_cli(
                self.TEMPLATE,
                "prompt",
                resolver=lambda _executable: None,
            )

    def test_auth_failure_does_not_expose_stderr(self):
        process = _FakeProcess(
            stderr="Authentication required: private meeting context",
            returncode=1,
        )
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process):
            with self.assertRaises(LocalCliError) as ctx:
                run_local_cli(
                    self.TEMPLATE,
                    "private meeting context",
                    "My command",
                    resolver=lambda _executable: "/bin/meeting-agent",
                )
        self.assertIn("could not authenticate", str(ctx.exception))
        self.assertNotIn("private meeting context", str(ctx.exception))

    def test_nonzero_exit_preserves_safe_error(self):
        process = _FakeProcess(
            stderr="private diagnostic details",
            returncode=7,
        )
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process):
            with self.assertRaisesRegex(LocalCliError, "failed with exit code 7") as ctx:
                run_local_cli(
                    self.TEMPLATE,
                    "private meeting context",
                    "My command",
                    resolver=lambda _executable: "/bin/meeting-agent",
                )
        self.assertNotIn("private diagnostic details", str(ctx.exception))

    def test_timeout_terminates_process(self):
        process = _FakeProcess(returncode=None, timeout=True)
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process):
            with self.assertRaisesRegex(LocalCliError, "timed out"):
                run_local_cli(
                    self.TEMPLATE,
                    "prompt",
                    timeout_seconds=30,
                    resolver=lambda _executable: "/bin/meeting-agent",
                )
        self.assertTrue(process.terminated)

    def test_empty_stdout_is_an_error(self):
        process = _FakeProcess(stdout=" \n")
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process):
            with self.assertRaisesRegex(LocalCliError, "empty response"):
                run_local_cli(
                    self.TEMPLATE,
                    "prompt",
                    resolver=lambda _executable: "/bin/meeting-agent",
                )

    def test_oversized_stdout_is_rejected(self):
        process = _FakeProcess(stdout="x" * 2_000_001)
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process):
            with self.assertRaisesRegex(LocalCliError, "2,000,000 bytes"):
                run_local_cli(
                    self.TEMPLATE,
                    "prompt",
                    resolver=lambda _executable: "/bin/meeting-agent",
                )

    def test_stdout_flood_is_bounded_and_terminates_without_waiting_for_timeout(self):
        command = self._python_command(
            "import sys,time;"
            "sys.stdout.buffer.write(b'x'*4096);"
            "sys.stdout.buffer.flush();"
            "time.sleep(30)"
        )
        started = time.monotonic()
        with mock.patch("src.local_cli.MAX_OUTPUT_BYTES", 1024):
            with self.assertRaisesRegex(LocalCliError, "more than 1,024 bytes"):
                run_local_cli(
                    command,
                    "prompt",
                    "Flooding command",
                    timeout_seconds=30,
                    resolver=lambda _executable: sys.executable,
                )
        self.assertLess(time.monotonic() - started, 10)

    def test_stderr_flood_is_bounded_and_terminates_without_waiting_for_timeout(self):
        command = self._python_command(
            "import sys,time;"
            "sys.stderr.buffer.write(b'x'*4096);"
            "sys.stderr.buffer.flush();"
            "time.sleep(30)"
        )
        started = time.monotonic()
        with mock.patch("src.local_cli.MAX_STDERR_BYTES", 1024):
            with self.assertRaisesRegex(
                LocalCliError,
                "more than 1,024 bytes to standard error",
            ):
                run_local_cli(
                    command,
                    "prompt",
                    "Flooding command",
                    timeout_seconds=30,
                    resolver=lambda _executable: sys.executable,
                )
        self.assertLess(time.monotonic() - started, 10)

    def test_posix_termination_force_stops_remaining_process_group(self):
        process = _FakeProcess(returncode=None)
        process.pid = 1234
        with (
            mock.patch("src.local_cli.os.name", "posix"),
            mock.patch("src.local_cli.os.killpg") as kill_process_group,
        ):
            _terminate_process(process)

        self.assertEqual(
            kill_process_group.call_args_list,
            [
                mock.call(1234, signal.SIGTERM),
                mock.call(1234, signal.SIGKILL),
            ],
        )

    def test_windows_command_parsing_preserves_paths_and_quoted_arguments(self):
        self.assertEqual(
            _split_command_template(
                r"C:\tools\agent.exe --mode summary",
                platform="nt",
            ),
            [r"C:\tools\agent.exe", "--mode", "summary"],
        )
        self.assertEqual(
            _split_command_template(
                r'"C:\Program Files\Agent\agent.exe" --mode summary',
                platform="nt",
            ),
            [r"C:\Program Files\Agent\agent.exe", "--mode", "summary"],
        )
        self.assertEqual(
            _split_command_template(
                r'agent.exe --label "weekly review" --path C:\meetings\today.txt',
                platform="nt",
            ),
            [
                "agent.exe",
                "--label",
                "weekly review",
                "--path",
                r"C:\meetings\today.txt",
            ],
        )
        self.assertEqual(
            _split_command_template(
                r'agent.exe "say \"hello\"" "C:\Meeting Notes\\"',
                platform="nt",
            ),
            [
                "agent.exe",
                'say "hello"',
                "C:\\Meeting Notes\\",
            ],
        )

    def test_configuration_rejects_multiline_and_invalid_quoting(self):
        with self.assertRaisesRegex(LocalCliError, "single line"):
            normalize_local_cli_config("Agent", "agent\n--stdin", 300)
        with self.assertRaisesRegex(LocalCliError, "invalid quoting"):
            normalize_local_cli_config("Agent", 'agent --mode "summary', 300)
        with self.assertRaisesRegex(LocalCliError, "control characters"):
            normalize_local_cli_config("Agent\nspoofed", "agent --stdin", 300)

    def test_configuration_rejects_timeout_beyond_watchdog_ceiling(self):
        with self.assertRaisesRegex(LocalCliError, "between 30 and 2100"):
            normalize_local_cli_config("Agent", "agent --stdin", 2101)

    def test_summary_contract_requires_all_sections_and_content(self):
        valid = (
            "## Summary\nShipped.\n\n## Key Topics\n### Release\nReady.\n\n"
            "## Key Points\n- Friday\n\n## Action Items\n- Review"
        )
        validate_summary_output(valid)
        with self.assertRaisesRegex(LocalCliError, "Key Topics"):
            validate_summary_output("## Summary\nShipped.")
        with self.assertRaisesRegex(LocalCliError, "empty summary"):
            validate_summary_output(
                "## Summary\n\n## Key Topics\n### Release\nReady.\n\n"
                "## Key Points\n- Friday\n\n## Action Items\n- Review"
            )


class LocalCliConfigTests(unittest.TestCase):
    def test_command_is_read_from_process_environment_not_config_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "local_cli_provider": "claude",
                        "local_cli_name": "Injected",
                        "local_cli_command": "untrusted-command",
                        "local_cli_timeout_seconds": 999,
                    }
                )
            )
            config = Config(config_path=path)
            saved = json.loads(path.read_text())
            self.assertNotIn("local_cli_provider", saved)
            self.assertNotIn("local_cli_name", saved)
            self.assertNotIn("local_cli_command", saved)
            self.assertNotIn("local_cli_timeout_seconds", saved)
            with mock.patch.dict(
                "src.config.os.environ",
                {
                    "STENOAI_LOCAL_CLI_NAME": "Approved command",
                    "STENOAI_LOCAL_CLI_COMMAND": "meeting-agent --stdin",
                    "STENOAI_LOCAL_CLI_TIMEOUT_SECONDS": "900",
                },
                clear=False,
            ):
                self.assertEqual(config.get_local_cli_name(), "Approved command")
                self.assertEqual(
                    config.get_local_cli_command(),
                    "meeting-agent --stdin",
                )
                self.assertEqual(config.get_local_cli_timeout_seconds(), 900)

    def test_timeout_from_environment_is_clamped(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Config(config_path=Path(tmp) / "config.json")
            with mock.patch.dict(
                "src.config.os.environ",
                {"STENOAI_LOCAL_CLI_TIMEOUT_SECONDS": "99999"},
            ):
                self.assertEqual(config.get_local_cli_timeout_seconds(), 35 * 60)


class LocalCliSummarizerTests(unittest.TestCase):
    COMMAND = "meeting-agent --stdin"

    def _summarizer(self):
        config = mock.Mock(spec=Config)
        config.get_ai_provider.return_value = "local_cli"
        config.get_local_cli_name.return_value = "My meeting command"
        config.get_local_cli_command.return_value = self.COMMAND
        config.get_local_cli_timeout_seconds.return_value = 15 * 60
        config.get_remote_ollama_url.return_value = ""
        return OllamaSummarizer(config=config)

    def test_initialization_never_starts_ollama(self):
        with mock.patch.object(
            OllamaSummarizer,
            "_ensure_ollama_ready",
            side_effect=AssertionError("Ollama should not start"),
        ):
            summarizer = self._summarizer()
        self.assertEqual(summarizer.model_name, "My meeting command")

    def test_shared_stream_completion_routes_to_local_cli(self):
        summarizer = self._summarizer()
        with mock.patch(
            "src.summarizer.run_local_cli",
            return_value="## Summary\nCLI answer",
        ) as run:
            chunks = list(summarizer._stream_completion("assembled prompt"))

        self.assertEqual(chunks, ["## Summary\nCLI answer"])
        run.assert_called_once_with(
            self.COMMAND,
            "assembled prompt",
            "My meeting command",
            timeout_seconds=15 * 60,
        )

    def test_query_routes_to_local_cli(self):
        summarizer = self._summarizer()
        with mock.patch("src.summarizer.run_local_cli", return_value="Answer") as run:
            chunks = list(
                summarizer.query_transcript_streaming(
                    "SUMMARY:\nMeeting context",
                    "What happened?",
                )
            )

        self.assertEqual(chunks, ["Answer"])
        self.assertIn("Meeting context", run.call_args.args[1])
        self.assertIn("What happened?", run.call_args.args[1])
        self.assertEqual(run.call_args.kwargs["timeout_seconds"], 300)

    def test_query_failure_propagates_instead_of_becoming_an_answer_chunk(self):
        summarizer = self._summarizer()
        with mock.patch(
            "src.summarizer.run_local_cli",
            side_effect=LocalCliError("command failed"),
        ):
            with self.assertRaisesRegex(LocalCliError, "command failed"):
                list(
                    summarizer.query_transcript_streaming(
                        "SUMMARY:\nMeeting context",
                        "What happened?",
                    )
                )

    def test_standard_summary_rejects_an_unparseable_cli_response(self):
        summarizer = self._summarizer()
        with mock.patch(
            "src.summarizer.run_local_cli",
            return_value="This command exited successfully but returned arbitrary text.",
        ):
            with self.assertRaisesRegex(LocalCliError, "## Summary"):
                list(
                    summarizer.summarize_transcript_streaming(
                        "Alex: We will ship on Friday.",
                        duration_minutes=1,
                    )
                )

    def test_legacy_json_summary_directs_local_cli_to_streaming_path(self):
        summarizer = self._summarizer()
        with mock.patch("src.summarizer.run_local_cli") as run:
            with self.assertRaisesRegex(
                LocalCliError,
                r"use summarize_transcript_streaming\(\)",
            ):
                summarizer.summarize_transcript(
                    "Alex: We will ship on Friday.",
                    duration_minutes=1,
                )

        run.assert_not_called()
