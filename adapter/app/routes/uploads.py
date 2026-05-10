from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..s3 import bucket, presigned_put
from ..security import current_user

router = APIRouter(prefix="/uploads", tags=["uploads"])


class PresignRequest(BaseModel):
    filename: str
    content_type: str = "text/markdown"


class PresignResponse(BaseModel):
    upload_url: str
    s3_key: str
    expires_in: int


@router.post("/presign", response_model=PresignResponse)
def presign(payload: PresignRequest, user=Depends(current_user)):
    if not bucket():
        raise HTTPException(
            status_code=503,
            detail="S3 not configured on this adapter (set S3_BUCKET)",
        )
    safe_name = payload.filename.replace("/", "_")
    key = f"meetings/{user['org_id']}/{uuid.uuid4().hex[:12]}-{safe_name}"
    url = presigned_put(key, payload.content_type)
    if not url:
        raise HTTPException(status_code=503, detail="presign failed")
    return PresignResponse(upload_url=url, s3_key=key, expires_in=15 * 60)
