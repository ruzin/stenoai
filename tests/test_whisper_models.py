import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src import whisper_models


class IsInstalledTests(unittest.TestCase):
    def test_false_when_ggml_file_missing(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            with patch.object(whisper_models, "get_models_dir", return_value=Path(tmp_dir)):
                self.assertFalse(whisper_models.is_installed("small"))

    def test_true_when_ggml_file_present(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            (Path(tmp_dir) / "ggml-small.bin").write_bytes(b"x")
            with patch.object(whisper_models, "get_models_dir", return_value=Path(tmp_dir)):
                self.assertTrue(whisper_models.is_installed("small"))


class DownloadWithProgressTests(unittest.TestCase):
    def test_rejects_unknown_model_name(self):
        # Guards the HF URL construction: anything not in the registry must
        # never reach `requests.get`.
        with patch.object(whisper_models, "get_models_dir") as mock_dir:
            ok = whisper_models.download_with_progress("not-a-real-model", lambda *a: None)
            self.assertFalse(ok)
            mock_dir.assert_not_called()

    def test_short_circuits_when_file_exists(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            existing = Path(tmp_dir) / "ggml-small.bin"
            existing.write_bytes(b"abc")
            callback = MagicMock()
            with patch.object(whisper_models, "get_models_dir", return_value=Path(tmp_dir)):
                ok = whisper_models.download_with_progress("small", callback)
            self.assertTrue(ok)
            # Emits a single 100% so the renderer's progress map flushes to
            # complete, even though no network call happened.
            callback.assert_called_once_with(100, 3, 3)

    def test_writes_bytes_and_renames_part_on_success(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            chunks = [b"abcd", b"efgh", b"ijkl"]
            total_bytes = sum(len(c) for c in chunks)

            fake_response = MagicMock()
            fake_response.__enter__ = MagicMock(return_value=fake_response)
            fake_response.__exit__ = MagicMock(return_value=False)
            fake_response.headers = {"content-length": str(total_bytes)}
            fake_response.iter_content = MagicMock(return_value=iter(chunks))
            fake_response.raise_for_status = MagicMock()

            callback = MagicMock()
            with patch.object(whisper_models, "get_models_dir", return_value=Path(tmp_dir)), \
                 patch("requests.get", return_value=fake_response):
                ok = whisper_models.download_with_progress("small", callback)

            self.assertTrue(ok)
            dest = Path(tmp_dir) / "ggml-small.bin"
            self.assertTrue(dest.exists())
            self.assertEqual(dest.read_bytes(), b"abcdefghijkl")
            # The .part file is renamed away on success
            self.assertFalse(dest.with_suffix(".bin.part").exists())
            # Progress fires at least once with the final 100%
            self.assertTrue(callback.called)
            final = callback.call_args_list[-1].args
            self.assertEqual(final[0], 100)
            self.assertEqual(final[2], total_bytes)

    def test_cleans_up_part_file_when_download_interrupts_mid_stream(self):
        # The realistic failure: connection succeeded, headers arrived, some
        # bytes were written to .part, then the socket died mid-iteration.
        # An earlier version of this test raised inside requests.get itself,
        # which short-circuited before any .part file was created and made
        # the cleanup assertion vacuous. Now we let iter_content yield real
        # chunks then explode, so a .part file actually exists at the
        # moment cleanup needs to run.
        def chunks_then_die():
            yield b"some-bytes"
            yield b"more-bytes"
            raise ConnectionResetError("peer closed mid-stream")

        fake_response = MagicMock()
        fake_response.__enter__ = MagicMock(return_value=fake_response)
        fake_response.__exit__ = MagicMock(return_value=False)
        fake_response.headers = {"content-length": "100"}
        fake_response.iter_content = MagicMock(return_value=chunks_then_die())
        fake_response.raise_for_status = MagicMock()

        with tempfile.TemporaryDirectory() as tmp_dir:
            with patch.object(whisper_models, "get_models_dir", return_value=Path(tmp_dir)), \
                 patch("requests.get", return_value=fake_response):
                ok = whisper_models.download_with_progress("small", lambda *a: None)

            self.assertFalse(ok)
            # No partial file lingers — would otherwise grow the models dir
            # over repeated aborted attempts.
            self.assertEqual(list(Path(tmp_dir).iterdir()), [])

if __name__ == "__main__":
    unittest.main()
