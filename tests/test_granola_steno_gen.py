import importlib.util
import io
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

_SCRIPT = (
    Path(__file__).resolve().parent.parent
    / "skills" / "granola-to-steno" / "scripts" / "steno_gen.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("granola_steno_gen", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


steno_gen = _load_module()


class LanguageFlagTests(unittest.TestCase):
    def test_language_flows_into_frontmatter_and_header(self):
        meeting = {
            "title": "Weekly sync",
            "date_raw": "Jun 26, 2026 2:30 PM GMT+2",
            "participants": ["Alice", "Bob"],
            "summary": "Some notes",
            "transcript": "Me: hello\nThem: hi",
        }
        _stem, summary_md, transcript_txt = steno_gen.build(meeting, language="de")

        self.assertIn('language: "de"', summary_md)
        # The import language is a deliberate choice, so it's recorded as a real
        # pin (configured_language) with no engine detection, giving the note
        # provenance so Steno's recovery/chat paths keep it instead of
        # re-detecting (#283).
        self.assertIn('configured_language: "de"', summary_md)
        self.assertIn('detected_language: null', summary_md)
        self.assertIn("Language setting: de", transcript_txt)
        self.assertIn("Detected language: de", transcript_txt)
        self.assertIn("Summary output language: de", transcript_txt)

    def test_language_defaults_to_en(self):
        meeting = {"title": "Standup", "date_raw": "Jun 26, 2026 2:30 PM GMT+2"}
        _stem, summary_md, transcript_txt = steno_gen.build(meeting)

        self.assertIn('language: "en"', summary_md)
        self.assertIn("Language setting: en", transcript_txt)


class CliInvocationTests(unittest.TestCase):
    def test_language_flag_via_actual_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            meeting_dir = tmp_path / "in" / "meeting-1"
            meeting_dir.mkdir(parents=True)
            (meeting_dir / "meta.txt").write_text(
                "title\tWeekly Sync\ndate\tJun 26, 2026 2:30 PM GMT+2\nparticipants\tAlice; Bob\n",
                encoding="utf-8",
            )
            (meeting_dir / "summary.txt").write_text("Some notes", encoding="utf-8")
            (meeting_dir / "transcript.txt").write_text("Me: hi\n", encoding="utf-8")

            out_dir = tmp_path / "out"
            result = subprocess.run(
                [
                    sys.executable, str(_SCRIPT),
                    str(tmp_path / "in"), str(out_dir),
                    "--language", "de",
                ],
                capture_output=True, text=True, check=True,
            )
            self.assertEqual(result.returncode, 0)

            generated = list((out_dir / "output").glob("*_summary.md"))
            self.assertEqual(len(generated), 1)
            content = generated[0].read_text(encoding="utf-8")
            self.assertIn('language: "de"', content)


class DurationTests(unittest.TestCase):
    def test_unknown_duration_renders_as_null_not_zero(self):
        meeting = {"title": "Standup", "date_raw": "Jun 26, 2026 2:30 PM GMT+2"}
        _stem, summary_md, _transcript_txt = steno_gen.build(meeting)

        self.assertIn("duration_seconds: null", summary_md)
        self.assertNotIn("duration_seconds: 0", summary_md)


class DeterministicDateFallbackTests(unittest.TestCase):
    def test_unparseable_date_is_deterministic_across_runs(self):
        meeting = {"title": "Réunion", "date_raw": "26 juin 2026 14:30"}

        with redirect_stderr(io.StringIO()):
            stem_a, _md_a, _tx_a = steno_gen.build(meeting)
            stem_b, _md_b, _tx_b = steno_gen.build(meeting)

        self.assertEqual(stem_a, stem_b)

    def test_different_unparseable_inputs_produce_different_stems(self):
        # Guards against a hardcoded/constant fallback: the deterministic
        # timestamp must actually vary with the input, not just be stable.
        meeting_a = {"title": "Réunion A", "date_raw": "26 juin 2026 14:30"}
        meeting_b = {"title": "Réunion B", "date_raw": "27 juillet 2026 09:00"}

        with redirect_stderr(io.StringIO()):
            stem_a, _md_a, _tx_a = steno_gen.build(meeting_a)
            stem_b, _md_b, _tx_b = steno_gen.build(meeting_b)

        self.assertNotEqual(stem_a, stem_b)

    def test_unparseable_date_warns_on_stderr(self):
        meeting = {"title": "Réunion", "date_raw": "26 juin 2026 14:30"}

        err = io.StringIO()
        with redirect_stderr(err):
            steno_gen.build(meeting)

        message = err.getvalue()
        self.assertIn("could not parse date", message)
        self.assertIn("26 juin 2026 14:30", message)

    def test_parseable_date_does_not_warn(self):
        meeting = {"title": "Standup", "date_raw": "Jun 26, 2026 2:30 PM GMT+2"}

        err = io.StringIO()
        with redirect_stderr(err):
            steno_gen.build(meeting)

        self.assertEqual(err.getvalue(), "")


class FrontmatterEscapingTests(unittest.TestCase):
    def test_title_with_embedded_newline_does_not_break_frontmatter(self):
        meeting = {
            "title": "Line one\nLine two",
            "date_raw": "Jun 26, 2026 2:30 PM GMT+2",
        }
        _stem, summary_md, _transcript_txt = steno_gen.build(meeting)

        fm_block = summary_md.split("---")[1]
        fm_lines = [line for line in fm_block.strip().splitlines() if line.strip()]
        # One line per frontmatter key -- an unescaped newline in a scalar
        # would inject a bogus extra "key" line here and corrupt the block.
        self.assertEqual(len(fm_lines), 9)
        self.assertIn('title: "Line one Line two"', summary_md)


class StemCollisionTests(unittest.TestCase):
    def test_no_existing_file_returns_base_stem(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stem = steno_gen.resolve_stem(out_dir, "20260626-1430_weekly-sync", "id-a", set())
            self.assertEqual(stem, "20260626-1430_weekly-sync")

    def test_same_owner_on_disk_is_not_a_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stem = "20260626-1430_weekly-sync"
            (out_dir / f"{stem}_summary.md").write_text(
                '---\ntitle: "Weekly Sync"\ngranola_id: "id-a"\n---\n', encoding="utf-8"
            )
            resolved = steno_gen.resolve_stem(out_dir, stem, "id-a", set())
            self.assertEqual(resolved, stem)

    def test_different_owner_on_disk_gets_suffixed(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stem = "20260626-1430_weekly-sync"
            (out_dir / f"{stem}_summary.md").write_text(
                '---\ntitle: "Weekly Sync"\ngranola_id: "id-a"\n---\n', encoding="utf-8"
            )
            resolved = steno_gen.resolve_stem(out_dir, stem, "id-b", set())
            self.assertNotEqual(resolved, stem)
            self.assertTrue(resolved.startswith(stem + "-"))

    def test_unmarked_existing_file_is_treated_as_foreign(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stem = "20260626-1430_weekly-sync"
            (out_dir / f"{stem}_summary.md").write_text(
                '---\ntitle: "Weekly Sync"\n---\n', encoding="utf-8"
            )
            resolved = steno_gen.resolve_stem(out_dir, stem, "id-b", set())
            self.assertNotEqual(resolved, stem)

    def test_cross_run_collision_does_not_clobber_a_dropped_out_meeting(self):
        # Reproduces the reported scenario: run A writes meetings X and Y
        # under a colliding stem (Y suffixed); a later run B only carries Y
        # (X has left the sync window) and must not silently take over X's
        # file just because run B's in-memory `seen` set starts empty.
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stem = "20260626-1430_weekly-sync"

            seen_run_a = set()
            x_stem = steno_gen.resolve_stem(out_dir, stem, "id-x", seen_run_a)
            (out_dir / f"{x_stem}_summary.md").write_text(
                '---\ntitle: "Weekly Sync"\ngranola_id: "id-x"\n---\n', encoding="utf-8"
            )
            seen_run_a.add(x_stem)

            y_stem = steno_gen.resolve_stem(out_dir, stem, "id-y", seen_run_a)
            self.assertNotEqual(y_stem, x_stem)
            (out_dir / f"{y_stem}_summary.md").write_text(
                '---\ntitle: "Weekly Sync"\ngranola_id: "id-y"\n---\n', encoding="utf-8"
            )

            # Run B: fresh process, fresh `seen` set, only Y in the window.
            y_stem_run_b = steno_gen.resolve_stem(out_dir, stem, "id-y", set())
            self.assertEqual(y_stem_run_b, y_stem)

            x_content = (out_dir / f"{x_stem}_summary.md").read_text(encoding="utf-8")
            self.assertIn("id-x", x_content)

    def test_suffixed_candidates_sharing_an_id_prefix_still_get_distinct_stems(self):
        # Reproduces the exact report: two different ids share their first 6
        # characters, so the naive single-candidate suffix ("stem-abcdef" for
        # both) would collide with itself and the second write would clobber
        # the first. resolve_stem must widen the suffix until it finds a
        # stem that is actually free.
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stem = "20260626-1430_weekly-sync"
            seen = {stem, f"{stem}-abcdef"}

            first = steno_gen.resolve_stem(out_dir, stem, "abcdef1", set(seen))
            second = steno_gen.resolve_stem(out_dir, stem, "abcdef2", set(seen))

            self.assertNotEqual(first, second)
            self.assertNotEqual(first, f"{stem}-abcdef")
            self.assertNotEqual(second, f"{stem}-abcdef")

    def test_suffixed_candidates_stay_distinct_when_written_in_sequence(self):
        # Same scenario as above but driven like main() actually drives it:
        # each resolved stem is written to disk and added to `seen` before
        # the next meeting is resolved, within a single run.
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stem = "20260626-1430_weekly-sync"
            (out_dir / f"{stem}_summary.md").write_text(
                '---\ntitle: "Weekly Sync"\ngranola_id: "id-other"\n---\n', encoding="utf-8"
            )
            (out_dir / f"{stem}-abcdef_summary.md").write_text(
                '---\ntitle: "Weekly Sync"\ngranola_id: "abcdef0"\n---\n', encoding="utf-8"
            )
            seen = {stem, f"{stem}-abcdef"}

            first = steno_gen.resolve_stem(out_dir, stem, "abcdef1", seen)
            seen.add(first)
            second = steno_gen.resolve_stem(out_dir, stem, "abcdef2", seen)

            self.assertNotEqual(first, second)

    def test_pathological_full_id_collision_falls_back_to_a_counter(self):
        # Even if a full id is somehow already taken (adversarial input, or
        # two identical ids from different sources), resolve_stem must still
        # terminate deterministically rather than looping or colliding.
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            stem = "20260626-1430_weekly-sync"
            seen = {stem, f"{stem}-dupid", f"{stem}-dupid-2"}

            resolved = steno_gen.resolve_stem(out_dir, stem, "dupid", seen)

            self.assertEqual(resolved, f"{stem}-dupid-3")


if __name__ == "__main__":
    unittest.main()
