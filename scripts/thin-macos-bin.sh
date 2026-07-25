#!/usr/bin/env bash
#
# Strip non-native architecture code out of bin/ before it gets bundled (#427).
#
# Ollama's darwin tarball is built for both Apple Silicon and Intel Macs:
#   - `ollama`, `llama-server`, `llama-quantize` and the mlx_metal_v3/ dylibs
#     are universal (x86_64 + arm64)
#   - the llama.cpp CPU runners (libggml-cpu-*.so, libllama*.dylib, ...) are
#     x86_64-ONLY - they are the Intel-Mac path and can never load on arm64
#
# The macOS release has been arm64-only since v0.4.0 (see the single-entry arch
# matrix in .github/workflows/build-release.yml), so all of that is dead weight
# in the shipped app: ~60 MB of x86_64 slices plus ~32 MB of x86_64-only files.
#
# Safe to run before signing: electron-builder re-signs the nested binaries with
# the app's own identity (the shipped bundle reports TeamIdentifier HSDX294RG4,
# not Ollama's), so thinning does not strip a signature the build depends on.
# It must NOT run after signing, which is why it lives next to the download step.
#
# Idempotent: a second run finds nothing to do. No-op on non-darwin hosts and on
# any target arch other than arm64 (an Intel build needs exactly what this
# removes).
#
# Usage:
#   ./scripts/thin-macos-bin.sh            # target arch = uname -m
#   ./scripts/thin-macos-bin.sh arm64      # explicit target arch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$REPO_ROOT/bin"

TARGET_ARCH="${1:-$(uname -m)}"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "thin-macos-bin: not darwin, nothing to do."
    exit 0
fi

if [[ "$TARGET_ARCH" != "arm64" ]]; then
    echo "thin-macos-bin: target arch '$TARGET_ARCH' is not arm64 - keeping every slice."
    exit 0
fi

# Defensive: never let the delete loop below run against an unexpected path.
if [[ ! -d "$BIN_DIR" || "$(basename "$BIN_DIR")" != "bin" ]]; then
    echo "thin-macos-bin: '$BIN_DIR' is not a bin/ directory - refusing to touch it." >&2
    exit 1
fi

echo "=== Thinning $BIN_DIR to arm64 ==="

thinned=0
removed=0
saved=0

# -type f skips symlinks; the dangling ones are cleaned up afterwards.
while IFS= read -r file; do
    info="$(lipo -info "$file" 2>/dev/null)" || continue  # not a Mach-O file

    if [[ "$info" == "Architectures in the fat file"* ]]; then
        if [[ "$info" != *"arm64"* ]]; then
            # Universal, but no arm64 slice at all (e.g. i386 + x86_64).
            before=$(stat -f%z "$file")
            rm -f "$file"
            removed=$((removed + 1))
            saved=$((saved + before))
            echo "  removed (no arm64 slice): ${file#"$REPO_ROOT"/}"
            continue
        fi

        before=$(stat -f%z "$file")
        mode=$(stat -f%Lp "$file")
        tmp="$file.arm64.tmp"
        lipo -thin arm64 "$file" -output "$tmp"
        chmod "$mode" "$tmp"
        mv -f "$tmp" "$file"
        after=$(stat -f%z "$file")
        thinned=$((thinned + 1))
        saved=$((saved + before - after))
        echo "  thinned: ${file#"$REPO_ROOT"/} ($((before / 1048576)) MB -> $((after / 1048576)) MB)"

    elif [[ "$info" == *"is architecture: x86_64" || "$info" == *"is architecture: i386" ]]; then
        before=$(stat -f%z "$file")
        rm -f "$file"
        removed=$((removed + 1))
        saved=$((saved + before))
        echo "  removed (x86-only): ${file#"$REPO_ROOT"/}"
    fi
done < <(find "$BIN_DIR" -type f)

# Symlinks such as libggml-base.0.dylib -> libggml-base.0.15.3.dylib dangle once
# their x86-only target is gone.
while IFS= read -r link; do
    if [[ ! -e "$link" ]]; then
        rm -f "$link"
        echo "  removed (dangling symlink): ${link#"$REPO_ROOT"/}"
    fi
done < <(find "$BIN_DIR" -type l)

echo "Thinned $thinned file(s), removed $removed file(s), saved $((saved / 1048576)) MB."

# Guard: nothing non-arm64 may survive into the bundle.
leftovers=0
while IFS= read -r file; do
    info="$(lipo -info "$file" 2>/dev/null)" || continue
    if [[ "$info" == *"is architecture: x86_64" || "$info" == *"is architecture: i386" ]] \
       || [[ "$info" == "Architectures in the fat file"* ]]; then
        echo "thin-macos-bin: non-arm64 binary survived: ${file#"$REPO_ROOT"/} ($info)" >&2
        leftovers=$((leftovers + 1))
    fi
done < <(find "$BIN_DIR" -type f)

if (( leftovers > 0 )); then
    echo "thin-macos-bin: $leftovers non-arm64 binary/binaries left in bin/." >&2
    exit 1
fi

echo "Verified: every Mach-O file in bin/ is arm64-only."
