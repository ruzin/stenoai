import unittest
from unittest.mock import patch, MagicMock

from src import ollama_manager
from src.config import Config


def _fake_progress_chunks():
    """Yield a couple of fake progress objects shaped like ollama.pull stream items."""
    chunk1 = MagicMock()
    chunk1.status = "downloading"
    chunk1.completed = 50
    chunk1.total = 100
    chunk2 = MagicMock()
    chunk2.status = "success"
    chunk2.completed = 100
    chunk2.total = 100
    return [chunk1, chunk2]


class PullWithFallbackTests(unittest.TestCase):
    """Existing tests assume the registry probe succeeds (so primary is attempted)."""

    def setUp(self):
        # Default the probe to True; specific tests below override to False.
        patcher = patch.object(ollama_manager, "_registry_reachable", return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_returns_resolved_tag_when_primary_succeeds(self):
        with patch.object(ollama_manager, "start_ollama_server", return_value=True), \
             patch("ollama.pull", return_value=iter(_fake_progress_chunks())):
            success, resolved = ollama_manager.pull_with_fallback("llama3.2:3b")

        self.assertTrue(success)
        self.assertEqual(resolved, "llama3.2:3b")

    def test_falls_back_to_hf_mirror_when_primary_raises(self):
        primary_mirror = Config.HF_MIRRORS["llama3.2:3b"]
        call_log = []

        def fake_pull(tag, stream=False):
            call_log.append(tag)
            if tag == "llama3.2:3b":
                raise RuntimeError("pull manifest: connection refused")
            return iter(_fake_progress_chunks())

        with patch.object(ollama_manager, "start_ollama_server", return_value=True), \
             patch("ollama.pull", side_effect=fake_pull):
            success, resolved = ollama_manager.pull_with_fallback("llama3.2:3b")

        self.assertTrue(success)
        self.assertEqual(resolved, primary_mirror)
        # Both candidates were attempted, in order.
        self.assertEqual(call_log, ["llama3.2:3b", primary_mirror])

    def test_returns_failure_when_all_candidates_fail(self):
        with patch.object(ollama_manager, "start_ollama_server", return_value=True), \
             patch("ollama.pull", side_effect=RuntimeError("network unreachable")):
            success, resolved = ollama_manager.pull_with_fallback("llama3.2:3b")

        self.assertFalse(success)
        self.assertIsNone(resolved)

    def test_no_fallback_for_unmirrored_model_attempted(self):
        # qwen3:8b is deprecated and not in HF_MIRRORS — only the primary tag
        # should be tried, no extra HF attempt.
        call_log = []

        def fake_pull(tag, stream=False):
            call_log.append(tag)
            raise RuntimeError("registry blocked")

        with patch.object(ollama_manager, "start_ollama_server", return_value=True), \
             patch("ollama.pull", side_effect=fake_pull):
            success, resolved = ollama_manager.pull_with_fallback("qwen3:8b")

        self.assertFalse(success)
        self.assertIsNone(resolved)
        self.assertEqual(call_log, ["qwen3:8b"])

    def test_progress_callback_receives_each_candidate(self):
        primary_mirror = Config.HF_MIRRORS["llama3.2:3b"]
        seen = []

        def cb(tag, status, completed, total):
            seen.append((tag, status))

        def fake_pull(tag, stream=False):
            if tag == "llama3.2:3b":
                raise RuntimeError("blocked")
            return iter(_fake_progress_chunks())

        with patch.object(ollama_manager, "start_ollama_server", return_value=True), \
             patch("ollama.pull", side_effect=fake_pull):
            ollama_manager.pull_with_fallback("llama3.2:3b", progress_callback=cb)

        # The callback should have fired with the mirror tag, not the failed primary.
        tags_seen = {tag for tag, _ in seen}
        self.assertEqual(tags_seen, {primary_mirror})

    def test_returns_failure_when_server_cannot_start(self):
        with patch.object(ollama_manager, "start_ollama_server", return_value=False):
            success, resolved = ollama_manager.pull_with_fallback("llama3.2:3b")

        self.assertFalse(success)
        self.assertIsNone(resolved)


class RegistryProbeTests(unittest.TestCase):
    """Behaviour when the up-front registry-reachable probe fires."""

    def test_probe_failure_skips_primary_when_mirror_exists(self):
        primary_mirror = Config.HF_MIRRORS["llama3.2:3b"]
        call_log = []

        def fake_pull(tag, stream=False):
            call_log.append(tag)
            return iter(_fake_progress_chunks())

        with patch.object(ollama_manager, "start_ollama_server", return_value=True), \
             patch.object(ollama_manager, "_registry_reachable", return_value=False), \
             patch("ollama.pull", side_effect=fake_pull):
            success, resolved = ollama_manager.pull_with_fallback("llama3.2:3b")

        self.assertTrue(success)
        self.assertEqual(resolved, primary_mirror)
        # Critical: primary was *not* attempted at all — saves the ~60s of
        # Ollama-internal retries we get when registry.ollama.ai is blocked.
        self.assertEqual(call_log, [primary_mirror])

    def test_probe_failure_still_tries_primary_when_no_mirror(self):
        # Without a mirror to fall through to, the probe result doesn't matter —
        # we must still try the canonical tag (and let it fail naturally).
        call_log = []

        def fake_pull(tag, stream=False):
            call_log.append(tag)
            raise RuntimeError("registry blocked")

        with patch.object(ollama_manager, "start_ollama_server", return_value=True), \
             patch.object(ollama_manager, "_registry_reachable", return_value=False), \
             patch("ollama.pull", side_effect=fake_pull):
            success, resolved = ollama_manager.pull_with_fallback("qwen3:8b")

        self.assertFalse(success)
        self.assertIsNone(resolved)
        self.assertEqual(call_log, ["qwen3:8b"])

    def test_probe_returns_false_on_exception(self):
        # An httpx error during the probe should be treated as "unreachable",
        # not propagate up.
        with patch("httpx.head", side_effect=RuntimeError("connection refused")):
            self.assertFalse(ollama_manager._registry_reachable())

    def test_probe_returns_true_for_2xx(self):
        response = MagicMock()
        response.status_code = 200
        with patch("httpx.head", return_value=response):
            self.assertTrue(ollama_manager._registry_reachable())

    def test_probe_returns_true_for_4xx(self):
        # registry.ollama.ai responds 401 to unauthenticated /v2/ — that's
        # still "host is up", so probe should pass.
        response = MagicMock()
        response.status_code = 401
        with patch("httpx.head", return_value=response):
            self.assertTrue(ollama_manager._registry_reachable())

    def test_probe_returns_false_for_5xx(self):
        response = MagicMock()
        response.status_code = 503
        with patch("httpx.head", return_value=response):
            self.assertFalse(ollama_manager._registry_reachable())


class FindInstalledTagTests(unittest.TestCase):
    def _mock_list(self, installed_tags):
        response = MagicMock()
        response.models = [MagicMock(model=tag) for tag in installed_tags]
        return response

    def test_returns_primary_tag_when_installed(self):
        with patch("ollama.list", return_value=self._mock_list(["llama3.2:3b"])):
            tag = ollama_manager.find_installed_tag("llama3.2:3b")
        self.assertEqual(tag, "llama3.2:3b")

    def test_returns_hf_mirror_tag_when_only_mirror_installed(self):
        mirror = Config.HF_MIRRORS["llama3.2:3b"]
        with patch("ollama.list", return_value=self._mock_list([mirror])):
            tag = ollama_manager.find_installed_tag("llama3.2:3b")
        self.assertEqual(tag, mirror)

    def test_returns_none_when_neither_candidate_installed(self):
        with patch("ollama.list", return_value=self._mock_list(["something:else"])):
            tag = ollama_manager.find_installed_tag("llama3.2:3b")
        self.assertIsNone(tag)

    def test_returns_none_on_list_error(self):
        with patch("ollama.list", side_effect=RuntimeError("ollama down")):
            tag = ollama_manager.find_installed_tag("llama3.2:3b")
        self.assertIsNone(tag)


if __name__ == "__main__":
    unittest.main()
