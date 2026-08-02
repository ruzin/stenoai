#!/usr/bin/env bash
#
# Strip non-native architecture code out of bin/ before it gets bundled (#427).
#
# Ollama's darwin tarball is built for both Apple Silicon and Intel Macs:
#   - `ollama`, `llama-server`, `llama-quantize` and the mlx_metal_v3/ dylibs
#     are universal (x86_64 + arm64)
#   - the llama.cpp CPU runners (libggml-cpu-*.so, libllama*.dylib, ...) are
#     x86_64-ONLY - they are the Intel-Mac path and can never load on arm64
#     (upstream builds arm64 with the MLX backends and takes that payload from
#     the amd64 tree, universalising only the executables and MLX libs)
#
# The macOS release has been arm64-only since v0.4.0 (see the single-entry arch
# matrix in .github/workflows/build-release.yml), so all of that is dead weight
# in the shipped app: ~60 MB of x86_64 slices plus ~32 MB of x86_64-only files.
#
# Safe to run before signing: electron-builder re-signs the nested binaries with
# the app's own identity (the shipped bundle reports TeamIdentifier HSDX294RG4,
# not Ollama's), so thinning does not strip a signature the build depends on.
# It must NOT run after signing, which is why it lives next to the download step.
# Note that thinned files no longer verify against Ollama's upstream signature -
# only the app's own signature applies from here on.
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

# Without lipo every file looks like "not a Mach-O" and the guard at the end
# would pass vacuously. Fail loudly instead.
if ! command -v lipo >/dev/null 2>&1; then
    echo "thin-macos-bin: lipo not found - cannot inspect or thin binaries." >&2
    exit 1
fi

WORK_LIST="$(mktemp -t thin-macos-bin)"
TMP_OUT=""
cleanup() {
    rm -f "$WORK_LIST"
    [[ -n "$TMP_OUT" ]] && rm -f "$TMP_OUT"
    return 0
}
trap cleanup EXIT

# Collect into a file first so a find failure is caught - a `while ... done <
# <(find ...)` loop silently succeeds on a partial scan.
collect() {
    # args: the find predicate to apply (e.g. -type f)
    if ! find "$BIN_DIR" "$@" -print0 > "$WORK_LIST"; then
        echo "thin-macos-bin: scanning $BIN_DIR failed." >&2
        exit 1
    fi
}

collect_following_symlinks() {
    # Same, but -L descends into symlinked directories. `-L` has to precede the
    # path, so this cannot just be another argument to collect().
    if ! find -L "$BIN_DIR" "$@" -print0 > "$WORK_LIST"; then
        echo "thin-macos-bin: scanning $BIN_DIR (following symlinks) failed." >&2
        exit 1
    fi
}

echo "=== Thinning $BIN_DIR to arm64 ==="

thinned=0
removed=0
saved=0

collect -type f   # symlinks are handled in the follow-up pass
while IFS= read -r -d '' file; do
    info="$(lipo -info "$file" 2>/dev/null)" || continue  # not a Mach-O file

    if [[ "$info" == "Architectures in the fat file"* ]]; then
        # Exact word match on the arch list - a substring test would accept
        # "arm64e" as "arm64" and then fail the lipo -thin below.
        archs=" $(lipo -archs "$file" 2>/dev/null) "
        if [[ "$archs" != *" arm64 "* ]]; then
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
        # Beside the destination, not in $TMPDIR: mv is only atomic within one
        # filesystem. Across volumes macOS mv unlinks the destination first and
        # then copies, so a failure mid-copy would leave neither the original
        # nor the thinned binary.
        TMP_OUT="$(mktemp "$(dirname "$file")/.thin-XXXXXXXX")"
        lipo -thin arm64 "$file" -output "$TMP_OUT"
        chmod "$mode" "$TMP_OUT"
        mv -f "$TMP_OUT" "$file"
        TMP_OUT=""
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
    # Any other thin arch (arm64e, x86_64h, ppc, ...) is deliberately left alone
    # and caught by the guard below rather than deleted on a guess.
done < "$WORK_LIST"

# Symlinks such as libggml-base.0.dylib -> libggml-base.0.15.3.dylib dangle once
# their x86-only target is gone.
collect -type l
while IFS= read -r -d '' link; do
    if [[ ! -e "$link" ]]; then
        rm -f "$link"
        echo "  removed (dangling symlink): ${link#"$REPO_ROOT"/}"
    fi
done < "$WORK_LIST"

echo "Thinned $thinned file(s), removed $removed file(s), saved $((saved / 1048576)) MB."

# Guard: assert positively that every Mach-O reachable from bin/ is arm64-only.
# Blacklisting known-bad arches would let an unexpected one (arm64e, x86_64h, a
# symlink pointing outside bin/) through, so anything that is not exactly
# "arm64" fails the build.
#
# `find -L` follows symlinks, so a symlinked directory (bin/vendor -> /payload)
# is descended into rather than inspected as one opaque entry. An unreadable
# file is failed rather than skipped - "lipo could not look at it" must not read
# as "it is fine".
leftovers=0
collect_following_symlinks ! -type d
while IFS= read -r -d '' entry; do
    if [[ ! -r "$entry" ]]; then
        echo "thin-macos-bin: cannot read ${entry#"$REPO_ROOT"/} - refusing to certify it." >&2
        leftovers=$((leftovers + 1))
        continue
    fi
    info="$(lipo -info "$entry" 2>/dev/null)" || continue  # not a Mach-O file
    if [[ "$info" != *"is architecture: arm64" ]]; then
        echo "thin-macos-bin: non-arm64 binary: ${entry#"$REPO_ROOT"/} ($info)" >&2
        leftovers=$((leftovers + 1))
    fi
done < "$WORK_LIST"

if (( leftovers > 0 )); then
    echo "thin-macos-bin: $leftovers non-arm64 binary/binaries left in bin/." >&2
    exit 1
fi

echo "Verified: every Mach-O file in bin/ is arm64-only."
