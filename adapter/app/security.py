"""JWT issuance + verification for the demo adapter.

This is intentionally minimal: HS256, hardcoded users, 8-hour expiry.
A real deployment swaps this for OIDC against the customer IdP (Okta / Azure AD
/ Cognito), and verifies the JWT against the IdP's JWKS.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import TypedDict

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

JWT_ALG = "HS256"
JWT_TTL_SECONDS = 8 * 60 * 60

_USERS_PATH = Path(__file__).parent / "users.json"
_bearer = HTTPBearer(auto_error=False)


class User(TypedDict):
    email: str
    name: str
    org_id: str


def _jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET env var is required")
    return secret


def load_users() -> list[dict]:
    return json.loads(_USERS_PATH.read_text())["users"]


def find_user(email: str, password: str) -> dict | None:
    for u in load_users():
        if u["email"].lower() == email.lower() and u["password"] == password:
            return u
    return None


def issue_token(user: dict) -> str:
    now = int(time.time())
    payload = {
        "sub": user["email"],
        "name": user["name"],
        "org_id": user["org_id"],
        "iat": now,
        "exp": now + JWT_TTL_SECONDS,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALG)


def verify_token(token: str) -> User:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="invalid token")
    return User(
        email=payload["sub"],
        name=payload.get("name", payload["sub"]),
        org_id=payload["org_id"],
    )


def current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    # Allow ?token=… on GETs from the demo HTML page so links can be opened
    # directly without crafting an Authorization header.
    token = creds.credentials if creds else request.query_params.get("token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )
    return verify_token(token)
