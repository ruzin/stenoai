# tests/test_templates.py
import unittest
from src import templates as T


class BuiltinRegistryTests(unittest.TestCase):
    def test_standard_is_the_only_builtin_and_is_locked_structured(self):
        self.assertEqual(list(T.BUILTIN_TEMPLATES), ["standard"])
        std = T.BUILTIN_TEMPLATES["standard"]
        self.assertEqual(std["id"], T.STANDARD_TEMPLATE_ID)
        self.assertTrue(std["locked"])
        self.assertEqual(std["format"], "structured")

    def test_sample_is_an_editable_markdown_custom_template(self):
        s = T.SAMPLE_TEMPLATE
        self.assertEqual(s["id"], "shareable-summary")
        self.assertEqual(s["format"], "markdown")
        self.assertTrue(s["prompt"].strip())
        self.assertNotIn("locked", s)  # custom: not locked

    def test_new_template_id_slugifies_and_dedupes(self):
        self.assertEqual(T.new_template_id("Sprint Planning", set()), "sprint-planning")
        self.assertEqual(
            T.new_template_id("Sprint Planning", {"sprint-planning"}),
            "sprint-planning-2",
        )

    def test_validate_rejects_blank_name_and_bad_language(self):
        ok, _ = T.validate_template(
            {"name": "", "prompt": "x", "language": "auto"}, {"auto", "de"}
        )
        self.assertFalse(ok)
        ok, _ = T.validate_template(
            {"name": "X", "prompt": "x", "language": "xx"}, {"auto", "de"}
        )
        self.assertFalse(ok)
        ok, _ = T.validate_template(
            {"name": "X", "prompt": "x", "language": "de"}, {"auto", "de"}
        )
        self.assertTrue(ok)

    def test_validate_is_defensive_at_the_trust_boundary(self):
        langs = {"auto", "de"}
        # Non-dict payloads must return (False, msg), never raise.
        for bad in ([], None, 42):
            ok, msg = T.validate_template(bad, langs)
            self.assertFalse(ok)
            self.assertTrue(msg)
        # name: numeric / blank / over-long
        for bad_name in (123, "", "   ", "x" * (T.MAX_NAME_LEN + 1)):
            ok, _ = T.validate_template(
                {"name": bad_name, "prompt": "p", "language": "auto"}, langs
            )
            self.assertFalse(ok)
        # prompt: missing / blank / over-long / numeric
        for bad_prompt in (None, "", "   ", 123, "x" * (T.MAX_PROMPT_LEN + 1)):
            ok, _ = T.validate_template(
                {"name": "X", "prompt": bad_prompt, "language": "auto"}, langs
            )
            self.assertFalse(ok)
        # language: array / unknown
        for bad_lang in (["de"], "xx"):
            ok, _ = T.validate_template(
                {"name": "X", "prompt": "p", "language": bad_lang}, langs
            )
            self.assertFalse(ok)
        # format: present but invalid
        ok, _ = T.validate_template(
            {"name": "X", "prompt": "p", "language": "auto", "format": "weird"}, langs
        )
        self.assertFalse(ok)
        # icon: present but not a str
        ok, _ = T.validate_template(
            {"name": "X", "prompt": "p", "language": "auto", "icon": 5}, langs
        )
        self.assertFalse(ok)
        # A fully valid dict still passes.
        ok, msg = T.validate_template(
            {"name": "X", "prompt": "p", "language": "de",
             "format": "markdown", "icon": "doc"},
            langs,
        )
        self.assertTrue(ok, msg)

    def test_sample_icon_is_a_valid_editor_key(self):
        editor_keys = {"doc", "people", "calendar", "lightbulb", "phone", "megaphone"}
        self.assertEqual(T.SAMPLE_TEMPLATE["icon"], "megaphone")
        self.assertIn(T.SAMPLE_TEMPLATE["icon"], editor_keys)

    def test_merge_applies_overrides_and_tags_builtin(self):
        merged = T.merge_templates(
            overrides={"standard": {"name": "Default note"}},
            custom=[{"id": "leitung", "name": "Leitung", "prompt": "p", "language": "de",
                     "format": "markdown"}],
        )
        std = next(m for m in merged if m["id"] == "standard")
        self.assertEqual(std["name"], "Default note")   # override applied
        self.assertTrue(std["builtin"] and std["locked"])
        custom = next(m for m in merged if m["id"] == "leitung")
        self.assertFalse(custom["builtin"])
        # built-ins come first
        self.assertEqual(merged[0]["id"], "standard")


if __name__ == "__main__":
    unittest.main()
