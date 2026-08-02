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


class SuggestSpeakersCliTests(unittest.TestCase):
    """Covers the identification anchors (channel/duration/segment_count/
    first_timestamp) added to each cluster's output -- without these, a
    human reviewing an "Unidentified speaker" row in the UI has no way to
    go find and listen to that speaker in the recording to figure out who
    they actually are."""

    def _run(self, args, tmp, cfg=None):
        cfg = cfg or Config(config_path=Path(tmp) / "config.json")
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            result = CliRunner().invoke(simple_recorder.suggest_speakers, args)
        return result

    def test_includes_duration_segment_count_and_first_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 30.5, "segment_count": 5,
                            "segments": [{"start": 12.0, "end": 14.0}, {"start": 30.0, "end": 32.0}],
                        },
                    },
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            cluster = data["channels"]["system"]["SPEAKER_0"]
            self.assertEqual(cluster["speech_duration_seconds"], 30.5)
            self.assertEqual(cluster["segment_count"], 5)
            self.assertEqual(cluster["first_timestamp"], "00:12")

    def test_first_timestamp_is_null_when_no_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 5},
                    },
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertIsNone(data["channels"]["mic"]["SPEAKER_0"]["first_timestamp"])

    def test_first_timestamp_for_merged_cluster_is_earliest_across_all_fragments(self):
        # Two same-channel fragments of one real voice (Phase 3.6 merge) --
        # first_timestamp must be the earliest segment across BOTH raw
        # fragment ids, not just the merge-primary's own segments.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 1600.0, "segment_count": 580,
                            "segments": [{"start": 500.0, "end": 502.0}],
                        },
                        "SPEAKER_2": {
                            "embedding": [0.995, 0.0999], "speech_duration_seconds": 1538.0, "segment_count": 552,
                            "segments": [{"start": 45.0, "end": 47.0}],  # earlier than SPEAKER_0's own segments
                        },
                    },
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            # SPEAKER_0 is the merge primary (higher duration); its
            # first_timestamp must reflect SPEAKER_2's earlier segment too.
            merged = data["channels"]["system"]["SPEAKER_0"]
            self.assertEqual(merged["merged_from"], ["SPEAKER_2"])
            self.assertEqual(merged["first_timestamp"], "00:45")

    def test_channel_is_identifiable_from_the_response_structure(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {"SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 2}},
                },
                "system": {
                    "recording_type": "remote",
                    "clusters": {"SPEAKER_0": {"embedding": [0.0, 1.0], "speech_duration_seconds": 20.0, "segment_count": 3}},
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertIn("mic", data["channels"])
            self.assertIn("system", data["channels"])

    def test_confirmed_by_user_persists_across_requests_unlike_transient_ui_state(self):
        # A row's confirmed status must be derivable from real persisted
        # data (an existing prototype), not client-side state that
        # disappears when the panel unmounts (e.g. navigating away and
        # back to the meeting) -- see the speaker_identification plan doc.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 2},
                    },
                },
            })
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Julian")
            cfg.add_speaker_prototype(
                person["person_id"], [1.0, 0.0],
                recording_type="remote", meeting_id="mtg001", diarization_speaker_id="SPEAKER_0",
                speech_duration_seconds=10.0, segment_count=2, created_from="user_confirmed",
            )
            result = self._run(["mtg001"], tmp, cfg=cfg)
            data = _last_json(result.output)
            self.assertEqual(data["channels"]["system"]["SPEAKER_0"]["confirmed_by_user"], "Julian")

    def test_confirmed_by_user_is_null_when_never_confirmed(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 2},
                    },
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertIsNone(data["channels"]["system"]["SPEAKER_0"]["confirmed_by_user"])

    def test_confirmed_by_user_scoped_to_recording_type_not_just_diarization_id(self):
        # "SPEAKER_0" can independently exist on BOTH channels of the same
        # meeting -- a confirmation on the "mic" (in_person) cluster must
        # not bleed into the "system" (remote) cluster sharing the same
        # raw diarizer id.
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {"SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 2}},
                },
                "system": {
                    "recording_type": "remote",
                    "clusters": {"SPEAKER_0": {"embedding": [0.0, 1.0], "speech_duration_seconds": 10.0, "segment_count": 2}},
                },
            })
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Valentin")
            cfg.add_speaker_prototype(
                person["person_id"], [1.0, 0.0],
                recording_type="in_person", meeting_id="mtg001", diarization_speaker_id="SPEAKER_0",
                speech_duration_seconds=10.0, segment_count=2, created_from="user_confirmed",
            )
            result = self._run(["mtg001"], tmp, cfg=cfg)
            data = _last_json(result.output)
            self.assertEqual(data["channels"]["mic"]["SPEAKER_0"]["confirmed_by_user"], "Valentin")
            self.assertIsNone(data["channels"]["system"]["SPEAKER_0"]["confirmed_by_user"])

    def test_confirmed_by_user_resolves_through_merged_fragments(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 1600.0, "segment_count": 580,
                        },
                        "SPEAKER_2": {
                            "embedding": [0.995, 0.0999], "speech_duration_seconds": 1538.0, "segment_count": 552,
                        },
                    },
                },
            })
            cfg = Config(config_path=Path(tmp) / "config.json")
            person = cfg.create_person_profile("Julian")
            # Confirmed via the non-primary fragment id (SPEAKER_2) -- same
            # real shape as confirm-speaker's own id-resolution.
            cfg.add_speaker_prototype(
                person["person_id"], [0.995, 0.0999],
                recording_type="remote", meeting_id="mtg001", diarization_speaker_id="SPEAKER_2",
                speech_duration_seconds=1538.0, segment_count=552, created_from="user_confirmed",
            )
            result = self._run(["mtg001"], tmp, cfg=cfg)
            data = _last_json(result.output)
            # SPEAKER_0 is the merge primary (higher duration) -- the
            # confirmation must still be found via merged_from.
            merged = data["channels"]["system"]["SPEAKER_0"]
            self.assertEqual(merged["merged_from"], ["SPEAKER_2"])
            self.assertEqual(merged["confirmed_by_user"], "Julian")

    def test_sample_text_quotes_the_transcript_at_the_longest_segment(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 1,
                            "segments": [{"start": 5.0, "end": 15.0}],
                        },
                    },
                },
            })
            transcripts_dir = Path(tmp) / "transcripts"
            transcripts_dir.mkdir(parents=True, exist_ok=True)
            (transcripts_dir / "mtg001_transcript.txt").write_text(
                "Session: mtg001\n\n" + "=" * 60 + "\n\n[00:05] [Speaker 2] this is what they said",
                encoding="utf-8",
            )
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertEqual(
                data["channels"]["system"]["SPEAKER_0"]["sample_text"], "this is what they said",
            )

    def test_sample_text_is_null_without_a_matching_transcript(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 2},
                    },
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertIsNone(data["channels"]["mic"]["SPEAKER_0"]["sample_text"])

    def test_is_likely_artifact_true_for_short_scattered_turns(self):
        # Real-library shape: many short turns, low avg -- the exact
        # echo-artifact pattern this session's ground-truth investigation
        # found (avg well under SUGGESTION_MIN_AVG_TURN_SECONDS).
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 25.0, "segment_count": 56},
                    },
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["channels"]["system"]["SPEAKER_0"]["is_likely_artifact"])

    def test_is_likely_artifact_false_for_sustained_speech(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 300.0, "segment_count": 100},
                    },
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertFalse(data["channels"]["system"]["SPEAKER_0"]["is_likely_artifact"])

    def test_recording_available_true_when_source_file_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {"SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 2}},
                },
            })
            recordings_dir = Path(tmp) / "recordings"
            recordings_dir.mkdir(parents=True, exist_ok=True)
            (recordings_dir / "mtg001.webm").write_bytes(b"stub")
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["recording_available"])

    def test_recording_available_false_when_source_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {"SPEAKER_0": {"embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 2}},
                },
            })
            result = self._run(["mtg001"], tmp)
            data = _last_json(result.output)
            self.assertFalse(data["recording_available"])


