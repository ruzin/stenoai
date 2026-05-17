#!/usr/bin/env bash
# Build the Swift mic-monitor helper. Intended for CI; the local Makefile is
# equivalent and what developers should use day-to-day.
#
# Usage: scripts/build-mic-monitor.sh [arch]
#   arch defaults to host arch (arm64 / x86_64).
set -euo pipefail

ARCH="${1:-$(uname -m)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/mic-monitor/mic_monitor.swift"
OUT="$ROOT/bin/mic-monitor"

mkdir -p "$ROOT/bin"

swiftc -O \
    -target "${ARCH}-apple-macos12.3" \
    -framework CoreAudio \
    -framework AppKit \
    -o "$OUT" \
    "$SRC"

# Ad-hoc signature so the binary runs locally; CI re-signs with the Developer
# ID when packaging the .app bundle.
codesign --sign - "$OUT" 2>/dev/null || true

file "$OUT"
