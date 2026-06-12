"""Tests for the summarisation-phase heartbeat ticker (simple_recorder).

It keeps the Electron inactivity watchdog alive through the silent model
load + prompt-eval window before the first streamed summary token, and must
stop promptly once real output begins (or when capped) so a genuinely hung
Ollama still gets reaped.
"""

import contextlib
import io
import time
import unittest

from simple_recorder import _start_summary_heartbeat


class SummaryHeartbeatTests(unittest.TestCase):
    def test_emits_beats_until_stopped(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            stop = _start_summary_heartbeat(interval_s=0.01, max_beats=3)
            time.sleep(0.2)
            stop.set()
            time.sleep(0.05)  # let the thread observe the event
        out = buf.getvalue()
        self.assertIn("HEARTBEAT:summarize:1\n", out)
        # max_beats caps the ticker so a hung model can't stay alive forever.
        self.assertNotIn("HEARTBEAT:summarize:4", out)

    def test_stop_before_first_interval_emits_nothing(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            stop = _start_summary_heartbeat(interval_s=5)
            stop.set()
            time.sleep(0.05)
        self.assertEqual(buf.getvalue(), "")

    def test_custom_label(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            stop = _start_summary_heartbeat(label="reprocess", interval_s=0.01, max_beats=1)
            time.sleep(0.1)
            stop.set()
            time.sleep(0.05)
        self.assertIn("HEARTBEAT:reprocess:1\n", buf.getvalue())
