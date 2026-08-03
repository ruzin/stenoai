"""Guard the MLX Metal cache bound applied at Parakeet model load.

What this can and cannot cover, stated plainly so nobody reads more into a
green run than is there: the BEHAVIOUR being fixed - live transcription no
longer growing into swap - cannot be tested in CI at all. GitHub-hosted macOS
runners have no Metal GPU, so parakeet-mlx cannot load there (the same reason
the @pipeline e2e lane runs whisper in CI, see CLAUDE.md). The regression was
therefore measured by hand; see the PR and the comment on
MLX_CACHE_LIMIT_BYTES.

What IS testable, and is what these cases do: that the helper applies the
limit we think it does, against real mlx on real Apple Silicon, without
downloading or loading a model. Hardware-gated with a loud skip, matching the
convention in test_bundle_mlx.py - it never fails just for running elsewhere.
"""

import platform
import sys
import unittest
from unittest.mock import patch

from src import _parakeet_mlx
from src._parakeet_mlx import MLX_CACHE_LIMIT_BYTES, _configure_mlx_memory


# MLX's own default ceiling, captured at import - before any test in this
# process has had a chance to change it. Read here rather than inside a test
# because the limit is global mutable state shared by the whole discover run:
# a test that reads it late would be comparing against whatever ran first.
_MLX_DEFAULT_CACHE_LIMIT = None
if sys.platform == 'darwin' and platform.machine() == 'arm64':
    try:
        import mlx.core as _mx_probe

        _MLX_DEFAULT_CACHE_LIMIT = _mx_probe.set_cache_limit(1)
        _mx_probe.set_cache_limit(_MLX_DEFAULT_CACHE_LIMIT)
    except Exception:  # noqa: BLE001 - absence is a skip, never a failure
        _MLX_DEFAULT_CACHE_LIMIT = None


def _requires_mlx(test):
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        test.skipTest(f"darwin-arm64 only (host: {sys.platform}/{platform.machine()})")
    try:
        import mlx.core as mx
    except ImportError:
        test.skipTest("mlx not installed - run `pip install -r requirements.txt` in the venv")
    try:
        # _load_model imports this one; without it the wiring case would ERROR
        # on a machine that simply hasn't installed the ASR extra, which is a
        # skip condition, not a failure.
        import parakeet_mlx  # noqa: F401
    except ImportError:
        test.skipTest("parakeet-mlx not installed - run `pip install parakeet-mlx` in the venv")
    return mx


class MLXCacheLimitTests(unittest.TestCase):
    def test_configure_applies_the_limit_and_reports_the_previous_one(self):
        mx = _requires_mlx(self)
        original = mx.set_cache_limit(MLX_CACHE_LIMIT_BYTES)
        try:
            # Park the limit somewhere else first, so a passing assertion can't
            # be an accident of the limit already happening to be right.
            sentinel = 7 * 2**20
            mx.set_cache_limit(sentinel)

            previous = _configure_mlx_memory()
            self.assertEqual(previous, sentinel,
                             "should report the limit it replaced")
            self.assertEqual(mx.set_cache_limit(MLX_CACHE_LIMIT_BYTES),
                             MLX_CACHE_LIMIT_BYTES,
                             "the configured limit should be in effect afterwards")
        finally:
            mx.set_cache_limit(original)

    def test_limit_is_well_under_the_default(self):
        _requires_mlx(self)
        if _MLX_DEFAULT_CACHE_LIMIT is None:
            self.skipTest("could not read mlx's default cache limit at import")
        # MLX's default is ~95% of system memory - the thing this constant
        # exists to override. A "fix" that RAISED the ceiling would satisfy
        # every other case in this file. Compared against the value captured
        # at import, not the ambient one: by the time this runs, another test
        # may legitimately have left the configured limit in place, and then
        # the ambient value would be our own 512 MB and this would compare a
        # number against itself.
        self.assertLess(
            MLX_CACHE_LIMIT_BYTES, _MLX_DEFAULT_CACHE_LIMIT,
            f"cache limit {MLX_CACHE_LIMIT_BYTES} must be BELOW mlx's default "
            f"{_MLX_DEFAULT_CACHE_LIMIT}, otherwise it bounds nothing",
        )

    def test_loading_a_model_applies_the_limit(self):
        """The wiring, not just the helper.

        Without this, deleting the _configure_mlx_memory() call from
        _load_model leaves every other case in this file green while the bug
        is fully restored. from_pretrained is stubbed, so no model is
        downloaded and no GPU work happens - the assertion is only that the
        load path bounds the cache on its way through.
        """
        mx = _requires_mlx(self)
        original = mx.set_cache_limit(MLX_CACHE_LIMIT_BYTES)
        fake_id = 'test/not-a-real-model'
        try:
            mx.set_cache_limit(9 * 2**20)
            with patch('parakeet_mlx.from_pretrained', return_value=object()) as loader:
                _parakeet_mlx._load_model(fake_id)
            loader.assert_called_once_with(fake_id)
            self.assertEqual(
                mx.set_cache_limit(MLX_CACHE_LIMIT_BYTES), MLX_CACHE_LIMIT_BYTES,
                "_load_model must bound the MLX cache; it did not",
            )
        finally:
            _parakeet_mlx._MODEL_CACHE.pop(fake_id, None)
            mx.set_cache_limit(original)

    def test_bound_leaves_room_for_the_measured_working_set(self):
        # No mlx needed: a pure statement about the constant, so it also runs
        # in CI. The live path's measured steady-state cache cycles 475-512 MB;
        # dropping the ceiling near or below that would trade the memory bug
        # for cache thrashing on the 400 ms partial path.
        self.assertGreaterEqual(
            MLX_CACHE_LIMIT_BYTES, 256 * 2**20,
            "a ceiling this low would thrash the live partial path",
        )


if __name__ == '__main__':
    unittest.main()
