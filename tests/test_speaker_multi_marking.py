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

    def test_samples_survive_a_sidecar_with_no_turn_manifest(self):
        # Every sidecar written by backfill-speaker-embeddings has no
        # transcript_lines at all -- only the live pipeline writes one. A
        # samples list sourced from that manifest would come back empty for
        # exactly the historical meetings a human most needs help with, so
        # this reads the saved transcript by timestamp instead.
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
            self.assertEqual([s["text"] for s in samples],
                             ["first excerpt here", "second excerpt here"])

    def test_segment_with_no_transcript_line_still_yields_a_playable_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = Path(tmp) / "t.txt"
            transcript.write_text("[00:10] [Speaker 2] only line\n", encoding="utf-8")
            samples = extract_segment_samples(
                transcript, [{"start": 8.0, "end": 20.0}, {"start": 900.0, "end": 910.0}],
            )
            self.assertEqual(len(samples), 2)
            self.assertIsNone(samples[1]["text"])
            # Kept rather than dropped: the clip is still playable, and a
            # dropped entry would shift every later index out of step with
            # get-speaker-sample-audio --segment-index.
            self.assertEqual(samples[1]["start"], 900.0)

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
