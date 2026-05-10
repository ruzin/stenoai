"""Anthropic Claude proxy.

The adapter holds ANTHROPIC_API_KEY server-side. The desktop client calls
/ai/chat (one-shot) or /ai/chat/stream (NDJSON-streamed) and gets the
assistant reply back, never touching the provider key directly.
"""
from __future__ import annotations

import json
import os
from typing import Literal

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
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


def _build_kwargs(payload: ChatRequest) -> dict:
    kwargs: dict = {
        "model": payload.model,
        "max_tokens": payload.max_tokens,
        "messages": [m.model_dump() for m in payload.messages],
    }
    if payload.system:
        kwargs["system"] = payload.system
    return kwargs


def _client_or_503() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured on this adapter",
        )
    return anthropic.Anthropic(api_key=api_key)


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, user=Depends(current_user)):
    client = _client_or_503()
    try:
        resp = client.messages.create(**_build_kwargs(payload))
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"upstream error: {e}")

    text_parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    return ChatResponse(
        reply="".join(text_parts),
        model=resp.model,
        input_tokens=resp.usage.input_tokens,
        output_tokens=resp.usage.output_tokens,
    )


@router.post("/chat/stream")
def chat_stream(payload: ChatRequest, user=Depends(current_user)):
    """NDJSON stream — one JSON object per line.

    Lines:
        {"type": "chunk", "text": "..."}
        ...
        {"type": "done",  "model": "...", "input_tokens": 14, "output_tokens": 42}
        // OR on failure:
        {"type": "error", "error": "..."}
    """
    client = _client_or_503()

    def gen():
        try:
            with client.messages.stream(**_build_kwargs(payload)) as stream:
                for text in stream.text_stream:
                    if text:
                        yield json.dumps({"type": "chunk", "text": text}) + "\n"
                final = stream.get_final_message()
                yield (
                    json.dumps({
                        "type": "done",
                        "model": final.model,
                        "input_tokens": final.usage.input_tokens,
                        "output_tokens": final.usage.output_tokens,
                    })
                    + "\n"
                )
        except anthropic.APIError as e:
            yield json.dumps({"type": "error", "error": f"upstream error: {e}"}) + "\n"
        except Exception as e:  # pragma: no cover — fall-through safety
            yield json.dumps({"type": "error", "error": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")
