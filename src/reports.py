"""Pure helpers for the per-meeting `reports[]` model (no I/O).

A meeting's `_summary.json` gains an additive `reports` list of generated
template reports and an `active_report` pointer. The existing top-level summary
fields remain the canonical "Standard" report; `active_report` absent/None means
"show the Standard note".
"""
import uuid
from datetime import datetime


def new_report_id() -> str:
    return f"rep_{uuid.uuid4().hex[:12]}"


def make_report(template_id: str, template_name: str, model: str, content: str) -> dict:
    return {
        "id": new_report_id(),
        "template_id": template_id,
        "template_name": template_name,
        "model": model,
        "content": content,
        "created_at": datetime.now().isoformat(),
    }


def append_report(meeting: dict, report: dict) -> dict:
    meeting.setdefault("reports", []).append(report)
    meeting["active_report"] = report["id"]
    return report


def _item_text(item, *keys) -> str:
    if isinstance(item, dict):
        for k in keys:
            v = item.get(k)
            if v:
                return str(v)
        return ""
    return str(item)


def structured_to_markdown(summary, discussion_areas, key_points, action_items) -> str:
    """Reconstruct a structured note's markdown (for a read-only backup)."""
    parts = []
    if (summary or "").strip():
        parts.append(f"## Summary\n{summary.strip()}")
    topics = []
    for a in discussion_areas or []:
        title = _item_text(a, "title")
        analysis = _item_text(a, "analysis")
        if title or analysis:
            topics.append(f"### {title}\n{analysis}".strip())
    if topics:
        parts.append("## Key Topics\n" + "\n\n".join(topics))
    kps = [f"- {_item_text(k, 'decision', 'point')}" for k in (key_points or []) if _item_text(k, 'decision', 'point')]
    if kps:
        parts.append("## Key Points\n" + "\n".join(kps))
    ais = [f"- {_item_text(a, 'description')}" for a in (action_items or []) if _item_text(a, 'description')]
    if ais:
        parts.append("## Action Items\n" + "\n".join(ais))
    return "\n\n".join(parts)


def set_active(meeting: dict, report_id) -> bool:
    """Set active_report. report_id None or 'standard' clears it (show Standard)."""
    if report_id in (None, "standard"):
        meeting["active_report"] = None
        return True
    if any(r.get("id") == report_id for r in meeting.get("reports", [])):
        meeting["active_report"] = report_id
        return True
    return False


def remove_report(meeting: dict, report_id: str) -> bool:
    reports = meeting.get("reports", [])
    kept = [r for r in reports if r.get("id") != report_id]
    if len(kept) == len(reports):
        return False
    meeting["reports"] = kept
    if meeting.get("active_report") == report_id:
        meeting["active_report"] = None
    return True
