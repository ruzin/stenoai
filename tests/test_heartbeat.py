"""Tests for the chunk-progress heartbeat registry (src/_heartbeat.py).

The contract that matters: a heartbeat must NEVER break transcription.
``None`` disables emission, and a callback that raises is swallowed.
"""

import unittest

from src import _heartbeat
from src._heartbeat import _emit_heartbeat, set_chunk_heartbeat


class HeartbeatRegistryTests(unittest.TestCase):
    def tearDown(self):
        set_chunk_heartbeat(None)

    def test_registered_callback_receives_done_and_total(self):
        beats = []
        set_chunk_heartbeat(lambda done, total: beats.append((done, total)))
        _emit_heartbeat(3, 10)
        self.assertEqual(beats, [(3, 10)])

    def test_none_disables_emission(self):
        beats = []
        set_chunk_heartbeat(lambda done, total: beats.append((done, total)))
        set_chunk_heartbeat(None)
        _emit_heartbeat(1, 2)
        self.assertEqual(beats, [])

    def test_default_state_is_disabled(self):
        # Emitting with no callback ever registered must be a silent no-op.
        self.assertIsNone(_heartbeat._callback)
        _emit_heartbeat(1, 2)  # must not raise

    def test_raising_callback_does_not_propagate(self):
        def boom(done, total):
            raise RuntimeError("sink exploded")

        set_chunk_heartbeat(boom)
        _emit_heartbeat(1, 2)  # must not raise

    def test_dispatcher_reexports_set_chunk_heartbeat(self):
        # Callers register through src.parakeet — the re-export must be the
        # same function so the backends' module-level import sees it.
        from src.parakeet import set_chunk_heartbeat as reexported
        self.assertIs(reexported, set_chunk_heartbeat)
