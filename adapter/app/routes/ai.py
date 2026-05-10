"""Anthropic Claude proxy.

The adapter holds ANTHROPIC_API_KEY server-side. The desktop client calls
/ai/chat with a list of messages and gets the assistant reply back, never
touching the provider key directly.
"""
from __future__ import annotations

import os
from typing import Literal

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..security import current_user

router = APIRouter(prefix="/ai", tags=["ai"])

DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 1024


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)
    system: str | None = None
    model: str = DEFAULT_MODEL
    max_tokens: int = Field(default=DEFAULT_MAX_TOKENS, ge=1, le=4096)


class ChatResponse(BaseModel):
    reply: str
    model: str
    input_tokens: int
    output_tokens: int


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, user=Depends(current_user)):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured on this adapter",
        )
    client = anthropic.Anthropic(api_key=api_key)
    kwargs: dict = {
        "model": payload.model,
        "max_tokens": payload.max_tokens,
        "messages": [m.model_dump() for m in payload.messages],
    }
    if payload.system:
        kwargs["system"] = payload.system

    try:
        resp = client.messages.create(**kwargs)
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"upstream error: {e}")

    text_parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    return ChatResponse(
        reply="".join(text_parts),
        model=resp.model,
        input_tokens=resp.usage.input_tokens,
        output_tokens=resp.usage.output_tokens,
    )
