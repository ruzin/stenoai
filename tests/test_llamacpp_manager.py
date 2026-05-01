import unittest
from unittest.mock import patch, MagicMock

from src import llamacpp_manager


class IsLlamacppRunningTests(unittest.TestCase):
    def test_returns_true_when_health_returns_200(self):
        response = MagicMock()
        response.status_code = 200
        with patch("httpx.get", return_value=response):
            self.assertTrue(llamacpp_manager.is_llamacpp_running())

    def test_returns_false_when_health_returns_500(self):
        response = MagicMock()
        response.status_code = 500
        with patch("httpx.get", return_value=response):
            self.assertFalse(llamacpp_manager.is_llamacpp_running())

    def test_returns_false_on_connection_error(self):
        with patch("httpx.get", side_effect=ConnectionError("refused")):
            self.assertFalse(llamacpp_manager.is_llamacpp_running())


class StartLlamacppServerTests(unittest.TestCase):
    def test_returns_false_when_binary_missing(self):
        with patch.object(llamacpp_manager, "get_llamacpp_binary", return_value=None):
            ok = llamacpp_manager.start_llamacpp_server(MagicMock())
        self.assertFalse(ok)

    def test_returns_false_when_model_file_missing(self):
        from pathlib import Path
        binary = MagicMock()
        with patch.object(llamacpp_manager, "get_llamacpp_binary", return_value=binary):
            # A path that doesn't exist on disk.
            ok = llamacpp_manager.start_llamacpp_server(
                Path("/nonexistent/model.gguf")
            )
        self.assertFalse(ok)

    def test_spawns_and_polls_health_until_ready(self):
        # Simulate: first health check fails, second returns 200.
        from pathlib import Path
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".gguf", delete=False) as f:
            model_path = Path(f.name)

        try:
            health_responses = [False, False, True]
            health_iter = iter(health_responses)

            def fake_running(port=llamacpp_manager.LLAMACPP_PORT):
                try:
                    return next(health_iter)
                except StopIteration:
                    return True

            fake_proc = MagicMock()
            fake_proc.pid = 99999
            fake_proc.poll.return_value = None  # still running

            with patch.object(llamacpp_manager, "get_llamacpp_binary",
                              return_value=Path("/usr/bin/true")), \
                 patch.object(llamacpp_manager, "is_llamacpp_running",
                              side_effect=fake_running), \
                 patch("subprocess.Popen", return_value=fake_proc), \
                 patch.object(llamacpp_manager, "_write_pid") as write_pid, \
                 patch("time.sleep"):
                ok = llamacpp_manager.start_llamacpp_server(model_path)

            self.assertTrue(ok)
            write_pid.assert_called_once_with(99999)
        finally:
            model_path.unlink(missing_ok=True)

    def test_returns_false_when_process_exits_prematurely(self):
        # Bad model / port conflict scenario: process exits before healthcheck passes.
        from pathlib import Path
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".gguf", delete=False) as f:
            model_path = Path(f.name)

        try:
            fake_proc = MagicMock()
            fake_proc.pid = 99998
            fake_proc.poll.side_effect = [None, 1, 1]  # alive, then dead
            fake_proc.returncode = 1

            with patch.object(llamacpp_manager, "get_llamacpp_binary",
                              return_value=Path("/usr/bin/true")), \
                 patch.object(llamacpp_manager, "is_llamacpp_running",
                              return_value=False), \
                 patch("subprocess.Popen", return_value=fake_proc), \
                 patch.object(llamacpp_manager, "_write_pid"), \
                 patch.object(llamacpp_manager, "_clear_pid") as clear_pid, \
                 patch("time.sleep"):
                ok = llamacpp_manager.start_llamacpp_server(model_path)

            self.assertFalse(ok)
            clear_pid.assert_called_once()
        finally:
            model_path.unlink(missing_ok=True)

    def test_restarts_when_already_running(self):
        # Simulates user switching between two llamacpp-routed models —
        # the new spawn should first stop the existing runner.
        from pathlib import Path
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".gguf", delete=False) as f:
            model_path = Path(f.name)

        try:
            fake_proc = MagicMock()
            fake_proc.pid = 99997
            fake_proc.poll.return_value = None

            running_states = iter([True, False, True])

            def fake_running(port=llamacpp_manager.LLAMACPP_PORT):
                return next(running_states)

            with patch.object(llamacpp_manager, "get_llamacpp_binary",
                              return_value=Path("/usr/bin/true")), \
                 patch.object(llamacpp_manager, "is_llamacpp_running",
                              side_effect=fake_running), \
                 patch.object(llamacpp_manager, "stop_llamacpp_server") as stop, \
                 patch("subprocess.Popen", return_value=fake_proc), \
                 patch.object(llamacpp_manager, "_write_pid"), \
                 patch("time.sleep"):
                ok = llamacpp_manager.start_llamacpp_server(model_path)

            self.assertTrue(ok)
            stop.assert_called_once()
        finally:
            model_path.unlink(missing_ok=True)


class StopLlamacppServerTests(unittest.TestCase):
    def test_noop_when_no_pid_file(self):
        with patch.object(llamacpp_manager, "_read_pid", return_value=None):
            self.assertTrue(llamacpp_manager.stop_llamacpp_server())

    def test_sigterm_then_clear_pid_when_process_exits_gracefully(self):
        with patch.object(llamacpp_manager, "_read_pid", return_value=12345), \
             patch("os.kill") as kill, \
             patch.object(llamacpp_manager, "is_llamacpp_running",
                          side_effect=[True, False]), \
             patch.object(llamacpp_manager, "_clear_pid") as clear_pid, \
             patch("time.sleep"):
            ok = llamacpp_manager.stop_llamacpp_server()
        self.assertTrue(ok)
        kill.assert_any_call(12345, 15)  # SIGTERM
        clear_pid.assert_called()

    def test_sigkill_when_process_does_not_die_after_sigterm(self):
        with patch.object(llamacpp_manager, "_read_pid", return_value=12345), \
             patch("os.kill") as kill, \
             patch.object(llamacpp_manager, "is_llamacpp_running",
                          return_value=True), \
             patch.object(llamacpp_manager, "_clear_pid"), \
             patch("time.sleep"):
            llamacpp_manager.stop_llamacpp_server()
        # Should have called both SIGTERM and SIGKILL.
        signals_sent = [c.args[1] for c in kill.call_args_list]
        self.assertIn(15, signals_sent)
        self.assertIn(9, signals_sent)


class GetLocalModelsDirTests(unittest.TestCase):
    def test_returns_app_support_subdir(self):
        path = llamacpp_manager.get_local_models_dir()
        self.assertTrue(str(path).endswith("/stenoai/models"))
        self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
