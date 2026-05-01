"""Chinese script conversion (Simplified ↔ Traditional) via OpenCC."""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

_converter_s2t = None
_converter_t2s = None
_unavailable_logged = False


def _get_converter(direction: str):
    global _converter_s2t, _converter_t2s, _unavailable_logged
    try:
        from opencc import OpenCC
    except ImportError:
        if not _unavailable_logged:
            logger.warning("opencc not installed — Chinese variant conversion disabled")
            _unavailable_logged = True
        return None
    if direction == "s2t":
        if _converter_s2t is None:
            _converter_s2t = OpenCC("s2t")
        return _converter_s2t
    if direction == "t2s":
        if _converter_t2s is None:
            _converter_t2s = OpenCC("t2s")
        return _converter_t2s
    return None


def to_traditional(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    conv = _get_converter("s2t")
    if conv is None:
        return text
    try:
        return conv.convert(text)
    except Exception as e:
        logger.warning(f"OpenCC s2t conversion failed: {e}")
        return text


def to_simplified(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    conv = _get_converter("t2s")
    if conv is None:
        return text
    try:
        return conv.convert(text)
    except Exception as e:
        logger.warning(f"OpenCC t2s conversion failed: {e}")
        return text


def apply_variant(text: Optional[str], variant: Optional[str]) -> Optional[str]:
    """Convert text to the requested Chinese variant; pass through if N/A."""
    if variant == "traditional":
        return to_traditional(text)
    if variant == "simplified":
        return to_simplified(text)
    return text
