import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

import httpx

from src import hf_downloader


class PathHelpersTests(unittest.TestCase):
    def test_safe_subdir_replaces_slashes(self):
        self.assertEqual(
            hf_downloader._safe_subdir("bartowski/google_gemma-4-E2B-it-GGUF"),
            "bartowski_google_gemma-4-E2B-it-GGUF",
        )

    def test_model_target_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = hf_downloader.model_target_path(
                "bartowski/google_gemma-4-E2B-it-GGUF",
                "google_gemma-4-E2B-it-Q4_K_M.gguf",
                Path(tmp),
            )
            self.assertEqual(
                path.parent.name, "bartowski_google_gemma-4-E2B-it-GGUF"
            )
            self.assertEqual(path.name, "google_gemma-4-E2B-it-Q4_K_M.gguf")

    def test_is_model_downloaded_false_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(
                hf_downloader.is_model_downloaded("a/b", "c.gguf", Path(tmp))
            )

    def test_is_model_downloaded_false_when_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = hf_downloader.model_target_path("a/b", "c.gguf", Path(tmp))
            target.parent.mkdir(parents=True)
            target.touch()
            self.assertFalse(
                hf_downloader.is_model_downloaded("a/b", "c.gguf", Path(tmp))
            )

    def test_is_model_downloaded_true_when_nonempty(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = hf_downloader.model_target_path("a/b", "c.gguf", Path(tmp))
            target.parent.mkdir(parents=True)
            target.write_bytes(b"x" * 100)
            self.assertTrue(
                hf_downloader.is_model_downloaded("a/b", "c.gguf", Path(tmp))
            )


def _fake_stream_response(status_code, body_chunks, headers=None):
    """Build a context-manager mock that mimics httpx.stream()'s ``with`` block."""
    response = MagicMock()
    response.status_code = status_code
    response.headers = headers or {"Content-Length": str(sum(len(c) for c in body_chunks))}
    response.iter_bytes = MagicMock(return_value=iter(body_chunks))
    response.raise_for_status = MagicMock()

    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=response)
    cm.__exit__ = MagicMock(return_value=False)
    return cm


class DownloadGgufTests(unittest.TestCase):
    def _head_response(self, content_length):
        head = MagicMock()
        head.headers = {"Content-Length": str(content_length)}
        head.raise_for_status = MagicMock()
        return head

    def test_full_download_writes_file_and_reports_progress(self):
        chunks = [b"hello ", b"world"]
        total = sum(len(c) for c in chunks)
        progress = []

        def cb(done, expected):
            progress.append((done, expected))

        with tempfile.TemporaryDirectory() as tmp:
            with patch("httpx.head", return_value=self._head_response(total)), \
                 patch("httpx.stream", return_value=_fake_stream_response(200, chunks)):
                path = hf_downloader.download_gguf(
                    "u/r", "model.gguf", Path(tmp), progress_callback=cb
                )

            self.assertTrue(path.exists())
            self.assertEqual(path.read_bytes(), b"hello world")
            # Progress reaches the total.
            self.assertEqual(progress[-1], (total, total))

    def test_resumes_partial_download_via_range(self):
        # Simulate: first attempt downloads half, second resumes from byte
        # offset and finishes.
        all_chunks = [b"AAAAA", b"BBBBB"]
        total = 10

        # First attempt: yields AAAAA then raises ReadTimeout.
        def first_stream_iter():
            yield all_chunks[0]
            raise httpx.ReadTimeout("simulated timeout")

        first_response = MagicMock()
        first_response.status_code = 200
        first_response.headers = {"Content-Length": str(total)}
        first_response.iter_bytes = MagicMock(return_value=first_stream_iter())
        first_response.raise_for_status = MagicMock()

        first_cm = MagicMock()
        first_cm.__enter__ = MagicMock(return_value=first_response)
        first_cm.__exit__ = MagicMock(return_value=False)

        # Second attempt: 206 partial, yields BBBBB.
        second_cm = _fake_stream_response(
            206, [all_chunks[1]],
            headers={"Content-Length": "5", "Content-Range": "bytes 5-9/10"},
        )

        with tempfile.TemporaryDirectory() as tmp:
            with patch("httpx.head", return_value=self._head_response(total)), \
                 patch("httpx.stream", side_effect=[first_cm, second_cm]), \
                 patch("time.sleep"):
                path = hf_downloader.download_gguf("u/r", "m.gguf", Path(tmp))

            self.assertEqual(path.read_bytes(), b"AAAAABBBBB")

    def test_raises_on_404(self):
        head = MagicMock()
        head.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Not Found", request=MagicMock(), response=MagicMock(status_code=404)
        )

        with tempfile.TemporaryDirectory() as tmp:
            with patch("httpx.head", return_value=head):
                with self.assertRaises(httpx.HTTPStatusError):
                    hf_downloader.download_gguf("u/r", "m.gguf", Path(tmp))

    def test_raises_after_max_attempts(self):
        # Every attempt fails; we should raise after MAX_RESUME_ATTEMPTS.
        def always_fails():
            yield b""
            raise httpx.ReadTimeout("simulated")

        def make_failing_cm(_method, _url, **_kwargs):
            response = MagicMock()
            response.status_code = 200
            response.headers = {"Content-Length": "100"}
            response.iter_bytes = MagicMock(return_value=always_fails())
            response.raise_for_status = MagicMock()
            cm = MagicMock()
            cm.__enter__ = MagicMock(return_value=response)
            cm.__exit__ = MagicMock(return_value=False)
            return cm

        with tempfile.TemporaryDirectory() as tmp:
            with patch("httpx.head", return_value=self._head_response(100)), \
                 patch("httpx.stream", side_effect=make_failing_cm), \
                 patch("time.sleep"):
                with self.assertRaises(RuntimeError):
                    hf_downloader.download_gguf("u/r", "m.gguf", Path(tmp))

    def test_already_complete_partial_promotes_without_redownload(self):
        # Edge case: a previous run left .partial that exactly matches
        # Content-Length. We should rename it without making any GET.
        total = 10
        with tempfile.TemporaryDirectory() as tmp:
            target = hf_downloader.model_target_path("u/r", "m.gguf", Path(tmp))
            target.parent.mkdir(parents=True)
            partial = target.with_suffix(target.suffix + ".partial")
            partial.write_bytes(b"X" * total)

            with patch("httpx.head", return_value=self._head_response(total)), \
                 patch("httpx.stream") as stream:
                path = hf_downloader.download_gguf("u/r", "m.gguf", Path(tmp))

            stream.assert_not_called()
            self.assertEqual(path.read_bytes(), b"X" * total)


if __name__ == "__main__":
    unittest.main()
