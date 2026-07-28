import json
import tempfile
import unittest
from pathlib import Path

from simple_recorder import _write_original_snapshot


class WriteOriginalSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.summary_path = self.dir / "Weekly_Sync_summary.md"
        self.summary_path.write_text("---\ntitle: \"x\"\n---\n\n## Summary\n\nhi\n", encoding="utf-8")
        self.parsed = {
            "summary": "We agreed the budget.",
            "key_points": ["Budget approved"],
            "action_items": ["Anna sends the draft"],
            "discussion_areas": [{"title": "Budget", "analysis": "Reviewed."}],
            "participants": [],
        }

    def snapshot(self):
        return json.loads((self.dir / "Weekly_Sync_original.json").read_text(encoding="utf-8"))

    def test_writes_the_model_output_with_generation_provenance(self):
        _write_original_snapshot(self.summary_path, self.parsed)
        data = self.snapshot()
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["capture"], "generation")
        self.assertEqual(data["original"]["summary"], "We agreed the budget.")
        self.assertEqual(data["edited_fields"], [])

    def test_regeneration_overwrites_the_previous_snapshot(self):
        _write_original_snapshot(self.summary_path, self.parsed)
        self.parsed["summary"] = "A regenerated summary."
        _write_original_snapshot(self.summary_path, self.parsed)
        self.assertEqual(self.snapshot()["original"]["summary"], "A regenerated summary.")

    def test_a_write_failure_never_raises_into_the_pipeline(self):
        # A read-only directory must not fail the whole run: the note matters,
        # the snapshot is best-effort.
        unwritable = Path("/nonexistent-dir-for-test") / "x_summary.md"
        _write_original_snapshot(unwritable, self.parsed)


if __name__ == "__main__":
    unittest.main()
