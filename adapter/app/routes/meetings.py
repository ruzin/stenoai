from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import store
from ..s3 import presigned_get
from ..security import current_user

router = APIRouter(prefix="/meetings", tags=["meetings"])


class CreateMeeting(BaseModel):
    title: str = Field(..., max_length=200)
    body: str = ""
    visibility: Literal["private", "org"] = "org"
    s3_key: str | None = None


class UpdateVisibility(BaseModel):
    visibility: Literal["private", "org"]


def _serialize(m: dict, *, include_body: bool, include_url: bool) -> dict:
    out = {
        "id": m["id"],
        "title": m["title"],
        "owner_email": m["owner_email"],
        "org_id": m["org_id"],
        "visibility": m["visibility"],
        "created_at": m["created_at"],
        "has_artifact": bool(m.get("s3_key")),
    }
    if include_body:
        out["body"] = m.get("body", "")
    if include_url and m.get("s3_key"):
        out["download_url"] = presigned_get(m["s3_key"])
    return out


@router.get("")
def list_meetings(user=Depends(current_user)):
    rows = store.list_for_user(user["email"], user["org_id"])
    return {
        "meetings": [_serialize(m, include_body=False, include_url=False) for m in rows],
    }


@router.post("", status_code=201)
def create_meeting(payload: CreateMeeting, user=Depends(current_user)):
    m = store.create(
        title=payload.title,
        body=payload.body,
        owner_email=user["email"],
        org_id=user["org_id"],
        visibility=payload.visibility,
        s3_key=payload.s3_key,
    )
    return _serialize(m, include_body=True, include_url=True)


@router.get("/{meeting_id}")
def get_meeting(meeting_id: str, user=Depends(current_user)):
    m = store.get(meeting_id)
    if not m:
        raise HTTPException(status_code=404, detail="not found")
    if m["owner_email"] != user["email"] and not (
        m["visibility"] == "org" and m["org_id"] == user["org_id"]
    ):
        raise HTTPException(status_code=403, detail="forbidden")
    return _serialize(m, include_body=True, include_url=True)


@router.patch("/{meeting_id}/visibility")
def patch_visibility(
    meeting_id: str,
    payload: UpdateVisibility,
    user=Depends(current_user),
):
    m = store.update_visibility(meeting_id, user["email"], payload.visibility)
    if not m:
        raise HTTPException(
            status_code=404, detail="not found or not owned by caller"
        )
    return _serialize(m, include_body=True, include_url=True)
