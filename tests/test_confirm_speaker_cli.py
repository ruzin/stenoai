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


if __name__ == "__main__":
    unittest.main()
