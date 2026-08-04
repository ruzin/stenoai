import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config


def _last_json(output):
    line = [ln for ln in output.splitlines() if ln.strip().startswith("{")][-1]
    return json.loads(line)


class EnrollSelfFromPersonCliTests(unittest.TestCase):
    def _run(self, args, tmp, cfg):
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            result = CliRunner().invoke(simple_recorder.enroll_self_from_person, args)
        return result

    def _add(self, cfg, person_id, meeting_id, sid, recording_type, channel=None,
             embedding=None, duration=25.0):
        return cfg.add_speaker_prototype(
            person_id, embedding or [0.1, 0.2],
            recording_type=recording_type, meeting_id=meeting_id,
            diarization_speaker_id=sid,
            speech_duration_seconds=duration, segment_count=4,
            created_from="user_confirmed", channel=channel,
        )

    def test_happy_path_two_mic_prototypes(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Max")
            self._add(cfg, person["person_id"], "mtg001", "SPEAKER_00", "in_person",
                      channel="mic", embedding=[1.0, 0.0])
            self._add(cfg, person["person_id"], "mtg002", "SPEAKER_00", "in_person",
                      channel="mic", embedding=[0.0, 1.0])
            result = self._run(["Max"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["name"], "Max")
            self.assertEqual(data["prototypes_used"], 2)
            self.assertTrue(data["mic_only"])
            self.assertEqual(data["centroid_sample_count"], 2)

            vp = cfg.get_voiceprint("Max")
            self.assertTrue(vp["is_self"])
            self.assertEqual(len(vp["embeddings"]), 2)

    def test_prefers_mic_prototypes_over_system(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Max")
            self._add(cfg, person["person_id"], "mtg001", "SPEAKER_00", "in_person",
                      channel="mic", embedding=[1.0, 0.0])
            self._add(cfg, person["person_id"], "mtg002", "SPEAKER_00", "remote",
                      channel="system", embedding=[0.0, 1.0])
            result = self._run(["Max"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["prototypes_used"], 1)
            self.assertTrue(data["mic_only"])
            vp = cfg.get_voiceprint("Max")
            self.assertEqual(vp["embeddings"], [[1.0, 0.0]])

    def test_falls_back_to_all_prototypes_when_no_mic_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Max")
            self._add(cfg, person["person_id"], "mtg001", "SPEAKER_00", "remote",
                      channel="system", embedding=[0.0, 1.0])
            result = self._run(["Max"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["prototypes_used"], 1)
            self.assertFalse(data["mic_only"])

    def test_legacy_prototype_without_channel_matches_via_recording_type(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Max")
            self._add(cfg, person["person_id"], "mtg001", "SPEAKER_00", "in_person",
                      embedding=[1.0, 0.0])  # no channel -- legacy shape
            result = self._run(["Max"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertTrue(data["mic_only"])
            self.assertEqual(data["prototypes_used"], 1)

    def test_hard_negatives_never_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Max")
            cfg.add_speaker_prototype(
                person["person_id"], [9.0, 9.0],
                recording_type="in_person", meeting_id="mtg001",
                diarization_speaker_id="SPEAKER_99",
                speech_duration_seconds=25.0, segment_count=4,
                created_from="user_confirmed", channel="mic", negative=True,
            )
            result = self._run(["Max"], tmp, cfg)
            data = _last_json(result.output)
            self.assertFalse(data["success"])
            self.assertIn("no confirmed prototypes", data["error"])

    def test_unknown_person_fails_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            result = self._run(["Nobody"], tmp, cfg)
            self.assertNotEqual(result.exit_code, 0)
            data = _last_json(result.output)
            self.assertFalse(data["success"])

    def test_person_with_no_prototypes_fails_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            cfg.create_person_profile("Max")
            result = self._run(["Max"], tmp, cfg)
            self.assertNotEqual(result.exit_code, 0)
            data = _last_json(result.output)
            self.assertFalse(data["success"])

    def test_resolves_by_person_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Max")
            self._add(cfg, person["person_id"], "mtg001", "SPEAKER_00", "in_person",
                      channel="mic", embedding=[1.0, 0.0])
            result = self._run([person["person_id"]], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["name"], "Max")

    def test_rerunning_updates_rather_than_duplicating(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Max")
            self._add(cfg, person["person_id"], "mtg001", "SPEAKER_00", "in_person",
                      channel="mic", embedding=[1.0, 0.0])
            self._run(["Max"], tmp, cfg)
            self._run(["Max"], tmp, cfg)
            self.assertEqual(len(cfg.get_voiceprints()), 1)
            self.assertEqual(cfg.get_voiceprint("Max")["is_self"], True)


if __name__ == "__main__":
    unittest.main()
