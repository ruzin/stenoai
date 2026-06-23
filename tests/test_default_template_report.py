# tests/test_default_template_report.py
import json, tempfile, unittest
from pathlib import Path
from unittest import mock
from src.config import Config
import simple_recorder
from src import report_store


class _FakeSummarizer:
    model_name = "llama3.2:3b"
    def __init__(self, chunks):
        self._chunks = chunks
    def summarize_transcript_streaming(self, transcript, duration_minutes=0, language="en",
                                       notes=None, progress_callback=None, template_prompt=None):
        # assert the template prompt is threaded through
        assert template_prompt, "expected a template prompt"
        for c in self._chunks:
            yield c


def _cfg(tmp, default_id):
    c = Config(config_path=Path(tmp) / "config.json")
    # seed a custom template + set it default
    ok, _, saved = c.save_template({"name": "Leitung", "prompt": "Kurz für den Chef.",
                                    "language": "auto"})
    assert ok
    if default_id == "custom":
        c.set_default_template(saved["id"])
        return c, saved["id"]
    return c, "standard"


class DefaultTemplateReportTests(unittest.TestCase):
    def test_noop_when_default_is_standard(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, _ = _cfg(tmp, "standard")
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["ignored"]))
            self.assertIsNone(out)
            self.assertFalse((Path(tmp) / "m_reports.json").exists())

    def test_generates_and_writes_sidecar_for_custom_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, tid = _cfg(tmp, "custom")
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["## Report\n- ok"]))
            self.assertIsNotNone(out)
            sc = report_store.load_sidecar(mp)
            self.assertEqual(len(sc["reports"]), 1)
            self.assertEqual(sc["reports"][0]["template_id"], tid)
            self.assertIn("## Report", sc["reports"][0]["content"])
            self.assertEqual(sc["active_report"], sc["reports"][0]["id"])

    def test_empty_generation_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, _ = _cfg(tmp, "custom")
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["  ", "\n"]))
            self.assertIsNone(out)
            self.assertFalse((Path(tmp) / "m_reports.json").exists())

    def test_unknown_default_is_safe_noop(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, _ = _cfg(tmp, "standard")
            c._config["default_template_id"] = "ghost"  # points at nothing
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["x"]))
            self.assertIsNone(out)


if __name__ == "__main__":
    unittest.main()
