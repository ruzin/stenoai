"""Google OIDC sign-in.

Flow (desktop client + adapter, single-tenant):

    Steno desktop                  adapter                  Google
    -------------                  -------                  ------
    1. Generate state + PKCE
       code_verifier locally
    2. POST /auth/sso/google/start
       { redirect_uri,
         code_challenge,
         state }
                              ──▶ build authorize_url
                                  (client_id from .env,
                                   client_secret stays here)
                              ◀── { authorize_url }
    3. Open system browser
       at authorize_url
                                                       ──▶  user signs in
                                                       ◀──  redirect to
                                                            loopback w/ code
    4. Desktop captures code,
       verifies state matches
    5. POST /auth/sso/google/callback
       { code, code_verifier,
         redirect_uri }
                              ──▶ token exchange (client_secret here)
                                  ──▶ Google /token
                                  ◀── { id_token, access_token }
                                  verify id_token vs JWKS,
                                  extract email/name/hd,
                                  org-allowlist check,
                                  mint adapter session JWT
                              ◀── { token, email, name, org_id }
    6. Desktop persists session
       (same shape as /auth/login)

The desktop never touches the Google client_secret. The adapter never
sees the user's password.
"""
from __future__ import annotations

import os
from typing import Optional
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..security import issue_token

router = APIRouter(prefix="/auth/sso/google", tags=["auth"])

# Hardcoded; Google's discovery doc rarely changes. If they ever break this,
# read /.well-known/openid-configuration once at startup and cache it.
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUER = "https://accounts.google.com"

# One shared JWKS client per process — caches keys, refreshes on rotation.
_jwks_client = jwt.PyJWKClient(GOOGLE_JWKS_URL)


def _client_id_or_503() -> str:
    cid = os.environ.get("GOOGLE_OIDC_CLIENT_ID")
    if not cid:
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_OIDC_CLIENT_ID not configured on this adapter",
        )
    return cid


def _client_secret_or_503() -> str:
    cs = os.environ.get("GOOGLE_OIDC_CLIENT_SECRET")
    if not cs:
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_OIDC_CLIENT_SECRET not configured on this adapter",
        )
    return cs


def _org_allowlist() -> list[str]:
    raw = os.environ.get("ORG_ID_ALLOWLIST", "").strip()
    if not raw:
        return []
    return [s.strip().lower() for s in raw.split(",") if s.strip()]


def _allow_non_workspace() -> bool:
    return os.environ.get("OIDC_ALLOW_NON_WORKSPACE", "").lower() in {"1", "true", "yes"}


def _resolve_org_id(email: str, hd_claim: Optional[str]) -> str:
    """Map an authenticated Google identity to an org_id, honouring the
    allowlist. Order of precedence:

    1. `hd` (Google Workspace hosted-domain) — definitive admin-controlled
       attestation that the account belongs to that domain.
    2. Email domain (e.g. `alice@enam.co` → `enam.co`) — only used when
       OIDC_ALLOW_NON_WORKSPACE is on; treat with care because anyone with
       a Gmail account can claim a personal-domain `email_verified=true`.

    Raises HTTPException(403) if neither candidate passes the allowlist.
    """
    allowlist = _org_allowlist()
    email_domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""

    if hd_claim:
        candidate = hd_claim.lower()
        if not allowlist or candidate in allowlist:
            return candidate
        raise HTTPException(
            status_code=403,
            detail=f"Workspace domain '{candidate}' is not in this adapter's allowlist",
        )

    if not _allow_non_workspace():
        raise HTTPException(
            status_code=403,
            detail=(
                "This account isn't a Google Workspace account. The adapter "
                "requires Workspace sign-in (OIDC_ALLOW_NON_WORKSPACE is off)."
            ),
        )

    if not email_domain:
        raise HTTPException(status_code=403, detail="No email domain on the token")
    if not allowlist or email_domain in allowlist:
        return email_domain
    raise HTTPException(
        status_code=403,
        detail=f"Email domain '{email_domain}' is not in this adapter's allowlist",
    )


# ----------------------------------------------------------------------------
# /auth/sso/google/start
# ----------------------------------------------------------------------------

class StartRequest(BaseModel):
    redirect_uri: str
    code_challenge: str  # PKCE S256, base64url(sha256(code_verifier))
    state: str


class StartResponse(BaseModel):
    authorize_url: str


@router.post("/start", response_model=StartResponse)
def start(payload: StartRequest):
    client_id = _client_id_or_503()
    params = {
        "client_id": client_id,
        "redirect_uri": payload.redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": payload.state,
        "code_challenge": payload.code_challenge,
        "code_challenge_method": "S256",
        # Force account chooser so testers can switch identities.
        "prompt": "select_account",
        # We don't need a refresh token for the adapter pattern; the
        # adapter mints its own session JWT after a successful sign-in.
        "access_type": "online",
    }
    return StartResponse(
        authorize_url=f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}",
    )


# ----------------------------------------------------------------------------
# /auth/sso/google/callback
# ----------------------------------------------------------------------------

class CallbackRequest(BaseModel):
    code: str
    code_verifier: str
    redirect_uri: str


class CallbackResponse(BaseModel):
    token: str
    email: str
    name: str
    org_id: str


@router.post("/callback", response_model=CallbackResponse)
def callback(payload: CallbackRequest):
    client_id = _client_id_or_503()
    client_secret = _client_secret_or_503()

    # 1. Exchange the authorization code for an ID token.
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": payload.code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": payload.redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": payload.code_verifier,
                },
                headers={"accept": "application/json"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Token exchange request failed: {e}")

    if res.status_code != 200:
        # Surface Google's error_description verbatim — these are usually
        # actionable ("redirect_uri_mismatch", "invalid_grant", etc.).
        body = (res.text or "")[:400]
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {body}")

    token_body = res.json()
    id_token = token_body.get("id_token")
    if not id_token:
        raise HTTPException(status_code=502, detail="Google did not return an id_token")

    # 2. Verify the ID token signature + standard claims.
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(
            id_token,
            signing_key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=GOOGLE_ISSUER,
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"ID token verification failed: {e}")

    # 3. Pull the user identity. `email_verified` should be True for any
    # real Google account; reject otherwise so an attacker can't claim a
    # domain they don't own.
    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="ID token has no email claim")
    if claims.get("email_verified") is False:
        raise HTTPException(status_code=401, detail="email_verified is false on the ID token")

    name = claims.get("name") or email
    hd_claim = claims.get("hd")  # only set for Workspace accounts

    # 4. Apply the org allowlist policy.
    org_id = _resolve_org_id(email=email, hd_claim=hd_claim)

    # 5. Mint our own short-lived session JWT — same shape as /auth/login
    # so every downstream route works unchanged.
    user_record = {"email": email, "name": name, "org_id": org_id}
    session_token = issue_token(user_record)

    return CallbackResponse(
        token=session_token,
        email=email,
        name=name,
        org_id=org_id,
    )