class GetSpeakerSampleAudioCliTests(unittest.TestCase):
    def _run(self, args, tmp):
        cfg = Config(config_path=Path(tmp) / "config.json")
        with mock.patch("src.config.get_config", return_value=cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            result = CliRunner().invoke(simple_recorder.get_speaker_sample_audio, args)
        return result

    def _seed_sidecar_and_recording(self, tmp, stem="mtg001"):
        output_dir = Path(tmp) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        write_speakers_sidecar(output_dir, stem, {
            "system": {
                "recording_type": "remote",
                "clusters": {
                    "SPEAKER_0": {
                        "embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 1,
                        "segments": [{"start": 5.0, "end": 15.0}],
                    },
                },
            },
        })
        recordings_dir = Path(tmp) / "recordings"
        recordings_dir.mkdir(parents=True, exist_ok=True)
        (recordings_dir / f"{stem}.wav").write_bytes(b"stub")

    def test_success_returns_base64_audio_bytes_not_a_path(self):
        # The renderer's CSP (media-src 'self' blob:) has no file:
        # allowance -- a raw filesystem path could never actually play in
        # the packaged app, so the clip's bytes must come back inline.
        import base64
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar_and_recording(tmp)
            with mock.patch(
                "src.speaker_suggestions.extract_speaker_sample_audio",
                side_effect=lambda audio_path, channel, segments, output_path, segment_index=None: (
                    output_path.write_bytes(b"wav-stub-bytes") or True
                ),
            ):
                result = self._run(["mtg001", "system", "SPEAKER_0"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertNotIn("audio_path", data)
            self.assertEqual(base64.b64decode(data["audio_base64"]), b"wav-stub-bytes")

    def test_temp_extraction_file_is_cleaned_up_after_reading(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar_and_recording(tmp)
            captured_path = {}

            def fake_extract(audio_path, channel, segments, output_path, segment_index=None):
                captured_path["path"] = output_path
                output_path.write_bytes(b"stub")
                return True

            with mock.patch("src.speaker_suggestions.extract_speaker_sample_audio", side_effect=fake_extract):
                self._run(["mtg001", "system", "SPEAKER_0"], tmp)
            self.assertFalse(captured_path["path"].exists())

    def test_no_source_recording_fails_gracefully(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 10.0, "segment_count": 1,
                            "segments": [{"start": 5.0, "end": 15.0}],
                        },
                    },
                },
            })
            # No recordings dir file seeded -- source audio "deleted".
            result = self._run(["mtg001", "system", "SPEAKER_0"], tmp)
            data = _last_json(result.output)
            self.assertFalse(data["success"])
            self.assertIn("no source audio", data["error"])

    def test_unknown_cluster_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar_and_recording(tmp)
            result = self._run(["mtg001", "system", "SPEAKER_99"], tmp)
            data = _last_json(result.output)
            self.assertFalse(data["success"])

    def test_missing_sidecar_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "output").mkdir(parents=True, exist_ok=True)
            result = self._run(["mtg_nonexistent", "system", "SPEAKER_0"], tmp)
            data = _last_json(result.output)
            self.assertFalse(data["success"])

    def test_extraction_failure_reported_gracefully(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._seed_sidecar_and_recording(tmp)
            with mock.patch("src.speaker_suggestions.extract_speaker_sample_audio", return_value=False):
                result = self._run(["mtg001", "system", "SPEAKER_0"], tmp)
            data = _last_json(result.output)
            self.assertFalse(data["success"])
            self.assertIn("could not extract", data["error"])

    def test_either_merged_fragment_id_resolves_to_same_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            write_speakers_sidecar(output_dir, "mtg001", {
                "system": {
                    "recording_type": "remote",
                    "clusters": {
                        "SPEAKER_0": {
                            "embedding": [1.0, 0.0], "speech_duration_seconds": 1600.0, "segment_count": 580,
                            "segments": [{"start": 5.0, "end": 15.0}],
                        },
                        "SPEAKER_2": {
                            "embedding": [0.995, 0.0999], "speech_duration_seconds": 1538.0, "segment_count": 552,
                            "segments": [{"start": 100.0, "end": 105.0}],
                        },
                    },
                },
            })
            recordings_dir = Path(tmp) / "recordings"
            recordings_dir.mkdir(parents=True, exist_ok=True)
            (recordings_dir / "mtg001.wav").write_bytes(b"stub")
            captured = {}

            def fake_extract(audio_path, channel, segments, output_path, segment_index=None):
                captured["output_path"] = output_path
                captured["segments"] = segments
                output_path.write_bytes(b"wav-stub")
                return True

            with mock.patch("src.speaker_suggestions.extract_speaker_sample_audio", side_effect=fake_extract):
                # Requesting the lower-duration fragment resolves to the
                # merge primary (SPEAKER_0), same as confirm-speaker --
                # verify via the resolved temp-file name AND that both
                # fragments' segments were pooled together.
                result = self._run(["mtg001", "system", "SPEAKER_2"], tmp)
            data = _last_json(result.output)
            self.assertTrue(data["success"])
            self.assertIn("SPEAKER_0", str(captured["output_path"]))
            self.assertEqual(len(captured["segments"]), 2)


if __name__ == "__main__":
    unittest.main()
