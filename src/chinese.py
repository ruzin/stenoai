"""Chinese script conversion (Simplified ↔ Traditional) via OpenCC.

Thin, dependency-optional wrapper. OpenCC (``opencc-python-reimplemented``) is
imported lazily so a bundle or dev checkout without it degrades gracefully:
every entry point returns its input unchanged rather than raising, and the
"unavailable" warning is logged once. whisper.cpp / Parakeet emit Simplified
for Chinese ("zh"); this module is how a user who picked Traditional
(``zh-Hant``) gets their transcript + summary converted after the fact.
"""
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
            try:
                _converter_s2t = OpenCC("s2t")
            except Exception as e:
                logger.warning(f"OpenCC s2t converter unavailable: {e}")
                return None
        return _converter_s2t
    if direction == "t2s":
        if _converter_t2s is None:
            try:
                _converter_t2s = OpenCC("t2s")
            except Exception as e:
                logger.warning(f"OpenCC t2s converter unavailable: {e}")
                return None
        return _converter_t2s
    return None


def to_traditional(text: Optional[str]) -> Optional[str]:
    """Simplified → Traditional (s2t). Pass-through when OpenCC is unavailable."""
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
    """Traditional → Simplified (t2s). Pass-through when OpenCC is unavailable."""
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
    """Convert ``text`` to the requested Chinese variant; pass through if N/A.

    ``variant`` accepts the config-level names ``"traditional"`` / ``"simplified"``
    (see ``Config.get_chinese_variant``) as well as the UI language codes
    ``"zh-Hant"`` / ``"zh-Hans"``. Anything else (None, "en", …) returns the
    input unchanged.
    """
    if variant in ("traditional", "zh-Hant"):
        return to_traditional(text)
    if variant in ("simplified", "zh-Hans"):
        return to_simplified(text)
    return text


def convert(text: Optional[str], target_variant: Optional[str]) -> Optional[str]:
    """Public alias for :func:`apply_variant` (converts ``text`` to ``target_variant``)."""
    return apply_variant(text, target_variant)
