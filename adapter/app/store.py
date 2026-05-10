"""JSON-file meeting store. Swap for DynamoDB / RDS in a real deploy."""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Literal, TypedDict

_DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
_DATA_DIR.mkdir(parents=True, exist_ok=True)
_STORE_PATH = _DATA_DIR / "meetings.json"
_LOCK = threading.Lock()


class Meeting(TypedDict):
    id: str
    title: str
    owner_email: str
    org_id: str
    visibility: Literal["private", "org"]
    body: str
    s3_key: str | None
    created_at: float


def _read() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        return json.loads(_STORE_PATH.read_text())
    except json.JSONDecodeError:
        return []


def _write(meetings: list[dict]) -> None:
    _STORE_PATH.write_text(json.dumps(meetings, indent=2))


def list_for_user(user_email: str, org_id: str) -> list[dict]:
    with _LOCK:
        meetings = _read()
    visible = [
        m
        for m in meetings
        if m["owner_email"] == user_email
        or (m["visibility"] == "org" and m["org_id"] == org_id)
    ]
    visible.sort(key=lambda m: m["created_at"], reverse=True)
    return visible


def get(meeting_id: str) -> dict | None:
    with _LOCK:
        for m in _read():
            if m["id"] == meeting_id:
                return m
    return None


def create(
    *,
    title: str,
    body: str,
    owner_email: str,
    org_id: str,
    visibility: Literal["private", "org"] = "org",
    s3_key: str | None = None,
) -> dict:
    meeting: dict = {
        "id": uuid.uuid4().hex[:12],
        "title": title,
        "owner_email": owner_email,
        "org_id": org_id,
        "visibility": visibility,
        "body": body,
        "s3_key": s3_key,
        "created_at": time.time(),
    }
    with _LOCK:
        meetings = _read()
        meetings.append(meeting)
        _write(meetings)
    return meeting


def update_visibility(
    meeting_id: str, owner_email: str, visibility: Literal["private", "org"]
) -> dict | None:
    with _LOCK:
        meetings = _read()
        for m in meetings:
            if m["id"] == meeting_id and m["owner_email"] == owner_email:
                m["visibility"] = visibility
                _write(meetings)
                return m
    return None
