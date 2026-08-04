"""The "this cluster holds more than one person" marking, and the
multi-excerpt review samples built alongside it.

Both exist for the same reason: a diarized cluster that quietly contains
two people is invisible in every number the system produces. Measured
against a real three-person call, the contaminated cluster sat at cosine
distance 0.8270 from the person who contaminated it -- an ordinary
cross-speaker distance, nowhere near any threshold. So the marking cannot
be derived and has to be witnessed, and the samples are what let a human
witness it (hearing two voices under one row).

The tests that matter most here are the ones asserting what a marked
cluster must NOT do, because those are the failure modes that are silent:
a mixed cluster enrolled as a person poisons that profile for every future
meeting, and nothing in the wrong suggestion months later points back at
this cluster.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config
from src.speaker_suggestions import (
    MULTI_SPEAKER_KEY,
    extract_sample_text,
    ClusterContext,
    clusters_from_sidecar_channel,
    extract_segment_samples,
    merge_same_channel_fragments,
    minimum_speaker_count,
    read_speakers_sidecar,
    sample_segments,
    set_cluster_multi_speaker,
    suggest_speaker,
    suggest_speakers_for_meeting,
    write_speakers_sidecar,
)


def _last_json(output):
    line = [ln for ln in output.splitlines() if ln.strip().startswith("{")][-1]
    return json.loads(line)


def _profile(person_id, name, embedding, recording_type="remote", meetings=("m1", "m2")):
    """A person with enough independent evidence to clear every gate, so a
    test asserting "no suggestion" is asserting the marking's effect and
    not some unrelated threshold quietly doing the work."""
    return {
        "person_id": person_id,
        "display_name": name,
        "prototypes": [
            {"embedding_mean": embedding, "recording_type": recording_type, "meeting_id": m}
            for m in meetings
        ],
        "hard_negatives": [],
    }


def _context(sid="SPEAKER_0", **kwargs):
    base = dict(
        meeting_id="mtg001", diarization_speaker_id=sid, recording_type="remote",
        speech_duration_seconds=120.0, segment_count=20,
    )
    base.update(kwargs)
    return ClusterContext(**base)


class MarkingPersistenceTests(unittest.TestCase):
    def _seed(self, tmp, clusters=None):
        output_dir = Path(tmp) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        write_speakers_sidecar(output_dir, "mtg001", {
            "system": {
                "recording_type": "remote",
                "clusters": clusters or {
                    "SPEAKER_0": {
                        "embedding": [1.0, 0.0], "speech_duration_seconds": 60.0,
                        "segment_count": 10, "segments": [{"start": 1.0, "end": 5.0}],
                    },
                },
            },
        }, turn_manifest=[{"start": 1.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"}])
        return output_dir

    def test_marking_round_trips_and_clears(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed(tmp)
            set_cluster_multi_speaker(output_dir, "mtg001", "system", "SPEAKER_0", True)
            sidecar = read_speakers_sidecar(output_dir, "mtg001")
            self.assertTrue(
                sidecar["channels"]["system"]["clusters"]["SPEAKER_0"][MULTI_SPEAKER_KEY]
            )

            set_cluster_multi_speaker(output_dir, "mtg001", "system", "SPEAKER_0", False)
            sidecar = read_speakers_sidecar(output_dir, "mtg001")
            # Cleared by REMOVING the key, not by writing false -- absent and
            # "not marked" must read identically, or every sidecar written
            # before this feature existed would need a migration.
            self.assertNotIn(
                MULTI_SPEAKER_KEY, sidecar["channels"]["system"]["clusters"]["SPEAKER_0"],
            )

    def test_marking_preserves_embeddings_and_turn_manifest(self):
        # The sidecar carries the only copy of this meeting's voice
        # embeddings; once the source audio is gone they cannot be
        # recomputed. A marking write that dropped them would destroy data
        # silently, so assert the whole payload survives, not just the flag.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed(tmp)
            before = read_speakers_sidecar(output_dir, "mtg001")
            set_cluster_multi_speaker(output_dir, "mtg001", "system", "SPEAKER_0", True)
            after = read_speakers_sidecar(output_dir, "mtg001")

            cluster_after = after["channels"]["system"]["clusters"]["SPEAKER_0"]
            self.assertEqual(cluster_after["embedding"], [1.0, 0.0])
            self.assertEqual(cluster_after["segments"], [{"start": 1.0, "end": 5.0}])
            self.assertEqual(after["transcript_lines"], before["transcript_lines"])
            self.assertEqual(after["created_at"], before["created_at"])

    def test_unknown_cluster_channel_or_meeting_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed(tmp)
            self.assertIsNone(
                set_cluster_multi_speaker(output_dir, "mtg001", "system", "SPEAKER_9", True)
            )
            self.assertIsNone(
                set_cluster_multi_speaker(output_dir, "mtg001", "mic", "SPEAKER_0", True)
            )
            self.assertIsNone(
                set_cluster_multi_speaker(output_dir, "nope", "system", "SPEAKER_0", True)
            )


class MarkedClusterIsWithheldTests(unittest.TestCase):
    def test_marked_cluster_gets_no_suggestion_despite_an_exact_match(self):
        # The embedding is IDENTICAL to the profile's, so without the
        # marking this is an unambiguous "confirmed". Anything short of
        # status "none" here means the guard is not doing its job.
        profiles = [_profile("p1", "Julian", [1.0, 0.0])]
        unmarked = suggest_speaker([1.0, 0.0], _context(), profiles)
        self.assertEqual(unmarked.status, "confirmed")

        marked = suggest_speaker(
            [1.0, 0.0], _context(contains_multiple_speakers=True), profiles,
        )
        self.assertEqual(marked.status, "none")
        self.assertIsNone(marked.suggested_person_id)
        # No candidates either: a ranking computed from a centroid blended
        # across two people is not a weak guess about one person, it is a
        # confident guess about a voice that does not exist. Offering it in
        # a "Change" picker would invite exactly the wrong confirmation.
        self.assertEqual(marked.candidates, [])

    def test_marked_cluster_does_not_consume_the_person_it_resembles(self):
        # Meeting-wide exclusivity means a "confirmed" cluster takes that
        # person off the table for every other cluster. A mixed cluster
        # must not be able to do that -- otherwise marking a contaminated
        # cluster would COST the real cluster its correct suggestion,
        # punishing the user for telling the truth.
        profiles = [_profile("p1", "Julian", [1.0, 0.0])]
        results = suggest_speakers_for_meeting({
            "system": {
                "SPEAKER_0": (
                    [1.0, 0.0], _context("SPEAKER_0", contains_multiple_speakers=True),
                ),
                "SPEAKER_1": ([0.999, 0.045], _context("SPEAKER_1")),
            },
        }, profiles)

        self.assertEqual(results["system"]["SPEAKER_0"].status, "none")
        self.assertEqual(results["system"]["SPEAKER_1"].status, "confirmed")
        self.assertEqual(results["system"]["SPEAKER_1"].suggested_person_id, "p1")

    def test_marking_survives_a_fragment_merge(self):
        # Contamination is a property of the audio, so folding a mixed
        # fragment into a clean one yields a mixed cluster. The merged
        # entry is what the panel and confirm-speaker actually operate on,
        # so a marking that did not propagate would be silently ignored.
        clusters = {
            "SPEAKER_0": ([1.0, 0.0], _context("SPEAKER_0", speech_duration_seconds=90.0)),
            "SPEAKER_1": (
                [1.0, 0.0],
                _context("SPEAKER_1", speech_duration_seconds=10.0,
                         contains_multiple_speakers=True),
            ),
        }
        merged, id_resolution = merge_same_channel_fragments(clusters)
        self.assertEqual(id_resolution["SPEAKER_1"], "SPEAKER_0")
        self.assertTrue(merged["SPEAKER_0"][1].contains_multiple_speakers)

    def test_sidecar_flag_reaches_the_cluster_context(self):
        clusters = clusters_from_sidecar_channel("mtg001", {
            "recording_type": "remote",
            "clusters": {
                "SPEAKER_0": {"embedding": [1.0, 0.0], MULTI_SPEAKER_KEY: True},
                "SPEAKER_1": {"embedding": [0.0, 1.0]},
            },
        })
        self.assertTrue(clusters["SPEAKER_0"][1].contains_multiple_speakers)
        self.assertFalse(clusters["SPEAKER_1"][1].contains_multiple_speakers)


class MinimumSpeakerCountTests(unittest.TestCase):
    def test_counts_clusters_plus_one_per_marked_cluster(self):
        channels = {
            "system": {"clusters": {
                "SPEAKER_0": {MULTI_SPEAKER_KEY: True},
                "SPEAKER_1": {},
                "SPEAKER_2": {},
                "SPEAKER_3": {},
            }},
            "mic": {"clusters": {"SPEAKER_0": {}}},
        }
        # Four system clusters (Sortformer's hard ceiling) with one of them
        # known-mixed, plus the owner's mic cluster: at least six people
        # were in a meeting the diarizer described with five clusters.
        self.assertEqual(minimum_speaker_count(channels), 6)

    def test_empty_and_absent_channels_are_zero(self):
        self.assertEqual(minimum_speaker_count({}), 0)
        self.assertEqual(minimum_speaker_count({"system": {}}), 0)


class SampleSegmentsTests(unittest.TestCase):
    def test_picks_the_longest_turns_but_returns_them_chronologically(self):
        segments = [
            {"start": 100.0, "end": 101.0},   # 1s  - dropped
            {"start": 10.0, "end": 25.0},     # 15s
            {"start": 50.0, "end": 58.0},     # 8s
            {"start": 200.0, "end": 202.0},   # 2s  - dropped
            {"start": 5.0, "end": 15.0},      # 10s
        ]
        chosen = sample_segments(segments, limit=3)
        self.assertEqual(
            [s["start"] for s in chosen], [5.0, 10.0, 50.0],
            "the three longest turns, in the order they occur in the recording",
        )

    def test_fewer_segments_than_the_limit_is_not_padded(self):
        self.assertEqual(sample_segments([{"start": 1.0, "end": 2.0}], limit=5),
                         [{"start": 1.0, "end": 2.0}])
        self.assertEqual(sample_segments([], limit=5), [])

    def test_a_sidecar_without_a_turn_manifest_yields_playable_but_TEXTLESS_samples(self):
        # Every sidecar written by backfill-speaker-embeddings has no
        # transcript_lines, and for those the transcript's [MM:SS] markers
        # came from a DIFFERENT diarization run than the segments here.
        # Measured on a real three-person call: not one of the owner's
        # eleven lines fell inside a mic segment alone, while four of the
        # other participants' lines did -- proximity was inverted, not just
        # noisy. So no text is attributed at all. The timestamps and the
        # audio stay, because those come from the same run as the segments.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Speaker 2] first excerpt here\n"
                "[00:50] [Speaker 2] second excerpt here\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript, [{"start": 8.0, "end": 20.0}, {"start": 48.0, "end": 55.0}],
            )
            self.assertEqual(len(samples), 2, "the moments are still offered to listen to")
            self.assertEqual([s["text"] for s in samples], [None, None])
            self.assertEqual([s["start"] for s in samples], [8.0, 48.0])

    def test_a_turn_manifest_attributes_each_line_to_its_own_cluster(self):
        # With exact provenance there is nothing to match: the i-th diarised
        # line pairs with turn_manifest[i]. Crucially this INCLUDES lines
        # labeled "You" -- on the mic channel the owner's own turns are
        # exactly those, and the earlier code skipped them, which left the
        # owner's cluster quoting whoever happened to overlap in time.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [You] the owner speaking\n"
                "[00:20] [Others] someone else speaking\n"
                "[00:30] [You] the owner again\n",
                encoding="utf-8",
            )
            manifest = [
                {"start": 10.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
                {"start": 20.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                {"start": 30.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
            ]
            mic = extract_segment_samples(
                transcript, [{"start": 8.0, "end": 15.0}, {"start": 28.0, "end": 35.0}],
                turn_manifest=manifest, target_ids={("mic", "SPEAKER_0")},
            )
            self.assertEqual(
                [s["text"] for s in mic],
                ["the owner speaking", "the owner again"],
                "the owner's own lines must reach the owner's own cluster",
            )

            system = extract_segment_samples(
                transcript, [{"start": 18.0, "end": 25.0}],
                turn_manifest=manifest, target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual([s["text"] for s in system], ["someone else speaking"])

    def test_a_manifest_that_does_not_line_up_is_refused_rather_than_mispaired(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [You] one\n[00:20] [Others] two\n[00:30] [You] three\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript, [{"start": 8.0, "end": 15.0}],
                turn_manifest=[{"start": 10.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"}],
                target_ids={("mic", "SPEAKER_0")},
            )
            self.assertEqual([s["text"] for s in samples], [None])

    def test_a_multi_segment_turn_still_gets_its_text_and_a_matching_clip(self):
        # The defect this pins, reported from real use: "the clips do not
        # match the text 1:1, and often there is no text at all".
        #
        # src.transcriber merges consecutive segments of one speaker into a
        # single TURN carrying only the FIRST segment's timestamp
        # (transcriber.py: `if turns and turns[-1][1] == speaker:
        # turns[-1][2].append(text)`). Selecting the longest SEGMENTS and
        # then hunting for a line starting inside each one therefore misses
        # every segment that is not a turn's first -- which is most of them.
        #
        # Here one turn at 10s spans three segments, the longest of which
        # (30-45s) contains no line start at all. Segment-driven selection
        # would offer that segment with no text; turn-driven selection
        # offers the turn, with its text, and a clip covering the whole turn.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Others] one long uninterrupted turn\n"
                "[01:00] [You] a reply from the owner\n",
                encoding="utf-8",
            )
            segments = [
                {"start": 10.0, "end": 20.0},
                {"start": 21.0, "end": 29.0},
                {"start": 30.0, "end": 45.0},   # longest, and holds no line start
            ]
            manifest = [
                {"start": 10.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                {"start": 60.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
            ]
            samples = extract_segment_samples(
                transcript, segments,
                turn_manifest=manifest, target_ids={("system", "SPEAKER_0")},
            )

            self.assertEqual(len(samples), 1, "one turn, not three segments")
            self.assertEqual(samples[0]["text"], "one long uninterrupted turn")
            # The clip spans the WHOLE turn, not just one of its segments,
            # so what is heard is what is written beside it.
            self.assertEqual(samples[0]["start"], 10.0)
            self.assertEqual(samples[0]["end"], 30.0)  # capped at SAMPLE_MAX_SECONDS

    def test_a_gap_between_two_of_this_clusters_segments_is_not_spanned(self):
        # Found by review. The range was min(start) to max(end) over every
        # own segment inside the turn's bounds, so two segments with a hole
        # between them produced ONE clip covering the hole as well. The hole
        # is, by definition, time this cluster was NOT speaking; on a mic
        # channel taken without headphones that is exactly where the remote
        # voices sit. next_start and SAMPLE_MAX_SECONDS bound how far this
        # can reach, they do not stop it.
        #
        # Here the cluster speaks 10-12 and again 20-22, and the next line
        # is a minute away, so nothing else clips the range.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Speaker 2] first bit\n[01:00] [You] much later\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript,
                [{"start": 10.0, "end": 12.0}, {"start": 20.0, "end": 22.0}],
                turn_manifest=[
                    {"start": 10.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                    {"start": 60.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual(samples[0]["text"], "first bit")
            self.assertEqual(
                (samples[0]["start"], samples[0]["end"]), (10.0, 12.0),
                "the clip stops where this cluster stopped speaking",
            )

    def test_a_short_pause_inside_one_turn_is_still_one_clip(self):
        # The counterweight to the test above: a turn IS several consecutive
        # segments of one speaker (src.transcriber merges them), separated
        # by that speaker's own breathing pauses. Cutting at every one of
        # those would leave two-second clips nobody can recognise a voice
        # from -- the point of the panel.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Speaker 2] one continuous turn\n[01:00] [You] much later\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript,
                [
                    {"start": 10.0, "end": 15.0},
                    {"start": 15.4, "end": 19.0},   # 0.4s pause
                    {"start": 20.0, "end": 24.0},   # 1.0s pause
                ],
                turn_manifest=[
                    {"start": 10.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                    {"start": 60.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual((samples[0]["start"], samples[0]["end"]), (10.0, 24.0))

    def test_a_stale_manifest_of_the_same_length_is_refused_rather_than_mispaired(self):
        # The length check was the ONLY check, so a manifest that no longer
        # describes this transcript -- written by an earlier transcription,
        # or reordered -- passed it whenever the line count happened to
        # survive, and every line was then attributed positionally to
        # whatever cluster sat at that index. That is a quote from one
        # person shown under another person's name, which is the single
        # thing this panel must never do.
        #
        # Same three lines, same three entries, but the manifest's turns sit
        # at 10/45/70 while the transcript's lines sit at 10/20/30.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [You] one\n[00:20] [Others] two\n[00:30] [You] three\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript, [{"start": 8.0, "end": 15.0}],
                turn_manifest=[
                    {"start": 10.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
                    {"start": 45.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                    {"start": 70.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("mic", "SPEAKER_0")},
            )
            self.assertEqual(
                [s["text"] for s in samples], [None],
                "an unverifiable pairing yields the textless, audio-only fallback",
            )

    def test_a_manifest_that_still_describes_the_transcript_is_accepted(self):
        # The guard above must not refuse the normal case: manifest starts
        # are floats, the transcript's [MM:SS] is that float truncated to
        # the second, so entry 20.9 legitimately pairs with the line [00:20].
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [You] one\n[00:20] [Others] two\n", encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript, [{"start": 10.0, "end": 15.0}],
                turn_manifest=[
                    {"start": 10.4, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
                    {"start": 20.9, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("mic", "SPEAKER_0")},
            )
            self.assertEqual([s["text"] for s in samples], ["one"])

    def test_two_adjacent_turns_swapped_in_the_manifest_are_refused(self):
        # Found by the cross-family review of the check above. Half a second
        # of slop on each side made the accepted window two seconds wide for
        # a one-second bucket, so two turns a second apart could be swapped
        # and still pass -- and a swap is exactly what a reordered manifest
        # is. No slop is needed: the manifest's `start` and the line's
        # [MM:SS] are the SAME float, one of them truncated by
        # src.transcriber._format_timestamp, so this can be checked exactly.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Speaker 2] alice speaking\n[00:11] [Speaker 3] bob speaking\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript, [{"start": 10.0, "end": 10.9}],
                turn_manifest=[
                    {"start": 11.0, "channel": "system", "diarization_speaker_id": "SPEAKER_1"},
                    {"start": 10.5, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual(
                [s["text"] for s in samples], [None],
                "a swapped manifest must not put bob's line under alice's cluster",
            )

    def test_two_turns_swapped_inside_one_second_are_refused(self):
        # The narrower version of the test above, from the bot review: two
        # turns at 10.1 and 10.8 BOTH render as [00:10], so comparing each
        # entry against its line's displayed second cannot separate them,
        # however exactly it is done. What still separates them is order --
        # the manifest is built from a list sorted by start, so its starts
        # never decrease. A swap does.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Speaker 2] alice speaking\n[00:10] [Speaker 3] bob speaking\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript, [{"start": 10.1, "end": 10.5}],
                turn_manifest=[
                    {"start": 10.8, "channel": "system", "diarization_speaker_id": "SPEAKER_1"},
                    {"start": 10.1, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual(
                [s["text"] for s in samples], [None],
                "a manifest whose turns run backwards cannot describe this transcript",
            )

    def test_a_manifest_entry_that_is_not_an_object_is_refused_not_raised(self):
        # Also from that review: the sidecar is JSON, so an entry can be
        # anything, while every caller reaches straight for entry.get(...) --
        # and cluster_transcript_lines documents a never-raises contract.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text("[00:10] [Speaker 2] hello\n", encoding="utf-8")
            samples = extract_segment_samples(
                transcript, [{"start": 10.0, "end": 14.0}],
                turn_manifest=[None],
                target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual([s["text"] for s in samples], [None])

    def test_two_turns_in_the_same_displayed_second_never_widen_the_clip(self):
        # Found by review, and it is the same failure class as the one
        # reported from real use. Transcript timestamps render as [MM:SS],
        # so two turns inside ONE second carry the SAME value -- next_start
        # then equals start, the bounded segment set comes back empty, and
        # an earlier "window of N seconds around the timestamp" fallback
        # took over. That window covered the NEXT speaker, i.e. it played
        # somebody else under this speaker's name.
        #
        # Here Alice speaks 10.1-10.5 and Bob starts at 10.8; both lines
        # render as [00:10]. Alice's clip must stay inside Alice's segment.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Speaker 2] alice speaking\n"
                "[00:10] [Speaker 3] bob speaking\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript,
                [{"start": 10.1, "end": 10.5}],
                turn_manifest=[
                    {"start": 10.1, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                    {"start": 10.8, "channel": "system", "diarization_speaker_id": "SPEAKER_1"},
                ],
                target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual(samples[0]["text"], "alice speaking")
            self.assertEqual((samples[0]["start"], samples[0]["end"]), (10.1, 10.5))
            self.assertLess(
                samples[0]["end"], 10.8,
                "the clip must not reach the next speaker's segment",
            )

    def test_a_turn_with_no_segment_of_its_own_yields_no_playable_range(self):
        # When nothing of this cluster sits at or after the line, there is
        # no honest clip to offer. A zero-length range makes
        # extract_speaker_sample_audio refuse (duration <= 0) rather than
        # cutting arbitrary audio around the timestamp.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text("[01:00] [Speaker 2] said something\n", encoding="utf-8")
            samples = extract_segment_samples(
                transcript,
                [{"start": 5.0, "end": 8.0}],   # entirely before the line
                turn_manifest=[
                    {"start": 60.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual(samples[0]["text"], "said something")
            self.assertEqual(samples[0]["start"], samples[0]["end"])

    def test_the_unplaceable_moment_is_refused_by_the_half_that_plays_it(self):
        # The other half of the test above, and the pairing that has broken
        # twice already: the list says "nothing placeable here" with a
        # zero-length range, and the extractor is what has to honour it. It
        # did not -- its duration check ran after the two 0.3s pads, so the
        # unplaceable moment came back as a 0.6s clip of whoever was
        # actually speaking at that timestamp. Asserting the two functions
        # against each other, not each against its own idea of the contract.
        from src.speaker_suggestions import extract_speaker_sample_audio

        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text("[01:00] [Speaker 2] said something\n", encoding="utf-8")
            segments = [{"start": 5.0, "end": 8.0}]
            samples = extract_segment_samples(
                transcript, segments,
                turn_manifest=[
                    {"start": 60.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("system", "SPEAKER_0")},
            )
            audio = Path(tmp) / "a.wav"
            audio.write_bytes(b"stub")
            with mock.patch("src.transcriber._resolve_ffmpeg", return_value="/bin/ffmpeg"), \
                 mock.patch("src.speaker_suggestions.subprocess.run") as run_mock:
                played = extract_speaker_sample_audio(
                    audio, "system", segments, Path(tmp) / "out.wav",
                    segment_index=samples[0],
                )
            self.assertFalse(played)
            run_mock.assert_not_called()

    def test_a_clip_never_runs_into_the_next_speakers_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Others] first speaker\n[00:15] [You] second speaker\n",
                encoding="utf-8",
            )
            samples = extract_segment_samples(
                transcript,
                # The segment overruns the next line's start by 10s.
                [{"start": 10.0, "end": 25.0}],
                turn_manifest=[
                    {"start": 10.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                    {"start": 15.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
                ],
                target_ids={("system", "SPEAKER_0")},
            )
            self.assertEqual(samples[0]["end"], 15.0,
                             "playing past the next line means playing the other person")

    def test_the_collapsed_quote_is_one_of_the_expanded_excerpts(self):
        # Two independent derivations of "the most representative thing this
        # speaker said" drift apart, and the visible symptom is a collapsed
        # row quoting a moment that expanding never offers.
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text(
                "[00:10] [Others] short one\n"
                "[00:20] [Others] the substantially longer turn here\n"
                "[02:00] [You] owner\n",
                encoding="utf-8",
            )
            segments = [{"start": 10.0, "end": 12.0}, {"start": 20.0, "end": 40.0}]
            manifest = [
                {"start": 10.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                {"start": 20.0, "channel": "system", "diarization_speaker_id": "SPEAKER_0"},
                {"start": 120.0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
            ]
            kwargs = dict(turn_manifest=manifest, target_ids={("system", "SPEAKER_0")})
            samples = extract_segment_samples(transcript, segments, **kwargs)
            quote = extract_sample_text(transcript, segments, **kwargs)

            self.assertIn(quote, [s["text"] for s in samples])
            self.assertEqual(quote, "the substantially longer turn here")

    def test_segment_index_selects_the_matching_excerpt_and_refuses_out_of_range(self):
        # The single point where "play excerpt 3" turns into a time range.
        # Getting it wrong is invisible to the person using it -- they hear a
        # different moment than the text beside it and conclude two speakers
        # sound alike -- so an out-of-range index must fail rather than fall
        # back to the longest turn.
        from src.speaker_suggestions import extract_speaker_sample_audio

        segments = [
            {"start": 120.0, "end": 128.0},
            {"start": 10.0, "end": 30.0},
            {"start": 60.0, "end": 62.0},
        ]
        captured = []

        class _Result:
            returncode = 0

        def fake_run(cmd, **kwargs):
            captured.append(cmd)
            Path(cmd[-1]).write_bytes(b"wav")
            return _Result()

        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "a.wav"
            audio.write_bytes(b"stub")
            out = Path(tmp) / "out.wav"

            with mock.patch("src.transcriber._resolve_ffmpeg", return_value="/bin/ffmpeg"), \
                 mock.patch("subprocess.run", side_effect=fake_run):
                # Index 1 is the SECOND entry chronologically (60.0), not the
                # second-longest -- the list is chronological by contract.
                self.assertTrue(
                    extract_speaker_sample_audio(audio, "system", segments, out, segment_index=1)
                )
                start_arg = captured[-1][captured[-1].index("-ss") + 1]
                self.assertAlmostEqual(float(start_arg), 60.0 - 0.3, places=3)

                self.assertFalse(
                    extract_speaker_sample_audio(audio, "system", segments, out, segment_index=9)
                )
                self.assertFalse(
                    extract_speaker_sample_audio(audio, "system", segments, out, segment_index=-1)
                )

    def test_missing_transcript_yields_textless_entries_not_an_error(self):
        samples = extract_segment_samples(
            Path("/nonexistent/t.txt"), [{"start": 1.0, "end": 5.0}],
        )
        self.assertEqual(len(samples), 1)
        self.assertIsNone(samples[0]["text"])


class MarkSpeakerClusterCliTests(unittest.TestCase):
    def _seed(self, tmp, clusters=None):
        output_dir = Path(tmp) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        write_speakers_sidecar(output_dir, "mtg001", {
            "system": {
                "recording_type": "remote",
                "clusters": clusters or {
                    "SPEAKER_0": {
                        "embedding": [1.0, 0.0], "speech_duration_seconds": 60.0,
                        "segment_count": 10, "segments": [{"start": 1.0, "end": 5.0}],
                    },
                    "SPEAKER_1": {
                        "embedding": [0.0, 1.0], "speech_duration_seconds": 40.0,
                        "segment_count": 8, "segments": [{"start": 20.0, "end": 24.0}],
                    },
                },
            },
        })
        return output_dir

    def _run(self, command, args, tmp, cfg=None):
        cfg = cfg or Config(config_path=Path(tmp) / "config.json")
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            return CliRunner().invoke(command, args)

    def test_marks_and_reports_the_new_minimum_speaker_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed(tmp)
            result = self._run(
                simple_recorder.mark_speaker_cluster, ["mtg001", "system", "SPEAKER_0"], tmp,
            )
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertTrue(data["contains_multiple_speakers"])
            self.assertEqual(data["minimum_speaker_count"], 3)

    def test_unknown_cluster_fails_loudly_rather_than_marking_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed(tmp)
            result = self._run(
                simple_recorder.mark_speaker_cluster, ["mtg001", "system", "SPEAKER_9"], tmp,
            )
            self.assertEqual(result.exit_code, 1)
            self.assertFalse(_last_json(result.output)["success"])

    def test_suggest_speakers_reports_the_marking_and_withholds_the_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Julian")
            for meeting in ("other1", "other2"):
                cfg.add_speaker_prototype(
                    person["person_id"], [1.0, 0.0], recording_type="remote",
                    meeting_id=meeting, diarization_speaker_id="SPEAKER_0",
                    speech_duration_seconds=120.0, segment_count=20,
                    created_from="user_confirmed", channel="system",
                )

            before = _last_json(
                self._run(simple_recorder.suggest_speakers, ["mtg001"], tmp, cfg=cfg).output
            )
            self.assertEqual(before["channels"]["system"]["SPEAKER_0"]["status"], "confirmed")

            set_cluster_multi_speaker(output_dir, "mtg001", "system", "SPEAKER_0", True)
            after = _last_json(
                self._run(simple_recorder.suggest_speakers, ["mtg001"], tmp, cfg=cfg).output
            )
            cluster = after["channels"]["system"]["SPEAKER_0"]
            self.assertEqual(cluster["status"], "none")
            self.assertTrue(cluster["contains_multiple_speakers"])
            self.assertEqual(after["minimum_speaker_count"], 3)

    def test_confirm_speaker_refuses_a_marked_cluster(self):
        # The guarantee, as opposed to the panel's convenience: a confirm
        # turns this blended centroid into a stored prototype AND into
        # hard-negative evidence against everyone else in the channel,
        # degrading suggestions in unrelated future meetings with nothing
        # pointing back at the cause.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            set_cluster_multi_speaker(output_dir, "mtg001", "system", "SPEAKER_0", True)

            result = self._run(
                simple_recorder.confirm_speaker,
                ["mtg001", "system", "SPEAKER_0", "--new-person", "Julian"], tmp, cfg=cfg,
            )
            self.assertEqual(result.exit_code, 1)
            self.assertFalse(_last_json(result.output)["success"])
            # And nothing was half-written on the way to refusing.
            self.assertEqual(
                [p for p in cfg.get_person_profiles() if p.get("prototypes")], [],
            )

    def test_marking_withdraws_a_confirmation_already_made_on_that_cluster(self):
        # The realistic order of events: someone confirms a cluster, then
        # listens to a second excerpt and realises two people are in it. If
        # marking only blocked FUTURE confirms, the blended embedding would
        # stay enrolled as that person -- the exact state this exists to
        # prevent -- and stays reachable from enroll-self-from-person and
        # from every future suggestion scored against that profile.
        with tempfile.TemporaryDirectory() as tmp:
            self._seed(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            confirmed = self._run(
                simple_recorder.confirm_speaker,
                ["mtg001", "system", "SPEAKER_0", "--new-person", "Julian"], tmp, cfg=cfg,
            )
            self.assertTrue(_last_json(confirmed.output)["success"])
            julian = next(p for p in cfg.get_person_profiles() if p["display_name"] == "Julian")
            self.assertEqual(len(julian["prototypes"]), 1)

            marked = self._run(
                simple_recorder.mark_speaker_cluster,
                ["mtg001", "system", "SPEAKER_0"], tmp, cfg=cfg,
            )
            data = _last_json(marked.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["cleared_confirmation_from"], ["Julian"])

            julian = next(p for p in cfg.get_person_profiles() if p["display_name"] == "Julian")
            self.assertEqual(
                julian["prototypes"], [],
                "a blended two-voice embedding must not stay enrolled as a person",
            )

    def test_a_marked_cluster_is_not_used_as_hard_negative_evidence(self):
        # "Speaker B is not the person in cluster A" is only meaningful when
        # A is one person. If A is a blend of two voices, the negative is
        # recorded against a voice nobody has, and it suppresses real
        # matches for B in unrelated meetings.
        #
        # The marking is applied via set_cluster_multi_speaker DIRECTLY, not
        # via the CLI, and that is the point of the test. The CLI also
        # strips A's confirmation (see the test above), which normally keeps
        # A out of the hard-negative loop for a second reason -- so driving
        # it through the CLI would pass whether or not this filter exists.
        # This reproduces the state the filter alone has to handle: a marked
        # cluster whose confirmation survived, which is reachable for real
        # when remove_speaker_evidence cannot match a legacy prototype that
        # predates the `channel` field.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            self._run(
                simple_recorder.confirm_speaker,
                ["mtg001", "system", "SPEAKER_0", "--new-person", "Julian"], tmp, cfg=cfg,
            )
            julian = next(p for p in cfg.get_person_profiles() if p["display_name"] == "Julian")
            self.assertEqual(len(julian["prototypes"]), 1)

            set_cluster_multi_speaker(output_dir, "mtg001", "system", "SPEAKER_0", True)

            result = self._run(
                simple_recorder.confirm_speaker,
                ["mtg001", "system", "SPEAKER_1", "--new-person", "Max"], tmp, cfg=cfg,
            )
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(
                data["hard_negatives_added_against"], [],
                "a mixed cluster must not be treated as confirmed-different evidence",
            )

            for person in cfg.get_person_profiles():
                self.assertEqual(
                    person.get("hard_negatives") or [], [],
                    f"{person['display_name']} gained negative evidence from a mixed cluster",
                )

    def test_confirm_speaker_still_accepts_an_unmarked_cluster(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            result = self._run(
                simple_recorder.confirm_speaker,
                ["mtg001", "system", "SPEAKER_1", "--new-person", "Julian"], tmp, cfg=cfg,
            )
            self.assertTrue(_last_json(result.output)["success"])


class SpeakerNamingStatusCliTests(unittest.TestCase):
    """Feeds the one sentence shown before a delete. A CONFIRMED person
    survives the delete (their prototype lives in config.json, bound to no
    meeting); an UNNAMED cluster does not, and cannot be recovered by any
    means once the audio is gone -- naming a voice requires hearing it."""

    def _run(self, args, tmp, cfg=None):
        cfg = cfg or Config(config_path=Path(tmp) / "config.json")
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            return CliRunner().invoke(simple_recorder.speaker_naming_status, args)

    def _seed(self, tmp):
        output_dir = Path(tmp) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        write_speakers_sidecar(output_dir, "mtg001", {
            "system": {
                "recording_type": "remote",
                "clusters": {
                    "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 60.0,
                                  "segment_count": 10, "segments": [{"start": 1.0, "end": 5.0}]},
                    "SPEAKER_1": {"embedding": [0.0, 1.0], "speech_duration_seconds": 40.0,
                                  "segment_count": 8, "segments": [{"start": 20.0, "end": 24.0}]},
                },
            },
        })
        return output_dir

    def test_counts_unnamed_clusters(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed(tmp)
            data = _last_json(self._run(["mtg001"], tmp).output)
            self.assertTrue(data["has_sidecar"])
            self.assertEqual(data["total_clusters"], 2)
            self.assertEqual(data["unnamed_clusters"], 2)

    def test_a_confirmed_cluster_no_longer_counts_as_unnamed(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Julian")
            cfg.add_speaker_prototype(
                person["person_id"], [1.0, 0.0], recording_type="remote",
                meeting_id="mtg001", diarization_speaker_id="SPEAKER_0",
                speech_duration_seconds=60.0, segment_count=10,
                created_from="user_confirmed", channel="system",
            )
            data = _last_json(self._run(["mtg001"], tmp, cfg=cfg).output)
            self.assertEqual(data["named_clusters"], 1)
            self.assertEqual(data["unnamed_clusters"], 1)

    def test_a_marked_cluster_is_not_counted_as_waiting_to_be_named(self):
        # It has already been reviewed and ruled out. Counting it would nag
        # about the one row that can never be resolved.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed(tmp)
            set_cluster_multi_speaker(output_dir, "mtg001", "system", "SPEAKER_0", True)
            data = _last_json(self._run(["mtg001"], tmp).output)
            self.assertEqual(data["total_clusters"], 1)
            self.assertEqual(data["unnamed_clusters"], 1)

    def test_a_meeting_with_no_sidecar_is_success_with_nothing_at_risk(self):
        # Not an error: a caller deciding whether to show a warning wants
        # "nothing to warn about", and a delete must never be blocked by
        # this check failing.
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "output").mkdir(parents=True, exist_ok=True)
            data = _last_json(self._run(["never-diarised"], tmp).output)
            self.assertTrue(data["success"])
            self.assertFalse(data["has_sidecar"])
            self.assertEqual(data["unnamed_clusters"], 0)


if __name__ == '__main__':
    unittest.main()
