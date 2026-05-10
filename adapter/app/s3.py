"""Thin boto3 wrapper for presigned S3 URLs.

If S3_BUCKET is unset the helpers return None so the adapter still runs without
AWS credentials — meeting bodies are stored inline in the JSON store.
"""
from __future__ import annotations

import os
from functools import lru_cache

import boto3
from botocore.config import Config

PRESIGN_TTL_SECONDS = 15 * 60


@lru_cache(maxsize=1)
def _client():
    region = os.environ.get("AWS_REGION", "us-east-1")
    return boto3.client(
        "s3",
        region_name=region,
        config=Config(signature_version="s3v4"),
    )


def bucket() -> str | None:
    return os.environ.get("S3_BUCKET") or None


def presigned_put(key: str, content_type: str = "application/octet-stream") -> str | None:
    b = bucket()
    if not b:
        return None
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": b, "Key": key, "ContentType": content_type},
        ExpiresIn=PRESIGN_TTL_SECONDS,
    )


def presigned_get(key: str) -> str | None:
    b = bucket()
    if not b:
        return None
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": b, "Key": key},
        ExpiresIn=PRESIGN_TTL_SECONDS,
    )
