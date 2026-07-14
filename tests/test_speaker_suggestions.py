import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.speaker_suggestions import (
    ClusterContext,
    SAME_MEETING_MERGE_DISTANCE_THRESHOLD,
    SUGGESTION_CONFIDENCE_MARGIN,
    SUGGESTION_DISTANCE_THRESHOLD,
    SUGGESTION_MIN_AVG_TURN_SECONDS,
    SUGGESTION_MIN_CONFIRMED_MEETINGS,
    SUGGESTION_MIN_DURATION_SECONDS,
    SUGGESTION_MIN_SEGMENT_COUNT,
    build_clusters_from_diarization,
    clusters_from_sidecar_channel,
    determine_recording_type,
    extract_sample_text,
    extract_speaker_sample_audio,
    longest_segment,
    merge_same_channel_fragments,
    read_speakers_sidecar,
    relabel_transcript_speaker,
    score_candidates,
    suggest_speaker,
    suggest_speakers_for_meeting,
    write_speakers_sidecar,
)
from src.voiceprint import cosine_distance


def _profile(person_id, display_name, prototypes=None, hard_negatives=None):
    return {
        "person_id": person_id,
        "display_name": display_name,
        "prototypes": prototypes or [],
        "hard_negatives": hard_negatives or [],
    }


_prototype_counter = [0]


def _prototype(embedding, recording_type="in_person", meeting_id=None):
    # Auto-incrementing default meeting_id -- most tests don't care about
    # the confirmed-meetings gate, so each call looks like a distinct
    # meeting by default. Tests specifically exercising
    # SUGGESTION_MIN_CONFIRMED_MEETINGS pass an explicit meeting_id to
    # simulate multiple prototypes confirmed within the SAME meeting.
    if meeting_id is None:
        _prototype_counter[0] += 1
        meeting_id = f"auto_mtg_{_prototype_counter[0]}"
    return {"embedding_mean": embedding, "recording_type": recording_type, "meeting_id": meeting_id}


def _multi_meeting_prototypes(*embeddings, recording_type="in_person"):
    """N prototypes, each from a distinct auto-generated meeting -- the
    common case for a "confirmed" test that needs to clear
    SUGGESTION_MIN_CONFIRMED_MEETINGS."""
    return [_prototype(e, recording_type=recording_type) for e in embeddings]


def _stable_context(sid="SPEAKER_0", recording_type="in_person"):
    return ClusterContext(
        meeting_id="mtg001", diarization_speaker_id=sid,
        recording_type=recording_type,
        speech_duration_seconds=SUGGESTION_MIN_DURATION_SECONDS,
        segment_count=SUGGESTION_MIN_SEGMENT_COUNT,
    )


class DetermineRecordingTypeTests(unittest.TestCase):
    def test_mic_with_audio_is_in_person(self):
        self.assertEqual(determine_recording_type("mic", has_audio=True), "in_person")

    def test_system_with_audio_is_remote(self):
        self.assertEqual(determine_recording_type("system", has_audio=True), "remote")

    def test_mic_without_audio_is_unknown(self):
        self.assertEqual(determine_recording_type("mic", has_audio=False), "unknown")

    def test_system_without_audio_is_unknown(self):
        self.assertEqual(determine_recording_type("system", has_audio=False), "unknown")

    def test_hybrid_meeting_mic_stays_in_person_even_with_remote_system_audio(self):
        # A hybrid meeting (some people in-room, some remote) must not
        # relabel the mic channel "remote" just because the system channel
        # also has real audio -- each channel's type depends only on its
        # own audio presence.
        self.assertEqual(determine_recording_type("mic", has_audio=True), "in_person")
        self.assertEqual(determine_recording_type("system", has_audio=True), "remote")


