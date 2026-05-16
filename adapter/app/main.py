"""Steno enterprise adapter — FastAPI service.

Runs in the customer's environment. Holds the shared AI provider key, brokers
S3 presigned URLs for shared meeting artifacts, and stores meeting metadata
with org-wide visibility.

Demo customer: enam.co (see app/users.json).
"""
from __future__ import annotations

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import ai, auth, meetings, sso, uploads

app = FastAPI(
    title="Steno Adapter",
    version="0.1.0",
    description="Enterprise adapter for Steno — auth, S3 brokering, AI key proxy.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(sso.router)
app.include_router(meetings.router)
app.include_router(uploads.router)
app.include_router(ai.router)


@app.get("/health")
def health():
    allowlist_raw = os.environ.get("ORG_ID_ALLOWLIST", "").strip()
    return {
        "status": "ok",
        "service": "steno-adapter",
        "org_id_allowlist": [s.strip() for s in allowlist_raw.split(",") if s.strip()],
        "s3_configured": bool(os.environ.get("S3_BUCKET")),
        "anthropic_configured": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "google_oidc_configured": bool(
            os.environ.get("GOOGLE_OIDC_CLIENT_ID")
            and os.environ.get("GOOGLE_OIDC_CLIENT_SECRET"),
        ),
    }
