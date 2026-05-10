from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..security import current_user, find_user, issue_token

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    email: str
    name: str
    org_id: str


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest) -> LoginResponse:
    user = find_user(body.email, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="invalid credentials")
    token = issue_token(user)
    return LoginResponse(
        token=token,
        email=user["email"],
        name=user["name"],
        org_id=user["org_id"],
    )


@router.get("/me")
def me(user=Depends(current_user)):
    return user
