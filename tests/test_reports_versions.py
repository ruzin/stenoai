# tests/test_reports_versions.py
import unittest
from src import reports as R


class StructuredToMarkdownTests(unittest.TestCase):
    def test_renders_all_sections_present(self):
        md = R.structured_to_markdown(
            "An overview.",
            [{"title": "Topic A", "analysis": "did A"}],
            ["point one"],
            ["do the thing"],
        )
        self.assertIn("## Summary", md)
        self.assertIn("An overview.", md)
        self.assertIn("### Topic A", md)
        self.assertIn("did A", md)
        self.assertIn("- point one", md)
        self.assertIn("- do the thing", md)

    def test_skips_empty_sections(self):
        md = R.structured_to_markdown("Only overview.", [], [], [])
        self.assertIn("Only overview.", md)
        self.assertNotIn("## Key Points", md)
        self.assertNotIn("## Action Items", md)

    def test_tolerates_string_or_dict_items(self):
        md = R.structured_to_markdown(
            "o", [], [{"decision": "kp dict"}, "kp str"], [{"description": "ai dict"}, "ai str"]
        )
        self.assertIn("- kp dict", md)
        self.assertIn("- kp str", md)
        self.assertIn("- ai dict", md)
        self.assertIn("- ai str", md)


class SetActiveRemoveTests(unittest.TestCase):
    def _meeting(self):
        return {"reports": [
            {"id": "rep_1", "template_id": "t", "template_name": "T", "model": "m",
             "content": "c", "created_at": "2026-01-01T00:00:00"}],
            "active_report": "rep_1"}

    def test_set_active_to_standard_clears_pointer(self):
        m = self._meeting()
        self.assertTrue(R.set_active(m, "standard"))
        self.assertIsNone(m.get("active_report"))

    def test_set_active_to_known_report(self):
        m = self._meeting()
        m["active_report"] = None
        self.assertTrue(R.set_active(m, "rep_1"))
        self.assertEqual(m["active_report"], "rep_1")

    def test_set_active_unknown_returns_false(self):
        m = self._meeting()
        self.assertFalse(R.set_active(m, "nope"))

    def test_remove_drops_entry_and_clears_active(self):
        m = self._meeting()
        self.assertTrue(R.remove_report(m, "rep_1"))
        self.assertEqual(m["reports"], [])
        self.assertIsNone(m.get("active_report"))

    def test_remove_unknown_returns_false(self):
        m = self._meeting()
        self.assertFalse(R.remove_report(m, "nope"))


if __name__ == "__main__":
    unittest.main()
