import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.config import Config
from src.local_cli import LocalCliError, run_local_cli
from src.summarizer import OllamaSummarizer


class _FakeProcess:
    def __init__(self, stdout="answer", stderr="", returncode=0, timeout=False):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode
        self.timeout = timeout
        self.input = None
        self.terminated = False
        self.killed = False

    def communicate(self, input=None, timeout=None):
        self.input = input
        if self.timeout:
            raise subprocess.TimeoutExpired("local-cli", timeout)
        return self.stdout, self.stderr

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 143

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self, timeout=None):
        return self.returncode


class LocalCliRunnerTests(unittest.TestCase):
    def _run(self, provider, process, prompt="private meeting context"):
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process) as popen:
            result = run_local_cli(
                provider,
                prompt,
                timeout_seconds=42,
                resolver=lambda _provider: f"/bin/{provider}",
            )
        return result, popen

    def test_codex_uses_ephemeral_read_only_exec_and_stdin(self):
        process = _FakeProcess(stdout="final response\n")
        result, popen = self._run("codex", process)

        self.assertEqual(result, "final response")
        self.assertIn("Do not run commands or use tools.", process.input)
        self.assertTrue(process.input.endswith("private meeting context"))
        args = popen.call_args.args[0]
        self.assertEqual(args[0:2], ["/bin/codex", "exec"])
        self.assertIn("--ignore-user-config", args)
        self.assertIn("--ephemeral", args)
        self.assertIn("--ignore-rules", args)
        self.assertEqual(args[-1], "-")
        sandbox_index = args.index("--sandbox")
        self.assertEqual(args[sandbox_index + 1], "read-only")
        self.assertFalse(popen.call_args.kwargs["shell"])
        self.assertNotIn("private meeting context", args)

    def test_claude_disables_tools_commands_and_session_persistence(self):
        process = _FakeProcess()
        _, popen = self._run("claude", process)

        args = popen.call_args.args[0]
        self.assertEqual(args[0:2], ["/bin/claude", "-p"])
        tools_index = args.index("--tools")
        self.assertEqual(args[tools_index + 1], "")
        self.assertIn("--disable-slash-commands", args)
        self.assertIn("--no-session-persistence", args)
        setting_sources_index = args.index("--setting-sources")
        self.assertEqual(args[setting_sources_index + 1], "")
        self.assertIn("--strict-mcp-config", args)

    def test_steno_credentials_are_not_forwarded_to_cli(self):
        process = _FakeProcess()
        steno_environment = {
            "STENOAI_CLOUD_API_KEY": "cloud-secret",
            "STENOAI_ADAPTER_URL": "https://adapter.example",
            "STENOAI_ADAPTER_TOKEN": "adapter-secret",
            "OPENAI_API_KEY": "cli-auth",
        }
        with mock.patch.dict("src.local_cli.os.environ", steno_environment, clear=True):
            _, popen = self._run("codex", process)

        environment = popen.call_args.kwargs["env"]
        self.assertNotIn("STENOAI_CLOUD_API_KEY", environment)
        self.assertNotIn("STENOAI_ADAPTER_URL", environment)
        self.assertNotIn("STENOAI_ADAPTER_TOKEN", environment)
        self.assertEqual(environment["OPENAI_API_KEY"], "cli-auth")

    def test_missing_cli_has_actionable_error(self):
        with self.assertRaisesRegex(LocalCliError, "not found"):
            run_local_cli("codex", "prompt", resolver=lambda _provider: None)

    def test_auth_failure_does_not_expose_stderr(self):
        process = _FakeProcess(
            stderr="Authentication required: private meeting context",
            returncode=1,
        )
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process):
            with self.assertRaises(LocalCliError) as ctx:
                run_local_cli(
                    "claude",
                    "private meeting context",
                    resolver=lambda _provider: "/bin/claude",
                )
        self.assertIn("not signed in", str(ctx.exception))
        self.assertNotIn("private meeting context", str(ctx.exception))

    def test_timeout_terminates_process(self):
        process = _FakeProcess(returncode=None, timeout=True)
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process):
            with self.assertRaisesRegex(LocalCliError, "timed out"):
                run_local_cli(
                    "codex",
                    "prompt",
                    timeout_seconds=1,
                    resolver=lambda _provider: "/bin/codex",
                )
        self.assertTrue(process.terminated)

    def test_empty_stdout_is_an_error(self):
        process = _FakeProcess(stdout=" \n")
        with mock.patch("src.local_cli.subprocess.Popen", return_value=process):
            with self.assertRaisesRegex(LocalCliError, "empty response"):
                run_local_cli(
                    "claude",
                    "prompt",
                    resolver=lambda _provider: "/bin/claude",
                )


class LocalCliConfigTests(unittest.TestCase):
    def test_defaults_and_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            config = Config(config_path=path)
            self.assertEqual(config.get_local_cli_provider(), "codex")
            self.assertTrue(config.set_ai_provider("local_cli"))
            self.assertTrue(config.set_local_cli_provider("claude"))

            saved = json.loads(path.read_text())
            self.assertEqual(saved["ai_provider"], "local_cli")
            self.assertEqual(saved["local_cli_provider"], "claude")

            reloaded = Config(config_path=path)
            self.assertEqual(reloaded.get_ai_provider(), "local_cli")
            self.assertEqual(reloaded.get_local_cli_provider(), "claude")

    def test_invalid_cli_is_rejected_without_changing_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_local_cli_provider("claude"))
            before = path.read_text()

            self.assertFalse(config.set_local_cli_provider("other"))
            self.assertEqual(config.get_local_cli_provider(), "claude")
            self.assertEqual(path.read_text(), before)


class LocalCliSummarizerTests(unittest.TestCase):
    def _summarizer(self):
        config = mock.Mock(spec=Config)
        config.get_ai_provider.return_value = "local_cli"
        config.get_local_cli_provider.return_value = "claude"
        config.get_remote_ollama_url.return_value = ""
        return OllamaSummarizer(config=config)

    def test_initialization_never_starts_ollama(self):
        with mock.patch.object(
            OllamaSummarizer,
            "_ensure_ollama_ready",
            side_effect=AssertionError("Ollama should not start"),
        ):
            summarizer = self._summarizer()
        self.assertEqual(summarizer.model_name, "Claude CLI")

    def test_shared_stream_completion_routes_to_local_cli(self):
        summarizer = self._summarizer()
        with mock.patch(
            "src.summarizer.run_local_cli",
            return_value="## Summary\nCLI answer",
        ) as run:
            chunks = list(summarizer._stream_completion("assembled prompt"))

        self.assertEqual(chunks, ["## Summary\nCLI answer"])
        run.assert_called_once_with(
            "claude",
            "assembled prompt",
            timeout_seconds=7200,
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