class BuildClustersFromDiarizationTests(unittest.TestCase):
    """Shared by both the live pipeline (src.transcriber._tag_channel_segments)
    and backfill-speaker-embeddings -- both start from the exact
    (segments, embeddings) shape _run_steno_diarize returns."""

    def test_groups_segments_by_speaker_with_aggregates(self):
        segments = [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"},
            {"start": 1.0, "end": 3.5, "speaker": "SPEAKER_1"},
            {"start": 3.5, "end": 4.5, "speaker": "SPEAKER_0"},
        ]
        embeddings = {"SPEAKER_0": [0.1, 0.2], "SPEAKER_1": [0.3, 0.4]}
        clusters = build_clusters_from_diarization(segments, embeddings)
        self.assertEqual(clusters["SPEAKER_0"]["embedding"], [0.1, 0.2])
        self.assertAlmostEqual(clusters["SPEAKER_0"]["speech_duration_seconds"], 2.0)
        self.assertEqual(clusters["SPEAKER_0"]["segment_count"], 2)
        self.assertEqual(
            clusters["SPEAKER_0"]["segments"],
            [{"start": 0.0, "end": 1.0}, {"start": 3.5, "end": 4.5}],
        )
        self.assertEqual(clusters["SPEAKER_1"]["segment_count"], 1)
        self.assertAlmostEqual(clusters["SPEAKER_1"]["speech_duration_seconds"], 2.5)

    def test_speaker_with_embedding_but_no_segments_is_excluded(self):
        # A speaker slot the sidecar reports an embedding for but that never
        # actually appears in the segment list -- shouldn't happen, but
        # must not produce a cluster with no real evidence.
        segments = [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_0"}]
        embeddings = {"SPEAKER_0": [0.1, 0.2], "SPEAKER_1": [0.3, 0.4]}
        clusters = build_clusters_from_diarization(segments, embeddings)
        self.assertEqual(list(clusters.keys()), ["SPEAKER_0"])

    def test_empty_segments_returns_empty_clusters(self):
        self.assertEqual(build_clusters_from_diarization([], {}), {})


class ScoreCandidatesTests(unittest.TestCase):
    def test_prefers_same_context_prototypes(self):
        profiles = [_profile("p1", "Max", prototypes=[
            _prototype([1.0, 0.0], recording_type="remote"),   # far from query, wrong context
            _prototype([0.0, 1.0], recording_type="in_person"),  # close to query, right context
        ])]
        context = _stable_context(recording_type="in_person")
        candidates = score_candidates([0.0, 1.0], context, profiles)
        self.assertAlmostEqual(candidates[0].distance, 0.0, places=6)

    def test_falls_back_to_cross_context_when_none_match(self):
        profiles = [_profile("p1", "Max", prototypes=[
            _prototype([0.0, 1.0], recording_type="remote"),
        ])]
        context = _stable_context(recording_type="in_person")
        candidates = score_candidates([0.0, 1.0], context, profiles)
        self.assertEqual(len(candidates), 1)
        self.assertAlmostEqual(candidates[0].distance, 0.0, places=6)

    def test_person_with_no_prototypes_at_all_is_skipped(self):
        profiles = [_profile("p1", "Max", prototypes=[])]
        candidates = score_candidates([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(candidates, [])

    def test_flags_hard_negative_conflict(self):
        profiles = [_profile(
            "p1", "Max",
            prototypes=[_prototype([1.0, 0.0])],
            hard_negatives=[_prototype([1.0, 0.0])],  # query will land right on this too
        )]
        candidates = score_candidates([1.0, 0.0], _stable_context(), profiles)
        self.assertTrue(candidates[0].hard_negative_conflict)

    def test_no_hard_negative_conflict_when_query_far_from_negatives(self):
        profiles = [_profile(
            "p1", "Max",
            prototypes=[_prototype([1.0, 0.0])],
            hard_negatives=[_prototype([0.0, 1.0])],  # orthogonal, far
        )]
        candidates = score_candidates([1.0, 0.0], _stable_context(), profiles)
        self.assertFalse(candidates[0].hard_negative_conflict)

    def test_results_sorted_ascending_by_distance(self):
        profiles = [
            _profile("p1", "Far", prototypes=[_prototype([0.0, 1.0])]),
            _profile("p2", "Close", prototypes=[_prototype([1.0, 0.0])]),
        ]
        candidates = score_candidates([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual([c.display_name for c in candidates], ["Close", "Far"])

    def test_confirmed_meeting_count_counts_distinct_meeting_ids_in_pool(self):
        profiles = [_profile("p1", "Max", prototypes=[
            _prototype([1.0, 0.0], meeting_id="mtg_a"),
            _prototype([0.9, 0.1], meeting_id="mtg_a"),  # same meeting again
            _prototype([0.8, 0.2], meeting_id="mtg_b"),
        ])]
        candidates = score_candidates([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(candidates[0].confirmed_meeting_count, 2)


class SuggestSpeakerTests(unittest.TestCase):
    def test_confirmed_when_threshold_margin_and_stability_all_clear(self):
        profiles = [_profile("p1", "Max", prototypes=_multi_meeting_prototypes([1.0, 0.0], [0.98, 0.01]))]
        result = suggest_speaker([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(result.status, "confirmed")
        self.assertEqual(result.suggested_name, "Max")
        self.assertEqual(result.suggested_person_id, "p1")

    def test_possible_when_threshold_clears_but_stability_does_not(self):
        profiles = [_profile("p1", "Max", prototypes=[_prototype([1.0, 0.0])])]
        weak_context = ClusterContext(
            meeting_id="mtg001", diarization_speaker_id="SPEAKER_0",
            recording_type="in_person",
            speech_duration_seconds=2.0,  # below SUGGESTION_MIN_DURATION_SECONDS
            segment_count=1,  # below SUGGESTION_MIN_SEGMENT_COUNT
        )
        result = suggest_speaker([1.0, 0.0], weak_context, profiles)
        self.assertEqual(result.status, "possible")
        self.assertEqual(result.suggested_name, "Max")

    def test_possible_when_margin_too_close(self):
        profiles = [
            _profile("p1", "Max", prototypes=[_prototype([1.0, 0.0])]),
            _profile("p2", "Sam", prototypes=[_prototype([0.99, 0.02])]),  # near-tie
        ]
        result = suggest_speaker([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(result.status, "possible")

    def test_none_when_below_distance_threshold(self):
        profiles = [_profile("p1", "Max", prototypes=[_prototype([-1.0, 0.0])])]  # orthogonal/opposite
        result = suggest_speaker([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(result.status, "none")
        self.assertIsNone(result.suggested_name)

    def test_none_when_no_profiles(self):
        result = suggest_speaker([1.0, 0.0], _stable_context(), [])
        self.assertEqual(result.status, "none")
        self.assertEqual(result.candidates, [])

    def test_hard_negative_conflict_suppresses_even_strong_match(self):
        profiles = [_profile(
            "p1", "Max",
            prototypes=[_prototype([1.0, 0.0])],
            hard_negatives=[_prototype([1.0, 0.0])],
        )]
        result = suggest_speaker([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(result.status, "none")
        self.assertIsNone(result.suggested_name)

    def test_never_raises_on_malformed_profile(self):
        # Missing "prototypes" key entirely shouldn't crash scoring.
        profiles = [{"person_id": "p1", "display_name": "Max"}]
        result = suggest_speaker([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(result.status, "none")

    def test_possible_when_avg_turn_too_short_despite_duration_and_segment_count(self):
        # Real-library finding: a fragmented echo/crosstalk artifact cluster
        # (many short scattered blips) can rack up plenty of cumulative
        # duration and segment count without ever looking like sustained
        # real speech -- duration/segment-count gates alone don't catch it.
        # Reproduces the exact shape of a confirmed false positive found
        # this session: 56 turns, 85.4s total, ~1.53s/turn average.
        profiles = [_profile("p1", "Max", prototypes=[_prototype([1.0, 0.0])])]
        fragmented_context = ClusterContext(
            meeting_id="mtg001", diarization_speaker_id="SPEAKER_0",
            recording_type="in_person",
            speech_duration_seconds=85.4,  # well above SUGGESTION_MIN_DURATION_SECONDS
            segment_count=56,  # well above SUGGESTION_MIN_SEGMENT_COUNT
        )
        result = suggest_speaker([1.0, 0.0], fragmented_context, profiles)
        self.assertEqual(result.status, "possible")
        self.assertEqual(result.suggested_name, "Max")

    def test_confirmed_when_avg_turn_clears_threshold_even_with_many_short_turns(self):
        # A real conversation can have many short turns (quick back-and-forth)
        # -- this must still confirm as long as the average clears the bar,
        # not just when turns happen to be long. Segment count kept well
        # above SUGGESTION_MIN_SEGMENT_COUNT and total duration well above
        # SUGGESTION_MIN_DURATION_SECONDS so only the avg-turn gate is
        # actually under test here.
        profiles = [_profile("p1", "Max", prototypes=_multi_meeting_prototypes([1.0, 0.0], [0.98, 0.01]))]
        context = ClusterContext(
            meeting_id="mtg001", diarization_speaker_id="SPEAKER_0",
            recording_type="in_person",
            speech_duration_seconds=SUGGESTION_MIN_AVG_TURN_SECONDS * 20,
            segment_count=20,
        )
        result = suggest_speaker([1.0, 0.0], context, profiles)
        self.assertEqual(result.status, "confirmed")

    def test_possible_when_only_one_confirmed_meeting_despite_clearing_all_other_gates(self):
        # Even with a perfect distance/margin/duration/avg-turn, a person
        # with evidence from only ONE meeting must not auto-fill -- their
        # profile hasn't demonstrated it generalizes across sessions yet.
        profiles = [_profile("p1", "Max", prototypes=[_prototype([1.0, 0.0], meeting_id="mtg_only")])]
        result = suggest_speaker([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(result.status, "possible")
        self.assertEqual(result.suggested_name, "Max")

    def test_possible_when_two_prototypes_are_from_the_same_meeting(self):
        # Two prototypes confirmed from fragments of the SAME meeting (the
        # exact real-world shape found this session: a diarizer-split voice
        # confirmed twice within one call) must NOT count as two distinct
        # confirmed meetings.
        profiles = [_profile("p1", "Max", prototypes=[
            _prototype([1.0, 0.0], meeting_id="mtg_shared"),
            _prototype([0.99, 0.02], meeting_id="mtg_shared"),
        ])]
        result = suggest_speaker([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(result.status, "possible")

    def test_confirmed_when_two_distinct_meetings_confirmed(self):
        profiles = [_profile("p1", "Max", prototypes=[
            _prototype([1.0, 0.0], meeting_id="mtg_a"),
            _prototype([0.99, 0.02], meeting_id="mtg_b"),
        ])]
        result = suggest_speaker([1.0, 0.0], _stable_context(), profiles)
        self.assertEqual(result.status, "confirmed")


class SuggestSpeakersForMeetingTests(unittest.TestCase):
    def test_same_person_not_suggested_for_two_clusters(self):
        # Two clusters both plausibly Max; only the closer one should claim
        # the confirmed match — port of the removed auto-matcher's
        # usedNames behaviour.
        profiles = [_profile("p1", "Max", prototypes=_multi_meeting_prototypes([1.0, 0.0], [0.97, 0.03]))]
        clusters = {
            "SPEAKER_0": ([1.0, 0.0], _stable_context(sid="SPEAKER_0")),  # exact match
            "SPEAKER_1": ([0.95, 0.05], _stable_context(sid="SPEAKER_1")),  # also plausible
        }
        results = suggest_speakers_for_meeting(clusters, profiles)
        statuses = {sid: r.status for sid, r in results.items()}
        names = {sid: r.suggested_name for sid, r in results.items()}
        self.assertEqual(statuses["SPEAKER_0"], "confirmed")
        self.assertEqual(names["SPEAKER_0"], "Max")
        # SPEAKER_1 can't also claim Max -- no profiles left to match.
        self.assertNotEqual(names.get("SPEAKER_1"), "Max")

    def test_independent_clusters_each_get_their_own_person(self):
        profiles = [
            _profile("p1", "Max", prototypes=[_prototype([1.0, 0.0])]),
            _profile("p2", "Sarah", prototypes=[_prototype([0.0, 1.0])]),
        ]
        clusters = {
            "SPEAKER_0": ([1.0, 0.0], _stable_context(sid="SPEAKER_0")),
            "SPEAKER_1": ([0.0, 1.0], _stable_context(sid="SPEAKER_1")),
        }
        results = suggest_speakers_for_meeting(clusters, profiles)
        self.assertEqual(results["SPEAKER_0"].suggested_name, "Max")
        self.assertEqual(results["SPEAKER_1"].suggested_name, "Sarah")


def _ctx(sid, duration, segments=5):
    return ClusterContext(
        meeting_id="mtg001", diarization_speaker_id=sid,
        recording_type="remote", speech_duration_seconds=duration, segment_count=segments,
    )


class MergeSameChannelFragmentsTests(unittest.TestCase):
    def test_single_cluster_returns_unchanged(self):
        clusters = {"SPEAKER_0": ([1.0, 0.0], _ctx("SPEAKER_0", 100))}
        merged, resolution = merge_same_channel_fragments(clusters)
        self.assertEqual(merged, clusters)
        self.assertEqual(resolution, {"SPEAKER_0": "SPEAKER_0"})

    def test_merges_clusters_below_threshold(self):
        # distance([1,0], [0.995,0.0999]) ~= 0.005, well under 0.10.
        clusters = {
            "SPEAKER_0": ([1.0, 0.0], _ctx("SPEAKER_0", 1600)),
            "SPEAKER_2": ([0.995, 0.0999], _ctx("SPEAKER_2", 1538)),
        }
        merged, resolution = merge_same_channel_fragments(clusters)
        self.assertEqual(len(merged), 1)
        self.assertIn("SPEAKER_0", merged)  # higher duration -> primary
        self.assertEqual(resolution["SPEAKER_0"], "SPEAKER_0")
        self.assertEqual(resolution["SPEAKER_2"], "SPEAKER_0")
        merged_context = merged["SPEAKER_0"][1]
        self.assertEqual(merged_context.merged_from, ["SPEAKER_2"])
        self.assertAlmostEqual(merged_context.speech_duration_seconds, 1600 + 1538)

    def test_does_not_merge_clusters_above_threshold(self):
        clusters = {
            "SPEAKER_0": ([1.0, 0.0], _ctx("SPEAKER_0", 100)),
            "SPEAKER_1": ([0.0, 1.0], _ctx("SPEAKER_1", 50)),  # distance 1.0
        }
        merged, resolution = merge_same_channel_fragments(clusters)
        self.assertEqual(len(merged), 2)
        self.assertEqual(resolution["SPEAKER_0"], "SPEAKER_0")
        self.assertEqual(resolution["SPEAKER_1"], "SPEAKER_1")
        self.assertEqual(merged["SPEAKER_0"][1].merged_from, [])

    def test_transitive_merge_via_connected_components(self):
        # A~B close, B~C close, but A~C distance is right at the edge --
        # must still merge into one group via the A-B-C chain.
        a = [1.0, 0.0]
        b = [0.995, 0.0999]     # dist(a,b) ~= 0.005
        c = [0.98, 0.19]        # dist(b,c) ~= 0.045; dist(a,c) ~= 0.051 -- both under 0.10 anyway,
        # but the point is the grouping algorithm doesn't require a single
        # global anchor -- verified structurally via 3-way group below.
        clusters = {
            "SPEAKER_0": (a, _ctx("SPEAKER_0", 300)),
            "SPEAKER_1": (b, _ctx("SPEAKER_1", 200)),
            "SPEAKER_2": (c, _ctx("SPEAKER_2", 100)),
        }
        merged, resolution = merge_same_channel_fragments(clusters)
        self.assertEqual(len(merged), 1)
        self.assertEqual(len(set(resolution.values())), 1)
        primary = resolution["SPEAKER_0"]
        self.assertEqual(primary, "SPEAKER_0")  # highest duration
        self.assertEqual(sorted(merged[primary][1].merged_from), ["SPEAKER_1", "SPEAKER_2"])
        self.assertAlmostEqual(merged[primary][1].speech_duration_seconds, 600)
        self.assertEqual(merged[primary][1].segment_count, 15)

    def test_merged_embedding_weighted_toward_higher_duration_member(self):
        a = [1.0, 0.0]
        b = [0.995, 0.0999]  # slightly off-axis, dist(a,b) ~= 0.005
        clusters = {
            "SPEAKER_0": (a, _ctx("SPEAKER_0", 900)),  # 9x the weight of B
            "SPEAKER_1": (b, _ctx("SPEAKER_1", 100)),
        }
        merged, _ = merge_same_channel_fragments(clusters)
        merged_embedding = merged["SPEAKER_0"][0]
        # A dominant-weighted merge should land closer to A than to B.
        self.assertLess(cosine_distance(merged_embedding, a), cosine_distance(merged_embedding, b))

    def test_does_not_merge_deliberately_different_voices(self):
        # Same real person, deliberately different vocal performance --
        # should NOT collapse (that's a human judgment call, not automatic).
        # Modeled on this session's real "3 Julian voices" finding: distinct
        # enough acoustically to sit outside the strict merge threshold.
        clusters = {
            "SPEAKER_0": ([1.0, 0.0], _ctx("SPEAKER_0", 300)),
            "SPEAKER_1": ([0.7, 0.7], _ctx("SPEAKER_1", 30)),  # distance ~0.29, above 0.10
        }
        merged, resolution = merge_same_channel_fragments(clusters)
        self.assertEqual(len(merged), 2)
        self.assertNotEqual(resolution["SPEAKER_0"], resolution["SPEAKER_1"])


class SpeakersSidecarTests(unittest.TestCase):
    def test_write_then_read_round_trips(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            channels = {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5},
                    },
                },
            }
            path = write_speakers_sidecar(output_dir, "mtg001", channels)
            self.assertTrue(path.exists())
            loaded = read_speakers_sidecar(output_dir, "mtg001")
            self.assertEqual(loaded["meeting_id"], "mtg001")
            self.assertEqual(
                loaded["channels"]["mic"]["clusters"]["SPEAKER_0"]["embedding"], [1.0, 0.0],
            )

    def test_read_missing_sidecar_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            self.assertIsNone(read_speakers_sidecar(Path(tmp_dir), "nonexistent"))

    def test_read_corrupt_sidecar_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            (output_dir / "mtg001_speakers.json").write_text("{not json")
            self.assertIsNone(read_speakers_sidecar(output_dir, "mtg001"))

    def test_clusters_from_sidecar_channel_builds_expected_shape(self):
        channel = {
            "recording_type": "remote",
            "clusters": {
                "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 40.0, "segment_count": 6},
            },
        }
        clusters = clusters_from_sidecar_channel("mtg001", channel)
        embedding, context = clusters["SPEAKER_0"]
        self.assertEqual(embedding, [1.0, 0.0])
        self.assertEqual(context.recording_type, "remote")
        self.assertEqual(context.meeting_id, "mtg001")
        self.assertEqual(context.speech_duration_seconds, 40.0)
        self.assertEqual(context.segment_count, 6)


class RelabelTranscriptSpeakerTests(unittest.TestCase):
    def _write_transcript(self, tmp, body):
        path = Path(tmp) / "mtg001_transcript.txt"
        path.write_text(
            "Session: mtg001\nFile: mtg001.webm\nDate: x\n\n" + "=" * 60 + "\n\n" + body,
            encoding="utf-8",
        )
        return path

    def test_relabels_line_within_segment_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:05] [Speaker 2] hello there")
            changed = relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            self.assertEqual(changed, 1)
            self.assertIn("[00:05] [Julian] hello there", path.read_text())

    def test_does_not_relabel_line_outside_segment_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:50] [Speaker 2] hello there")
            changed = relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            self.assertEqual(changed, 0)
            self.assertIn("[00:50] [Speaker 2] hello there", path.read_text())

    def test_never_relabels_you(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:05] [You] hello there")
            changed = relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            self.assertEqual(changed, 0)
            self.assertIn("[00:05] [You] hello there", path.read_text())

    def test_relabels_others_label_not_just_speaker_n(self):
        # The dominant system-channel cluster keeps the legacy "Others"
        # label, not a "Speaker N" placeholder -- that's exactly the
        # common real case (the one real remote party on a call) and must
        # be relabelable, not skipped like "You" is.
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:05] [Others] hello there")
            changed = relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            self.assertEqual(changed, 1)
            self.assertIn("[00:05] [Julian] hello there", path.read_text())

    def test_tolerance_allows_slight_boundary_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:04] [Speaker 2] hello there")
            # Line timestamp (4.0s, from integer-second [MM:SS] truncation)
            # is just outside [4.3, 6.0] but within the 0.5s tolerance.
            changed = relabel_transcript_speaker(path, [{"start": 4.3, "end": 6.0}], "Julian")
            self.assertEqual(changed, 1)

    def test_idempotent_rerun_with_different_name_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:05] [Speaker 2] hello there")
            relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            changed = relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Max")
            self.assertEqual(changed, 1)
            self.assertIn("[00:05] [Max] hello there", path.read_text())

    def test_rerun_with_same_name_is_a_noop(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:05] [Speaker 2] hello there")
            relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            changed = relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            self.assertEqual(changed, 0)

    def test_multiple_pooled_segments_from_merged_fragments(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(
                tmp,
                "[00:05] [Speaker 2] first fragment\n\n[05:00] [Speaker 3] second fragment",
            )
            changed = relabel_transcript_speaker(
                path, [{"start": 4.0, "end": 6.0}, {"start": 299.0, "end": 301.0}], "Julian",
            )
            self.assertEqual(changed, 2)
            text = path.read_text()
            self.assertIn("[00:05] [Julian] first fragment", text)
            self.assertIn("[05:00] [Julian] second fragment", text)

    def test_untouched_lines_and_header_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(
                tmp, "[00:05] [Speaker 2] hello\n\n[00:10] [You] hi back",
            )
            before = path.read_text()
            relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            after = path.read_text()
            self.assertIn("Session: mtg001", after)
            self.assertIn("[00:10] [You] hi back", after)
            self.assertNotEqual(before, after)  # sanity: something did change

    def test_returns_zero_when_transcript_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nonexistent_transcript.txt"
            changed = relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            self.assertEqual(changed, 0)

    def test_returns_zero_when_no_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:05] [Speaker 2] hello there")
            changed = relabel_transcript_speaker(path, [], "Julian")
            self.assertEqual(changed, 0)

    def test_handles_hour_scale_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[1:02:33] [Speaker 2] hello there")
            changed = relabel_transcript_speaker(
                path, [{"start": 3752.0, "end": 3754.0}], "Julian",
            )
            self.assertEqual(changed, 1)
            self.assertIn("[1:02:33] [Julian] hello there", path.read_text())

    def test_malformed_line_does_not_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "not a diarised line at all")
            changed = relabel_transcript_speaker(path, [{"start": 4.0, "end": 6.0}], "Julian")
            self.assertEqual(changed, 0)


class LongestSegmentTests(unittest.TestCase):
    def test_returns_the_longest_by_duration(self):
        segments = [
            {"start": 0.0, "end": 1.0},
            {"start": 10.0, "end": 15.0},
            {"start": 20.0, "end": 21.5},
        ]
        self.assertEqual(longest_segment(segments), {"start": 10.0, "end": 15.0})

    def test_empty_list_returns_none(self):
        self.assertIsNone(longest_segment([]))


class ExtractSampleTextTests(unittest.TestCase):
    def _write_transcript(self, tmp, body):
        path = Path(tmp) / "mtg001_transcript.txt"
        path.write_text(
            "Session: mtg001\nFile: mtg001.webm\nDate: x\n\n" + "=" * 60 + "\n\n" + body,
            encoding="utf-8",
        )
        return path

    def test_extracts_text_at_the_longest_segment(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(
                tmp, "[00:05] [Speaker 2] hello there, how are you doing today",
            )
            text = extract_sample_text(path, [{"start": 4.0, "end": 6.0}])
            self.assertEqual(text, "hello there, how are you doing today")

    def test_picks_the_longest_segment_when_several_given(self):
        # A brief 2s blip earlier in the recording must not be quoted over
        # the substantial 40s turn -- matches longest_segment's own
        # cross-voice-contamination-avoidance reasoning.
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(
                tmp,
                "[00:05] [Speaker 2] a brief interjection\n\n"
                "[05:00] [Speaker 2] this is the real substantial turn that should be quoted",
            )
            text = extract_sample_text(
                path, [{"start": 4.0, "end": 6.0}, {"start": 299.0, "end": 339.0}],
            )
            self.assertEqual(text, "this is the real substantial turn that should be quoted")

    def test_never_quotes_you(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:05] [You] this is the device owner talking")
            text = extract_sample_text(path, [{"start": 4.0, "end": 6.0}])
            self.assertIsNone(text)

    def test_truncates_long_text_with_ellipsis(self):
        with tempfile.TemporaryDirectory() as tmp:
            long_text = "word " * 60
            path = self._write_transcript(tmp, f"[00:05] [Speaker 2] {long_text.strip()}")
            text = extract_sample_text(path, [{"start": 4.0, "end": 6.0}], max_chars=20)
            self.assertLessEqual(len(text), 21)  # 20 + ellipsis char
            self.assertTrue(text.endswith("…"))

    def test_returns_none_when_no_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:05] [Speaker 2] hello")
            self.assertIsNone(extract_sample_text(path, []))

    def test_returns_none_when_transcript_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nonexistent.txt"
            self.assertIsNone(extract_sample_text(path, [{"start": 4.0, "end": 6.0}]))

    def test_returns_none_when_nothing_overlaps(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write_transcript(tmp, "[00:50] [Speaker 2] hello there")
            self.assertIsNone(extract_sample_text(path, [{"start": 4.0, "end": 6.0}]))


class ExtractSpeakerSampleAudioTests(unittest.TestCase):
    def test_returns_false_when_no_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "mtg001.wav"
            audio_path.write_bytes(b"stub")
            ok = extract_speaker_sample_audio(audio_path, "mic", [], Path(tmp) / "out.wav")
            self.assertFalse(ok)

    def test_returns_false_when_source_audio_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "does_not_exist.wav"
            ok = extract_speaker_sample_audio(
                audio_path, "mic", [{"start": 4.0, "end": 6.0}], Path(tmp) / "out.wav",
            )
            self.assertFalse(ok)

    def test_returns_false_when_ffmpeg_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "mtg001.wav"
            audio_path.write_bytes(b"stub")
            with mock.patch("src.transcriber._resolve_ffmpeg", return_value=None):
                ok = extract_speaker_sample_audio(
                    audio_path, "mic", [{"start": 4.0, "end": 6.0}], Path(tmp) / "out.wav",
                )
            self.assertFalse(ok)

    def test_success_calls_ffmpeg_with_correct_time_range_and_channel(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "mtg001.wav"
            audio_path.write_bytes(b"stub")
            out_path = Path(tmp) / "out.wav"

            def fake_run(cmd, **kwargs):
                # Simulate ffmpeg actually writing the output file.
                out_path.write_bytes(b"wav-stub")
                return mock.Mock(returncode=0)

            with mock.patch("src.transcriber._resolve_ffmpeg", return_value="/usr/bin/ffmpeg"), \
                 mock.patch("src.speaker_suggestions.subprocess.run", side_effect=fake_run) as run_mock:
                ok = extract_speaker_sample_audio(
                    audio_path, "system", [{"start": 10.0, "end": 15.0}], out_path,
                )
            self.assertTrue(ok)
            self.assertTrue(out_path.exists())
            cmd = run_mock.call_args[0][0]
            self.assertIn("-ss", cmd)
            self.assertIn(str(max(0.0, 10.0 - 0.3)), cmd)
            self.assertIn("pan=mono|c0=c1", cmd)  # "system" -> channel index 1

    def test_mic_channel_uses_channel_index_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "mtg001.wav"
            audio_path.write_bytes(b"stub")
            out_path = Path(tmp) / "out.wav"

            def fake_run(cmd, **kwargs):
                out_path.write_bytes(b"wav-stub")
                return mock.Mock(returncode=0)

            with mock.patch("src.transcriber._resolve_ffmpeg", return_value="/usr/bin/ffmpeg"), \
                 mock.patch("src.speaker_suggestions.subprocess.run", side_effect=fake_run) as run_mock:
                extract_speaker_sample_audio(
                    audio_path, "mic", [{"start": 10.0, "end": 15.0}], out_path,
                )
            cmd = run_mock.call_args[0][0]
            self.assertIn("pan=mono|c0=c0", cmd)

    def test_returns_false_when_ffmpeg_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "mtg001.wav"
            audio_path.write_bytes(b"stub")
            out_path = Path(tmp) / "out.wav"
            with mock.patch("src.transcriber._resolve_ffmpeg", return_value="/usr/bin/ffmpeg"), \
                 mock.patch("src.speaker_suggestions.subprocess.run", return_value=mock.Mock(returncode=1)):
                ok = extract_speaker_sample_audio(
                    audio_path, "mic", [{"start": 4.0, "end": 6.0}], out_path,
                )
            self.assertFalse(ok)

    def test_returns_false_on_timeout(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "mtg001.wav"
            audio_path.write_bytes(b"stub")
            with mock.patch("src.transcriber._resolve_ffmpeg", return_value="/usr/bin/ffmpeg"), \
                 mock.patch(
                     "src.speaker_suggestions.subprocess.run",
                     side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=30),
                 ):
                ok = extract_speaker_sample_audio(
                    audio_path, "mic", [{"start": 4.0, "end": 6.0}], Path(tmp) / "out.wav",
                )
            self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
