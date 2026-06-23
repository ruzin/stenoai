# src/report_store.py
"""Per-meeting report storage independent of the note's on-disk format.

Real meetings are saved as `<stem>_summary.md` (markdown + YAML frontmatter);
older/reprocessed ones may be `<stem>_summary.json`. Generated template reports
and the active-report pointer live in a SIDECAR `<stem>_reports.json`, so the
report feature works on both formats without touching the canonical note file.
"""
import json
from pathlib import Path


def sidecar_path(meeting_path) -> Path:
    p = Path(meeting_path)
    name = p.name
    for suf in ("_summary.md", "_summary.json"):
        if name.endswith(suf):
            return p.with_name(name[: -len(suf)] + "_reports.json")
    # Fallback: strip extension only.
    return p.with_name(p.stem + "_reports.json")


def load_sidecar(meeting_path) -> dict:
    sp = sidecar_path(meeting_path)
    if sp.exists():
        try:
            data = json.loads(sp.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("reports", [])
                data.setdefault("active_report", None)
                return data
        except Exception:
            pass
    return {"reports": [], "active_report": None}


def save_sidecar(meeting_path, sidecar: dict) -> None:
    from src.config import _atomic_write_json
    _atomic_write_json(sidecar_path(meeting_path), sidecar)


def _split_frontmatter(text: str):
    """Return (frontmatter_dict, body). Frontmatter is the first --- ... --- block."""
    fm = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            block = text[3:end].strip("\n")
            body = text[end + 4:].lstrip("\n")
            for line in block.splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    fm[k.strip()] = v.strip().strip('"')
    return fm, body


def _split_md_sections(body: str):
    """Return (summary_markdown, transcript, notes) from a meeting .md body."""
    notes = None
    if "## User Notes" in body:
        body, _, notes_part = body.partition("## User Notes")
        notes = notes_part.strip() or None
    transcript = ""
    if "## Transcript" in body:
        summary_part, _, transcript_part = body.partition("## Transcript")
        transcript = transcript_part.strip()
    else:
        summary_part = body
    return summary_part.strip(), transcript, notes


def read_meeting(meeting_path) -> dict:
    """Format-agnostic view used by report generation."""
    p = Path(meeting_path)
    text = p.read_text(encoding="utf-8")
    if p.suffix == ".json":
        d = json.loads(text)
        from src import reports as _reports
        summary_md = _reports.structured_to_markdown(
            d.get("summary", ""), d.get("discussion_areas", []),
            d.get("key_points", []), d.get("action_items", []),
        )
        si = d.get("session_info", {}) or {}
        ds = si.get("duration_seconds")
        return {
            "transcript": d.get("transcript", "") or d.get("diarised_text", "") or "",
            "notes": d.get("user_notes"),
            "language": si.get("output_language") or si.get("language"),
            "duration_minutes": si.get("duration_minutes") or (int(ds / 60) if ds else None),
            "summary_markdown": summary_md,
        }
    fm, body = _split_frontmatter(text)
    summary_md, transcript, notes = _split_md_sections(body)
    ds = fm.get("duration_seconds")
    return {
        "transcript": transcript,
        "notes": notes,
        "language": fm.get("language"),
        "duration_minutes": (int(ds) // 60) if (ds and str(ds).isdigit()) else None,
        "summary_markdown": summary_md,
    }
