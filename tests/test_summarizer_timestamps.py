"""The [MM:SS] display timestamps on diarised transcripts must NOT reach the
LLM: the summariser strips them on the way in so summarisation input (and
therefore output / token cost) is unchanged by the timestamp feature. The
[You]/[Others] speaker labels are kept."""
import unittest

from src.summarizer import _strip_leading_timestamps


class StripLeadingTimestampsTests(unittest.TestCase):
    def test_strips_mm_ss_prefix_keeps_speaker_label(self):
        src = "[00:01] [You] Hello there\n\n[00:15] [Others] Hi back"
        self.assertEqual(
            _strip_leading_timestamps(src),
            "[You] Hello there\n\n[Others] Hi back",
        )

    def test_strips_h_mm_ss_prefix(self):
        self.assertEqual(
            _strip_leading_timestamps("[1:02:03] [You] Still going"),
            "[You] Still going",
        )

    def test_leaves_untimestamped_transcript_untouched(self):
        src = "[You] Hello\n\n[Others] Hi"
        self.assertEqual(_strip_leading_timestamps(src), src)

    def test_does_not_touch_bracketed_time_inside_body(self):
        # Only a LINE-LEADING [MM:SS] is a display marker; a time mentioned
        # mid-sentence must survive.
        src = "[You] we met at [12:30] downtown"
        self.assertEqual(_strip_leading_timestamps(src), src)

    def test_empty_input(self):
        self.assertEqual(_strip_leading_timestamps(""), "")
        self.assertIsNone(_strip_leading_timestamps(None))


if __name__ == "__main__":
    unittest.main()
