# src/templates.py
"""Built-in report templates + pure template helpers.

A template shapes how a meeting report is generated/exported. The shipped
lineup is intentionally minimal: STANDARD is the only built-in (locked, drives
today's structured note). One editable SAMPLE custom template is pre-seeded by
Config on first run; everything else is user-created. Built-in definitions live
here (source of truth, like whisper_models.py); custom templates, built-in
overrides, the seed flag, and the default id live in config.json.

This module is pure — no I/O — so it is unit-testable without a running app.
"""

import re

STANDARD_TEMPLATE_ID = "standard"

MAX_NAME_LEN = 200
MAX_PROMPT_LEN = 8000
MAX_ICON_LEN = 64
VALID_FORMATS = {"structured", "markdown"}

# Only STANDARD is a built-in. Locked + structured: its "prompt" is empty
# because it routes through the existing JSON-schema summary path, not a
# free-form prompt. PR B reads `format` to pick the render/generation path.
BUILTIN_TEMPLATES = {
    "standard": {
        "id": "standard",
        "name": "Standard",
        "icon": "doc",
        "prompt": "",
        "language": "auto",
        "format": "structured",
        "locked": True,
    },
}

# Pre-seeded once into the user's custom templates (editable + deletable).
SAMPLE_TEMPLATE = {
    "id": "shareable-summary",
    "name": "Shareable summary",
    "icon": "megaphone",
    "prompt": (
        "Write a clear, plain-language summary I can forward to a colleague or "
        "manager: the key points, decisions, and any next steps. Write in the "
        "language of the meeting."
    ),
    "language": "auto",
    "format": "markdown",
}


def new_template_id(name: str, existing_ids: set) -> str:
    """A stable slug id from a display name, de-duped against existing ids."""
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    base = base or "template"
    if base not in existing_ids:
        return base
    n = 2
    while f"{base}-{n}" in existing_ids:
        n += 1
    return f"{base}-{n}"


def validate_template(t: dict, valid_languages: set) -> tuple:
    """Return (ok, error_message) for a template dict.

    Defensive at the Python trust boundary: `t` arrives from the renderer as
    decoded JSON and may be malformed. This never raises — it always returns
    (False, "<message>") on bad input.
    """
    if not isinstance(t, dict):
        return False, "Invalid template payload"

    name = t.get("name")
    if not isinstance(name, str):
        return False, "Template name is required"
    name = name.strip()
    if not name:
        return False, "Template name is required"
    if len(name) > MAX_NAME_LEN:
        return False, f"Template name is too long (max {MAX_NAME_LEN} characters)"

    prompt = t.get("prompt")
    if not isinstance(prompt, str):
        return False, "Template prompt is required"
    if not prompt.strip():
        return False, "Template prompt is required"
    if len(prompt) > MAX_PROMPT_LEN:
        return False, f"Template prompt is too long (max {MAX_PROMPT_LEN} characters)"

    lang = t.get("language", "auto")
    if not isinstance(lang, str) or lang not in valid_languages:
        return False, f"Unsupported language: {lang}"

    fmt = t.get("format")
    if fmt is not None and (not isinstance(fmt, str) or fmt not in VALID_FORMATS):
        return False, f"Unsupported format: {fmt}"

    icon = t.get("icon")
    if icon is not None:
        if not isinstance(icon, str):
            return False, "Invalid template icon"
        if len(icon) > MAX_ICON_LEN:
            return False, "Template icon is too long"

    return True, ""


def merge_templates(overrides: dict, custom: list) -> list:
    """Built-ins (with overrides applied) first, then custom templates.

    Each entry is tagged `builtin` (and `locked` for STANDARD) so the UI knows
    which controls (Reset vs Edit/Delete) to show.
    """
    result = []
    for tid, base in BUILTIN_TEMPLATES.items():
        merged = {**base, **(overrides.get(tid) or {})}
        merged["builtin"] = True
        merged["locked"] = bool(base.get("locked"))
        result.append(merged)
    for c in custom:
        result.append({**c, "builtin": False, "locked": False})
    return result
