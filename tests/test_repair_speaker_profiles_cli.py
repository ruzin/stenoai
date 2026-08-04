import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config
from src.speaker_suggestions import write_speakers_sidecar


def _report(output):
    # repair-speaker-profiles prints one indent=2 JSON document; parse from
    # the first brace so stray log lines before it don't matter.
    return json.loads(output[output.index("{"):])


class RepairSpeakerProfilesCliTests(unittest.TestCase):
    def _run(self, args, tmp, cfg):
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            result = CliRunner().invoke(simple_recorder.repair_speaker_profiles, args)
        return result

    def _add(self, cfg, person_id, meeting_id, sid, recording_type,
             channel=None, negative=False):
        return cfg.add_speaker_prototype(
            person_id, [0.1, 0.2],
            recording_type=recording_type, meeting_id=meeting_id,
            diarization_speaker_id=sid,
            speech_duration_seconds=25.0, segment_count=4,
            created_from="user_confirmed", channel=channel, negative=negative,
        )

    def _seed_collision_library(self, cfg):
        """Alice confirmed on system SPEAKER_00 (remote); Bob confirmed on
        mic SPEAKER_01 with TWO hard negatives: one legit (Carol's mic
        SPEAKER_02, matching recording_type) and one created by the
        cross-channel collision (cites SPEAKER_00 with the MIC channel's
        recording_type, while the only SPEAKER_00 owner is Alice's remote
        prototype)."""
        alice = cfg.create_person_profile("Alice")
        bob = cfg.create_person_profile("Bob")
        carol = cfg.create_person_profile("Carol")
        self._add(cfg, alice["person_id"], "mtg001", "SPEAKER_00", "remote")
        self._add(cfg, bob["person_id"], "mtg001", "SPEAKER_01", "in_person")
        self._add(cfg, carol["person_id"], "mtg001", "SPEAKER_02", "in_person")
        collision = self._add(
            cfg, bob["person_id"], "mtg001", "SPEAKER_00", "in_person", negative=True,
        )
        legit = self._add(
            cfg, bob["person_id"], "mtg001", "SPEAKER_02", "in_person", negative=True,
        )
        return alice, bob, carol, collision, legit

    def test_dry_run_reports_collision_negative_but_changes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            _, bob, _, _, _ = self._seed_collision_library(cfg)
            result = self._run([], tmp, cfg)
            report = _report(result.output)
            self.assertTrue(report["success"])
            self.assertFalse(report["applied"])
            self.assertEqual(report["collision_negatives_dropped"], 1)
            # Dry run: both negatives still there.
            self.assertEqual(len(cfg.get_person_profile(bob["person_id"])["hard_negatives"]), 2)

    def test_apply_drops_only_the_collision_negative(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            _, bob, _, collision, legit = self._seed_collision_library(cfg)
            result = self._run(["--apply"], tmp, cfg)
            report = _report(result.output)
            self.assertTrue(report["applied"])
            self.assertEqual(report["collision_negatives_dropped"], 1)
            negatives = cfg.get_person_profile(bob["person_id"])["hard_negatives"]
            self.assertEqual([n["prototype_id"] for n in negatives], [legit["prototype_id"]])

    def test_negative_with_unknown_recording_type_is_never_dropped(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            alice = cfg.create_person_profile("Alice")
            bob = cfg.create_person_profile("Bob")
            self._add(cfg, alice["person_id"], "mtg001", "SPEAKER_00", "remote")
            self._add(cfg, bob["person_id"], "mtg001", "SPEAKER_00", "unknown", negative=True)
            result = self._run(["--apply"], tmp, cfg)
            report = _report(result.output)
            self.assertEqual(report["collision_negatives_dropped"], 0)
            self.assertEqual(len(cfg.get_person_profile(bob["person_id"])["hard_negatives"]), 1)

    def test_apply_dedupes_keeping_the_oldest(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            alice = cfg.create_person_profile("Alice")
            older = self._add(cfg, alice["person_id"], "mtg002", "SPEAKER_00", "in_person", channel="mic")
            newer = self._add(cfg, alice["person_id"], "mtg002", "SPEAKER_00", "in_person", channel="mic")
            # Make the ordering unambiguous regardless of clock resolution.
            profile = cfg.get_person_profile(alice["person_id"])
            for p in profile["prototypes"]:
                if p["prototype_id"] == newer["prototype_id"]:
                    p["created_at"] = older["created_at"] + 100
            result = self._run(["--apply"], tmp, cfg)
            report = _report(result.output)
            self.assertEqual(report["duplicates_removed"], 1)
            remaining = cfg.get_person_profile(alice["person_id"])["prototypes"]
            self.assertEqual([p["prototype_id"] for p in remaining], [older["prototype_id"]])

    def test_same_sid_on_different_channels_is_not_a_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            alice = cfg.create_person_profile("Alice")
            self._add(cfg, alice["person_id"], "mtg002", "SPEAKER_00", "in_person", channel="mic")
            self._add(cfg, alice["person_id"], "mtg002", "SPEAKER_00", "remote", channel="system")
            result = self._run(["--apply"], tmp, cfg)
            report = _report(result.output)
            self.assertEqual(report["duplicates_removed"], 0)
            self.assertEqual(len(cfg.get_person_profile(alice["person_id"])["prototypes"]), 2)

    def test_apply_backfills_channel_from_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            # mtg003: SPEAKER_00 exists only on mic -- unambiguous.
            write_speakers_sidecar(output_dir, "mtg003", {
                "mic": {"recording_type": "in_person",
                        "clusters": {"SPEAKER_00": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5}}},
            })
            # mtg004: both channels have a SPEAKER_00 -- disambiguated via
            # the entry's recording_type (remote -> system).
            write_speakers_sidecar(output_dir, "mtg004", {
                "mic": {"recording_type": "in_person",
                        "clusters": {"SPEAKER_00": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5}}},
                "system": {"recording_type": "remote",
                           "clusters": {"SPEAKER_00": {"embedding": [0.0, 1.0], "speech_duration_seconds": 30.0, "segment_count": 5}}},
            })
            cfg = Config(config_path=Path(tmp) / "config.json")
            alice = cfg.create_person_profile("Alice")
            unambiguous = self._add(cfg, alice["person_id"], "mtg003", "SPEAKER_00", "in_person")
            disambiguated = self._add(cfg, alice["person_id"], "mtg004", "SPEAKER_00", "remote")
            orphan = self._add(cfg, alice["person_id"], "mtg_gone", "SPEAKER_00", "in_person")

            result = self._run(["--apply"], tmp, cfg)
            report = _report(result.output)
            self.assertEqual(report["channels_backfilled"], 2)

            by_id = {
                p["prototype_id"]: p
                for p in cfg.get_person_profile(alice["person_id"])["prototypes"]
            }
            self.assertEqual(by_id[unambiguous["prototype_id"]]["channel"], "mic")
            self.assertEqual(by_id[disambiguated["prototype_id"]]["channel"], "system")
            # No sidecar left for this meeting: stays legacy, keeps the
            # recording_type fallback path.
            self.assertNotIn("channel", by_id[orphan["prototype_id"]])

    def test_clean_library_reports_all_zeroes(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            alice = cfg.create_person_profile("Alice")
            self._add(cfg, alice["person_id"], "mtg001", "SPEAKER_00", "in_person", channel="mic")
            result = self._run(["--apply"], tmp, cfg)
            report = _report(result.output)
            self.assertEqual(report["collision_negatives_dropped"], 0)
            self.assertEqual(report["duplicates_removed"], 0)
            self.assertEqual(report["channels_backfilled"], 0)


if __name__ == "__main__":
    unittest.main()
