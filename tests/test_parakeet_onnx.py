"""Coverage for the ONNX Parakeet backend's pure helpers.

We don't (and can't) exercise the actual onnx-asr session here — that
needs the 670 MB int8 encoder weights on disk and onnxruntime installed.
What we do verify is the bookkeeping that sits around the model call:
token-to-sentence grouping (the only piece of logic that diverges from
the MLX path and that we wrote by hand), timestamp shape normalisation,
and the empty-result envelope. Those bugs would silently corrupt the
batch transcript shape if they regressed.
"""
import unittest

from src import _parakeet_onnx as onnx_backend


class GroupTokensIntoSentencesTests(unittest.TestCase):
    def test_groups_multiple_sentences_on_punctuation(self):
        tokens = ["Hello", " world", ".", " How", " are", " you", "?", " Fine"]
        timestamps = [
            (0.0, 0.5),
            (0.5, 1.0),
            (1.0, 1.1),
            (1.5, 1.8),
            (1.8, 2.0),
            (2.0, 2.3),
            (2.3, 2.4),
            (2.5, 2.8),
        ]
        segments = onnx_backend._group_tokens_into_sentences(tokens, timestamps)
        self.assertEqual(len(segments), 3)
        self.assertEqual(segments[0]["text"], "Hello world.")
        self.assertAlmostEqual(segments[0]["start"], 0.0)
        self.assertAlmostEqual(segments[0]["end"], 1.1)
        self.assertEqual(segments[1]["text"], "How are you?")
        self.assertAlmostEqual(segments[1]["start"], 1.5)
        self.assertAlmostEqual(segments[1]["end"], 2.4)
        # Tail tokens with no sentence-ending punctuation still become a segment
        # rather than being silently dropped.
        self.assertEqual(segments[2]["text"], "Fine")
        self.assertAlmostEqual(segments[2]["start"], 2.5)
        self.assertAlmostEqual(segments[2]["end"], 2.8)

    def test_single_sentence_no_terminator_returns_one_segment(self):
        tokens = ["hello", " world"]
        timestamps = [(0.0, 0.5), (0.5, 1.0)]
        segments = onnx_backend._group_tokens_into_sentences(tokens, timestamps)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["text"], "hello world")
        self.assertAlmostEqual(segments[0]["start"], 0.0)
        self.assertAlmostEqual(segments[0]["end"], 1.0)

    def test_mismatched_lengths_fall_back_to_single_segment(self):
        # The defensive branch: if a future onnx-asr release inserts a
        # leading <eos> token without a paired timestamp we should still
        # surface the transcript rather than dropping the utterance.
        tokens = ["hello", " world"]
        timestamps = [(0.0, 1.0)]  # length mismatch
        segments = onnx_backend._group_tokens_into_sentences(tokens, timestamps)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["text"], "hello world")
        # Whole-utterance bounds derived from the single timestamp pair.
        self.assertAlmostEqual(segments[0]["start"], 0.0)
        self.assertAlmostEqual(segments[0]["end"], 1.0)

    def test_empty_tokens_returns_empty_segments(self):
        self.assertEqual(onnx_backend._group_tokens_into_sentences([], []), [])
        self.assertEqual(onnx_backend._group_tokens_into_sentences([], [(0.0, 1.0)]), [])

    def test_whitespace_only_tokens_are_skipped(self):
        # tok_str is appended but empty-string tokens skip the loop body
        # entirely, so a leading "" token shouldn't drag the start time
        # backward to 0.0.
        tokens = ["", "Real", " text", "."]
        timestamps = [(0.0, 0.0), (1.0, 1.3), (1.3, 1.6), (1.6, 1.7)]
        segments = onnx_backend._group_tokens_into_sentences(tokens, timestamps)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["text"], "Real text.")
        # Start must come from the first non-empty token, not the skipped "".
        self.assertAlmostEqual(segments[0]["start"], 1.0)


class TimestampShapeNormalisationTests(unittest.TestCase):
    """The helpers tolerate three timestamp shapes (tuple/list, dict, object)
    so a minor onnx-asr API shift doesn't crash the live path. These cover
    each branch."""

    def test_tuple_shape(self):
        self.assertAlmostEqual(onnx_backend._ts_start((1.5, 2.5)), 1.5)
        self.assertAlmostEqual(onnx_backend._ts_end((1.5, 2.5)), 2.5)

    def test_list_shape(self):
        self.assertAlmostEqual(onnx_backend._ts_start([1.5, 2.5]), 1.5)
        self.assertAlmostEqual(onnx_backend._ts_end([1.5, 2.5]), 2.5)

    def test_dict_shape(self):
        self.assertAlmostEqual(onnx_backend._ts_start({"start": 1.5, "end": 2.5}), 1.5)
        self.assertAlmostEqual(onnx_backend._ts_end({"start": 1.5, "end": 2.5}), 2.5)

    def test_object_shape(self):
        class TS:
            def __init__(self, start: float, end: float) -> None:
                self.start = start
                self.end = end

        ts = TS(1.5, 2.5)
        self.assertAlmostEqual(onnx_backend._ts_start(ts), 1.5)
        self.assertAlmostEqual(onnx_backend._ts_end(ts), 2.5)

    def test_dict_end_falls_back_to_start_when_missing(self):
        # Some onnx-asr versions emit timestamps with only `start` populated
        # for the final boundary marker. Fall back to start so we don't
        # produce a 0.0 end time that segments would treat as "before start".
        self.assertAlmostEqual(
            onnx_backend._ts_end({"start": 3.0}),
            3.0,
        )


class ExtractTextTests(unittest.TestCase):
    def test_bare_string(self):
        self.assertEqual(onnx_backend._extract_text("  hello  "), "hello")

    def test_object_with_text_attribute(self):
        class R:
            text = "  world  "

        self.assertEqual(onnx_backend._extract_text(R()), "world")

    def test_object_without_text_returns_empty(self):
        class R:
            pass

        self.assertEqual(onnx_backend._extract_text(R()), "")

    def test_object_with_non_string_text_returns_empty(self):
        # Defensive — if a future onnx-asr release types `.text` as bytes or
        # None on empty utterances, we don't want to crash with AttributeError
        # on .strip().
        class R:
            text = None

        self.assertEqual(onnx_backend._extract_text(R()), "")


class EmptyResultEnvelopeTests(unittest.TestCase):
    """Locks the exact dict shape that the rest of the pipeline (transcriber,
    summariser, IPC) reads. A typo here would silently regress diarisation
    and downstream callers."""

    def test_empty_result_shape(self):
        result = onnx_backend._empty_result()
        self.assertEqual(set(result.keys()), {
            "text",
            "segments",
            "duration_seconds",
            "detected_language",
            "detected_language_probability",
        })
        self.assertIsNone(result["text"])
        self.assertEqual(result["segments"], [])
        self.assertIsNone(result["duration_seconds"])


if __name__ == "__main__":
    unittest.main()
