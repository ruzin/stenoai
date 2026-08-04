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


class BackfillParticipantsCliTests(unittest.TestCase):
    """backfill-participants: recompute+write Participants for every
    meeting a person-profile prototype was confirmed in BEFORE this
    feature existed (see the plan doc's Phase 7) -- creates no new
    prototypes, only rewrites summary files (and, with
    --relabel-transcripts, saved transcripts)."""

    def _run(self, args, tmp, cfg):
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            result = CliRunner().invoke(simple_recorder.backfill_participants, args)
        return result

    def _confirm(self, cfg, person_name, meeting_id, sid="SPEAKER_00", recording_type="in_person"):
        person = cfg.create_person_profile(person_name)
        cfg.add_speaker_prototype(
            person["person_id"], [1.0, 0.0],
            recording_type=recording_type, meeting_id=meeting_id,
            diarization_speaker_id=sid,
            speech_duration_seconds=30.0, segment_count=5,
            created_from="user_confirmed",
        )
        return person

    def test_writes_participants_for_meeting_with_no_prior_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / "mtg001_summary.md").write_text(
                "---\ntitle: \"Mtg\"\n---\n\n## Summary\n\nNotes.\n", encoding="utf-8",
            )
            cfg = Config(config_path=Path(tmp) / "config.json")
            self._confirm(cfg, "Max", "mtg001")

            result = self._run([], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["meetings_updated"], [{"meeting_id": "mtg001", "participants": ["Max"]}])
            self.assertIn("## Participants\n\nMax", (output_dir / "mtg001_summary.md").read_text())

    def test_covers_every_meeting_across_multiple_people(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            for stem in ("mtg001", "mtg002"):
                (output_dir / f"{stem}_summary.json").write_text(
                    json.dumps({"session_info": {}, "participants": []}), encoding="utf-8",
                )
            cfg = Config(config_path=Path(tmp) / "config.json")
            self._confirm(cfg, "Max", "mtg001")
            self._confirm(cfg, "Julian", "mtg002")

            result = self._run([], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            by_id = {m["meeting_id"]: m["participants"] for m in data["meetings_updated"]}
            self.assertEqual(by_id, {"mtg001": ["Max"], "mtg002": ["Julian"]})
            self.assertEqual(
                json.loads((output_dir / "mtg001_summary.json").read_text())["participants"], ["Max"],
            )
            self.assertEqual(
                json.loads((output_dir / "mtg002_summary.json").read_text())["participants"], ["Julian"],
            )

    def test_no_person_profiles_is_a_noop(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(config_path=Path(tmp) / "config.json")
            result = self._run([], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["meetings_updated"], [])

    def test_relabel_transcripts_flag_off_by_default(self):
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
            original = "Session: mtg001\n\n" + "=" * 60 + "\n\n[00:05] [Speaker 2] hello there"
            transcript_path.write_text(original, encoding="utf-8")
            cfg = Config(config_path=Path(tmp) / "config.json")
            self._confirm(cfg, "Max", "mtg001")

            result = self._run([], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["transcripts_relabeled"], {})
            self.assertEqual(transcript_path.read_text(), original)  # untouched

    def test_relabel_transcripts_flag_relabels_confirmed_clusters(self):
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
            cfg = Config(config_path=Path(tmp) / "config.json")
            self._confirm(cfg, "Max", "mtg001")

            result = self._run(["--relabel-transcripts"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["transcripts_relabeled"], {"mtg001": 1})
            text = transcript_path.read_text()
            self.assertIn("[00:05] [Max] hello there", text)
            self.assertIn("[00:20] [You] hi back", text)  # never touches You

    def test_relabel_transcripts_uses_exact_matching_when_sidecar_has_manifest(self):
        # See the plan doc's Phase 8: when a meeting's sidecar has
        # transcript_lines, the backfill must relabel by exact recorded
        # provenance, not relabel_transcript_multi's fuzzy timestamp
        # matching -- proven by a line that WOULD fuzzy-match the
        # confirmed cluster's segment but whose manifest entry names a
        # different cluster, and must stay untouched.
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
            cfg = Config(config_path=Path(tmp) / "config.json")
            self._confirm(cfg, "Max", "mtg001")

            result = self._run(["--relabel-transcripts"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["transcripts_relabeled"], {})
            # Exact matching has no "ambiguous" concept (unlike the fuzzy
            # path's collision detection) -- it just finds nothing to
            # relabel, silently and correctly.
            self.assertEqual(data["transcripts_skipped_ambiguous"], {})
            self.assertIn("[00:05] [Speaker 2] hello there", transcript_path.read_text())

    def test_relabel_transcripts_exact_match_relabels_the_right_line(self):
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
            cfg = Config(config_path=Path(tmp) / "config.json")
            self._confirm(cfg, "Max", "mtg001")

            result = self._run(["--relabel-transcripts"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["transcripts_relabeled"], {"mtg001": 1})
            self.assertIn("[00:05] [Max] hello there", transcript_path.read_text())

    def test_relabel_transcripts_is_idempotent_on_already_relabeled_meeting(self):
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
            # Already relabeled (e.g. confirmed via the UI, which always
            # passes --relabel-transcript at confirm time already).
            transcript_path.write_text(
                "Session: mtg001\n\n" + "=" * 60 + "\n\n[00:05] [Max] hello there",
                encoding="utf-8",
            )
            cfg = Config(config_path=Path(tmp) / "config.json")
            self._confirm(cfg, "Max", "mtg001")

            result = self._run(["--relabel-transcripts"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["transcripts_relabeled"], {})  # nothing changed, already correct

    def test_cross_channel_collision_is_skipped_not_guessed(self):
        # Reproduces the real bug found running this against production
        # data: a mic-channel cluster and a system-channel cluster both
        # have a segment claiming the SAME transcript line's timestamp
        # (routine, since both channels' clusters typically span nearly
        # the whole meeting). Must leave that line untouched and report it
        # under transcripts_skipped_ambiguous -- not let iteration order
        # silently decide which channel's speaker "wins" the line.
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
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_00": {
                            "embedding": [0.0, 1.0], "speech_duration_seconds": 30.0, "segment_count": 5,
                            "segments": [{"start": 4.2, "end": 5.8}],
                        },
                    },
                },
            })
            transcripts_dir = Path(tmp) / "transcripts"
            transcripts_dir.mkdir(parents=True, exist_ok=True)
            transcript_path = transcripts_dir / "mtg001_transcript.txt"
            transcript_path.write_text(
                "Session: mtg001\n\n" + "=" * 60 + "\n\n[00:05] [Speaker 3] contested line",
                encoding="utf-8",
            )
            cfg = Config(config_path=Path(tmp) / "config.json")
            self._confirm(cfg, "Valentin Weyer", "mtg001", sid="SPEAKER_00", recording_type="in_person")
            self._confirm(cfg, "Inga Hahn", "mtg001", sid="SPEAKER_00", recording_type="remote")

            result = self._run(["--relabel-transcripts"], tmp, cfg)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertEqual(data["transcripts_relabeled"], {})
            self.assertEqual(data["transcripts_skipped_ambiguous"], {"mtg001": 1})
            self.assertIn("[00:05] [Speaker 3] contested line", transcript_path.read_text())


if __name__ == "__main__":
    unittest.main()
