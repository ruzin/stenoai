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
