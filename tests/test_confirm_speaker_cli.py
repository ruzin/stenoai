import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config
from src.speaker_suggestions import write_speakers_sidecar


def _last_json(output):
    line = [ln for ln in output.splitlines() if ln.strip().startswith("{")][-1]
    return json.loads(line)


class ConfirmSpeakerCliTests(unittest.TestCase):
    def _run(self, args, tmp, cfg=None):
        cfg = cfg or Config(config_path=Path(tmp) / "config.json")
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            result = CliRunner().invoke(simple_recorder.confirm_speaker, args)
        return result, cfg

    def _seed_sidecar(self, tmp, meeting_stem="mtg001"):
        output_dir = Path(tmp) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        write_speakers_sidecar(output_dir, meeting_stem, {
            "mic": {
                "recording_type": "in_person",
                "clusters": {
                    "SPEAKER_00": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5},
                    "SPEAKER_01": {"embedding": [0.0, 1.0], "speech_duration_seconds": 25.0, "segment_count": 4},
                },
            },
        })

    def test_requires_exactly_one_of_person_id_or_new_person(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            result, _ = self._run(["mtg001", "mic", "SPEAKER_00"], tmp)
            self.assertNotEqual(result.exit_code, 0)
            self.assertFalse(_last_json(result.output)["success"])

    def test_rejects_both_person_id_and_new_person(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            result, _ = self._run(
                ["mtg001", "mic", "SPEAKER_00", "--person-id", "x", "--new-person", "Max"], tmp,
            )
            self.assertNotEqual(result.exit_code, 0)

    def test_new_person_creates_profile_and_prototype(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            result, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["display_name"], "Max")
            self.assertEqual(data["hard_negatives_added_against"], [])

            profile = cfg.get_person_profile(data["person_id"])
            self.assertEqual(len(profile["prototypes"]), 1)
            self.assertEqual(profile["prototypes"][0]["embedding_mean"], [1.0, 0.0])
            self.assertEqual(profile["prototypes"][0]["recording_type"], "in_person")
            self.assertEqual(profile["prototypes"][0]["diarization_speaker_id"], "SPEAKER_00")
            self.assertEqual(profile["prototypes"][0]["channel"], "mic")
            self.assertEqual(profile["prototypes"][0]["created_from"], "user_confirmed")

    def test_existing_person_id_adds_second_prototype(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            existing = cfg.create_person_profile("Max")
            result, cfg = self._run(
                ["mtg001", "mic", "SPEAKER_00", "--person-id", existing["person_id"]], tmp, cfg=cfg,
            )
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["person_id"], existing["person_id"])
            profile = cfg.get_person_profile(existing["person_id"])
            self.assertEqual(len(profile["prototypes"]), 1)

    def test_new_person_with_existing_name_fails_gracefully(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            cfg.create_person_profile("Max")
            result, cfg = self._run(
                ["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp, cfg=cfg,
            )
            self.assertNotEqual(result.exit_code, 0)
            data = _last_json(result.output)
            self.assertFalse(data["success"])
            self.assertIn("already exists", data["error"])
            # No second profile, no prototype added anywhere -- the whole
            # confirm bails out before touching any state.
            self.assertEqual(len(cfg.get_person_profiles()), 1)
            self.assertEqual(cfg.get_person_profiles()[0]["prototypes"], [])

    def test_unknown_person_id_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            result, _ = self._run(["mtg001", "mic", "SPEAKER_00", "--person-id", "nonexistent"], tmp)
            self.assertNotEqual(result.exit_code, 0)
            self.assertFalse(_last_json(result.output)["success"])

    def test_missing_sidecar_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "output").mkdir(parents=True, exist_ok=True)
            result, _ = self._run(["mtg_nonexistent", "mic", "SPEAKER_00", "--new-person", "Max"], tmp)
            self.assertNotEqual(result.exit_code, 0)

    def test_unknown_cluster_id_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            result, _ = self._run(["mtg001", "mic", "SPEAKER_99", "--new-person", "Max"], tmp)
            self.assertNotEqual(result.exit_code, 0)

    def test_second_confirmation_in_same_meeting_creates_mutual_hard_negatives(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            result1, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp, cfg=cfg)
            max_id = _last_json(result1.output)["person_id"]

            result2, cfg = self._run(["mtg001", "mic", "SPEAKER_01", "--new-person", "Sarah"], tmp, cfg=cfg)
            data2 = _last_json(result2.output)
            sarah_id = data2["person_id"]
            self.assertEqual(data2["hard_negatives_added_against"], ["Max"])

            max_profile = cfg.get_person_profile(max_id)
            sarah_profile = cfg.get_person_profile(sarah_id)

            # Max has one positive prototype (his own cluster) and one
            # hard-negative (Sarah's cluster) -- and vice versa.
            self.assertEqual(len(max_profile["prototypes"]), 1)
            self.assertEqual(max_profile["prototypes"][0]["embedding_mean"], [1.0, 0.0])
            self.assertEqual(len(max_profile["hard_negatives"]), 1)
            self.assertEqual(max_profile["hard_negatives"][0]["embedding_mean"], [0.0, 1.0])

            self.assertEqual(len(sarah_profile["prototypes"]), 1)
            self.assertEqual(sarah_profile["prototypes"][0]["embedding_mean"], [0.0, 1.0])
            self.assertEqual(len(sarah_profile["hard_negatives"]), 1)
            self.assertEqual(sarah_profile["hard_negatives"][0]["embedding_mean"], [1.0, 0.0])

    def _seed_three_cluster_sidecar(self, tmp, meeting_stem="mtg001"):
        """One channel, three clusters -- the shape that appears as soon as the
        diarizer splits one person across two clusters, which is the normal
        case under deliberate over-segmentation."""
        output_dir = Path(tmp) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        write_speakers_sidecar(output_dir, meeting_stem, {
            "mic": {
                "recording_type": "in_person",
                "clusters": {
                    # Two clusters of ONE voice, deliberately far enough apart
                    # that merge_same_channel_fragments leaves them separate.
                    "SPEAKER_00": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5},
                    "SPEAKER_02": {"embedding": [0.0, 0.0, 1.0], "speech_duration_seconds": 20.0, "segment_count": 4},
                    "SPEAKER_01": {"embedding": [0.0, 1.0], "speech_duration_seconds": 25.0, "segment_count": 4},
                },
            },
        })

    def test_one_person_owning_two_clusters_keeps_both_hard_negatives(self):
        # Many-to-one: the user assigns SPEAKER_00 and SPEAKER_02 to Max, and
        # SPEAKER_01 to Sarah. Sarah must be a hard negative against BOTH of
        # Max's clusters -- the loop matched only the FIRST prototype per
        # person (`next(...)`), so the second cluster of a person silently
        # produced no negative evidence at all.
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_three_cluster_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            r1, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp, cfg=cfg)
            max_id = _last_json(r1.output)["person_id"]
            _, cfg = self._run(["mtg001", "mic", "SPEAKER_02", "--person-id", max_id], tmp, cfg=cfg)
            r3, cfg = self._run(["mtg001", "mic", "SPEAKER_01", "--new-person", "Sarah"], tmp, cfg=cfg)
            sarah_id = _last_json(r3.output)["person_id"]

            max_profile = cfg.get_person_profile(max_id)
            sarah_profile = cfg.get_person_profile(sarah_id)

            self.assertEqual(
                len(max_profile["prototypes"]), 2,
                "one person may own several clusters of the same meeting",
            )
            negative_sids = sorted(
                h.get("diarization_speaker_id") for h in sarah_profile["hard_negatives"]
            )
            self.assertEqual(
                negative_sids, ["SPEAKER_00", "SPEAKER_02"],
                "Sarah is demonstrably not either of Max's clusters",
            )

    def test_reassigning_one_cluster_keeps_the_persons_other_negatives(self):
        # The displaced person's negatives were removed for the WHOLE
        # meeting+channel rather than only those citing the cluster being
        # taken away. With one person owning two clusters that silently
        # stripped the evidence belonging to the cluster they keep.
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_three_cluster_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            r1, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp, cfg=cfg)
            max_id = _last_json(r1.output)["person_id"]
            _, cfg = self._run(["mtg001", "mic", "SPEAKER_02", "--person-id", max_id], tmp, cfg=cfg)
            _, cfg = self._run(["mtg001", "mic", "SPEAKER_01", "--new-person", "Sarah"], tmp, cfg=cfg)

            # Max loses SPEAKER_02 to a third person; SPEAKER_00 stays his.
            _, cfg = self._run(["mtg001", "mic", "SPEAKER_02", "--new-person", "Tom"], tmp, cfg=cfg)

            max_profile = cfg.get_person_profile(max_id)
            self.assertEqual(
                [p["diarization_speaker_id"] for p in max_profile["prototypes"]], ["SPEAKER_00"],
            )
            negative_sids = sorted(
                h.get("diarization_speaker_id") for h in max_profile["hard_negatives"]
            )
            self.assertIn(
                "SPEAKER_01", negative_sids,
                "the evidence that Max is not Sarah belongs to the cluster he kept",
            )

    def test_hard_negatives_scoped_to_same_channel_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {"SPEAKER_00": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5}},
                },
                "system": {
                    "recording_type": "remote",
                    "clusters": {"SPEAKER_00": {"embedding": [0.0, 1.0], "speech_duration_seconds": 30.0, "segment_count": 5}},
                },
            })
            cfg = Config(config_path=Path(tmp) / "config.json")
            result1, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp, cfg=cfg)
            result2, cfg = self._run(["mtg001", "system", "SPEAKER_00", "--new-person", "RemoteGuest"], tmp, cfg=cfg)
            data2 = _last_json(result2.output)
            # Same meeting, but a DIFFERENT channel -- must not be treated
            # as confirmed-different (mic vs. system isn't reliable
            # cross-channel negative evidence, e.g. echo/feedback bleed).
            self.assertEqual(data2["hard_negatives_added_against"], [])

    def test_cross_channel_id_collision_does_not_create_hard_negatives(self):
        # The real collision shape: the OTHER channel's confirmed sid
        # (system SPEAKER_00) also exists as a DIFFERENT cluster id in the
        # channel being confirmed (mic SPEAKER_00, an unrelated voice).
        # Without channel scoping, confirming mic SPEAKER_01 would mistake
        # Alice (system SPEAKER_00) for a same-channel confirmation and
        # record negatives built from mic SPEAKER_00's embedding.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        # distance 0.4 apart -- far enough not to merge.
                        "SPEAKER_00": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5},
                        "SPEAKER_01": {"embedding": [0.6, 0.8], "speech_duration_seconds": 25.0, "segment_count": 4},
                    },
                },
                "system": {
                    "recording_type": "remote",
                    "clusters": {"SPEAKER_00": {"embedding": [0.0, 1.0], "speech_duration_seconds": 30.0, "segment_count": 5}},
                },
            })
            cfg = Config(config_path=Path(tmp) / "config.json")
            result1, cfg = self._run(["mtg001", "system", "SPEAKER_00", "--new-person", "Alice"], tmp, cfg=cfg)
            alice_id = _last_json(result1.output)["person_id"]
            result2, cfg = self._run(["mtg001", "mic", "SPEAKER_01", "--new-person", "Bob"], tmp, cfg=cfg)
            data2 = _last_json(result2.output)
            self.assertEqual(data2["hard_negatives_added_against"], [])
            self.assertEqual(cfg.get_person_profile(alice_id)["hard_negatives"], [])
            self.assertEqual(cfg.get_person_profile(data2["person_id"])["hard_negatives"], [])

    def test_legacy_prototype_without_channel_still_matches_via_recording_type(self):
        # A prototype confirmed before the channel field existed must still
        # count as a same-channel confirmation via the recording_type proxy.
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            alice = cfg.create_person_profile("Alice")
            cfg.add_speaker_prototype(
                alice["person_id"], [1.0, 0.0],
                recording_type="in_person", meeting_id="mtg001",
                diarization_speaker_id="SPEAKER_00",
                speech_duration_seconds=30.0, segment_count=5,
                created_from="user_confirmed",  # no channel -- legacy shape
            )
            result, cfg = self._run(["mtg001", "mic", "SPEAKER_01", "--new-person", "Bob"], tmp, cfg=cfg)
            data = _last_json(result.output)
            self.assertEqual(data["hard_negatives_added_against"], ["Alice"])

    def test_reconfirming_cluster_as_different_person_reassigns(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            result1, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Alice"], tmp, cfg=cfg)
            alice_id = _last_json(result1.output)["person_id"]

            result2, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Bob"], tmp, cfg=cfg)
            data2 = _last_json(result2.output)
            self.assertEqual(data2["reassigned_from"], ["Alice"])
            self.assertEqual(data2["participants_updated"], ["Bob"])

            # Alice's wrong prototype is gone -- not kept alongside Bob's.
            self.assertEqual(cfg.get_person_profile(alice_id)["prototypes"], [])
            bob = cfg.get_person_profile(data2["person_id"])
            self.assertEqual(len(bob["prototypes"]), 1)
            self.assertEqual(bob["prototypes"][0]["created_from"], "user_corrected")

    def test_reconfirming_same_person_replaces_instead_of_duplicating(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            result1, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Alice"], tmp, cfg=cfg)
            alice_id = _last_json(result1.output)["person_id"]
            result2, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--person-id", alice_id], tmp, cfg=cfg)
            data2 = _last_json(result2.output)
            self.assertTrue(data2["success"])
            self.assertEqual(data2["reassigned_from"], [])
            profile = cfg.get_person_profile(alice_id)
            self.assertEqual(len(profile["prototypes"]), 1)
            # A plain re-confirm is not a correction.
            self.assertEqual(profile["prototypes"][0]["created_from"], "user_confirmed")

    def test_reassignment_cleans_stale_hard_negatives_and_rebuilds(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            result1, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Alice"], tmp, cfg=cfg)
            alice_id = _last_json(result1.output)["person_id"]
            result2, cfg = self._run(["mtg001", "mic", "SPEAKER_01", "--new-person", "Bob"], tmp, cfg=cfg)
            bob_id = _last_json(result2.output)["person_id"]

            # Wrong call discovered: SPEAKER_00 was actually Carol.
            result3, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Carol"], tmp, cfg=cfg)
            data3 = _last_json(result3.output)
            self.assertEqual(data3["reassigned_from"], ["Alice"])
            self.assertEqual(data3["hard_negatives_added_against"], ["Bob"])

            alice = cfg.get_person_profile(alice_id)
            bob = cfg.get_person_profile(bob_id)
            carol = cfg.get_person_profile(data3["person_id"])
            # Alice was never in this meeting: no positives, no negatives.
            self.assertEqual(alice["prototypes"], [])
            self.assertEqual(alice["hard_negatives"], [])
            # Bob's negative citing SPEAKER_00 was rebuilt (once, not
            # stacked on the stale one from Alice's wrongful confirm).
            self.assertEqual(len(bob["hard_negatives"]), 1)
            self.assertEqual(bob["hard_negatives"][0]["embedding_mean"], [1.0, 0.0])
            self.assertEqual(len(carol["hard_negatives"]), 1)
            self.assertEqual(carol["hard_negatives"][0]["embedding_mean"], [0.0, 1.0])
            self.assertEqual(carol["prototypes"][0]["created_from"], "user_corrected")

    def test_relabel_transcript_flag_rewrites_saved_transcript(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        "SPEAKER_00": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5,
                            "segments": [{"start": 4.0, "end": 6.0}],
                        },
                    },
                },
            })
            transcripts_dir = Path(tmp) / "transcripts"
            transcripts_dir.mkdir(parents=True, exist_ok=True)
            transcript_path = transcripts_dir / "mtg001_transcript.txt"
            transcript_path.write_text(
                "Session: mtg001\n\n" + "=" * 60 + "\n\n"
                "[00:05] [Speaker 2] hello there\n\n[00:20] [You] hi back",
                encoding="utf-8",
            )
            result, _ = self._run(
                ["mtg001", "mic", "SPEAKER_00", "--new-person", "Max", "--relabel-transcript"], tmp,
            )
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["relabeled_lines"], 1)
            text = transcript_path.read_text()
            self.assertIn("[00:05] [Max] hello there", text)
            self.assertIn("[00:20] [You] hi back", text)  # untouched

    def test_relabel_transcript_uses_exact_matching_when_sidecar_has_manifest(self):
        # See the plan doc's Phase 8: when the sidecar carries
        # transcript_lines (written by a post-Phase-8 live pipeline run),
        # confirm-speaker must relabel by EXACT recorded (channel, sid)
        # provenance, not the fuzzy timestamp matching the other tests in
        # this class exercise -- proven here by a line whose TIMESTAMP
        # would fuzzy-match the confirmed cluster's segment, but whose
        # manifest entry says it came from a DIFFERENT cluster: it must be
        # left untouched.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        "SPEAKER_00": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5,
                            "segments": [{"start": 4.0, "end": 6.0}],
                        },
                    },
                },
            }, turn_manifest=[
                {"start": 5.2, "channel": "mic", "diarization_speaker_id": "SPEAKER_99"},
            ])
            transcripts_dir = Path(tmp) / "transcripts"
            transcripts_dir.mkdir(parents=True, exist_ok=True)
            transcript_path = transcripts_dir / "mtg001_transcript.txt"
            transcript_path.write_text(
                "Session: mtg001\n\n" + "=" * 60 + "\n\n[00:05] [Speaker 2] hello there",
                encoding="utf-8",
            )
            result, _ = self._run(
                ["mtg001", "mic", "SPEAKER_00", "--new-person", "Max", "--relabel-transcript"], tmp,
            )
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            # Fuzzy matching would have relabeled this (00:05 falls inside
            # SPEAKER_00's [4.0, 6.0] segment) -- exact matching correctly
            # refuses, since the manifest says this line is SPEAKER_99.
            self.assertEqual(data["relabeled_lines"], 0)
            self.assertIn("[00:05] [Speaker 2] hello there", transcript_path.read_text())

    def test_relabel_transcript_exact_match_relabels_the_right_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        "SPEAKER_00": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5,
                            "segments": [{"start": 4.0, "end": 6.0}],
                        },
                    },
                },
            }, turn_manifest=[
                {"start": 5.2, "channel": "mic", "diarization_speaker_id": "SPEAKER_00"},
            ])
            transcripts_dir = Path(tmp) / "transcripts"
            transcripts_dir.mkdir(parents=True, exist_ok=True)
            transcript_path = transcripts_dir / "mtg001_transcript.txt"
            transcript_path.write_text(
                "Session: mtg001\n\n" + "=" * 60 + "\n\n[00:05] [Speaker 2] hello there",
                encoding="utf-8",
            )
            result, _ = self._run(
                ["mtg001", "mic", "SPEAKER_00", "--new-person", "Max", "--relabel-transcript"], tmp,
            )
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["relabeled_lines"], 1)
            self.assertIn("[00:05] [Max] hello there", transcript_path.read_text())

    def test_without_relabel_flag_transcript_is_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        "SPEAKER_00": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5,
                            "segments": [{"start": 4.0, "end": 6.0}],
                        },
                    },
                },
            })
            transcripts_dir = Path(tmp) / "transcripts"
            transcripts_dir.mkdir(parents=True, exist_ok=True)
            transcript_path = transcripts_dir / "mtg001_transcript.txt"
            original = (
                "Session: mtg001\n\n" + "=" * 60 + "\n\n[00:05] [Speaker 2] hello there"
            )
            transcript_path.write_text(original, encoding="utf-8")
            result, _ = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["relabeled_lines"], 0)
            self.assertEqual(transcript_path.read_text(), original)

    def test_either_merged_fragment_id_resolves_to_same_combined_prototype(self):
        # Two diarizer IDs on the same channel that are really the same
        # continuous voice (near-identical embeddings, e.g. one real
        # speaker fragmented over a long recording -- see the plan doc's
        # Phase 3.6) must produce the SAME prototype regardless of which
        # fragment id is named on the command line.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 1600.0, "segment_count": 580},
                        "SPEAKER_2": {"embedding": [0.995, 0.0999], "speech_duration_seconds": 1538.0, "segment_count": 552},
                    },
                },
            })
            result, cfg = self._run(["mtg001", "system", "SPEAKER_2", "--new-person", "Julian"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            # SPEAKER_2 has less duration than SPEAKER_0 -> SPEAKER_0 is
            # the merge-group primary, even though SPEAKER_2 was requested.
            self.assertEqual(data["resolved_diarization_speaker_id"], "SPEAKER_0")
            self.assertEqual(data["merged_from"], ["SPEAKER_2"])

            profile = cfg.get_person_profile(data["person_id"])
            self.assertEqual(len(profile["prototypes"]), 1)
            prototype = profile["prototypes"][0]
            self.assertEqual(prototype["diarization_speaker_id"], "SPEAKER_0")
            self.assertAlmostEqual(prototype["speech_duration_seconds"], 1600.0 + 1538.0)
            self.assertEqual(prototype["segment_count"], 580 + 552)


class ConfirmSpeakerUpdatesParticipantsTests(unittest.TestCase):
    """Confirming a speaker should keep the meeting summary's `participants`
    (JSON field / `## Participants` markdown section) in sync -- see the
    plan doc's Phase 7."""

    def _run(self, args, tmp, cfg=None):
        cfg = cfg or Config(config_path=Path(tmp) / "config.json")
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            result = CliRunner().invoke(simple_recorder.confirm_speaker, args)
        return result, cfg

    def _seed_sidecar(self, tmp, meeting_stem="mtg001"):
        output_dir = Path(tmp) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        write_speakers_sidecar(output_dir, meeting_stem, {
            "mic": {
                "recording_type": "in_person",
                "clusters": {
                    "SPEAKER_00": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5},
                    "SPEAKER_01": {"embedding": [0.0, 1.0], "speech_duration_seconds": 25.0, "segment_count": 4},
                },
            },
        })
        return output_dir

    def test_updates_json_summary_participants(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed_sidecar(tmp)
            summary_path = output_dir / "mtg001_summary.json"
            summary_path.write_text(json.dumps({"session_info": {}, "participants": []}), encoding="utf-8")

            result, _ = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["participants_updated"], ["Max"])

            on_disk = json.loads(summary_path.read_text())
            self.assertEqual(on_disk["participants"], ["Max"])

    def test_inserts_participants_section_into_markdown_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed_sidecar(tmp)
            summary_path = output_dir / "mtg001_summary.md"
            summary_path.write_text(
                "---\ntitle: \"Mtg\"\n---\n\n## Summary\n\nSome notes.\n\n## Key Points\n\n- a point\n",
                encoding="utf-8",
            )

            result, _ = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp)
            self.assertTrue(_last_json(result.output)["success"])

            text = summary_path.read_text()
            self.assertIn("## Participants\n\nMax", text)
            # Inserted after Summary, before Key Points -- and Key Points
            # itself is untouched.
            self.assertLess(text.index("## Summary"), text.index("## Participants"))
            self.assertLess(text.index("## Participants"), text.index("## Key Points"))
            self.assertIn("- a point", text)

    def test_replaces_existing_participants_section_not_duplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed_sidecar(tmp)
            summary_path = output_dir / "mtg001_summary.md"
            summary_path.write_text(
                "---\ntitle: \"Mtg\"\n---\n\n## Summary\n\nSome notes.\n\n"
                "## Participants\n\nOldName\n\n## Key Points\n\n- a point\n",
                encoding="utf-8",
            )

            result, _ = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp)
            self.assertTrue(_last_json(result.output)["success"])

            text = summary_path.read_text()
            self.assertEqual(text.count("## Participants"), 1)
            self.assertIn("## Participants\n\nMax", text)
            self.assertNotIn("OldName", text)
            self.assertIn("- a point", text)

    def test_second_person_confirmed_in_same_meeting_appends_not_clobbers(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = self._seed_sidecar(tmp)
            summary_path = output_dir / "mtg001_summary.md"
            summary_path.write_text("---\ntitle: \"Mtg\"\n---\n\n## Summary\n\nSome notes.\n", encoding="utf-8")
            cfg = Config(config_path=Path(tmp) / "config.json")

            _, cfg = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp, cfg=cfg)
            result, _ = self._run(["mtg001", "mic", "SPEAKER_01", "--new-person", "Julian"], tmp, cfg=cfg)
            self.assertTrue(_last_json(result.output)["success"])

            text = summary_path.read_text()
            self.assertIn("## Participants\n\nMax, Julian", text)

    def test_noops_when_no_summary_file_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar(tmp)  # no _summary.json/.md written at all
            result, _ = self._run(["mtg001", "mic", "SPEAKER_00", "--new-person", "Max"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["participants_updated"], ["Max"])  # computed fine, just nothing to write to


if __name__ == "__main__":
    unittest.main()
