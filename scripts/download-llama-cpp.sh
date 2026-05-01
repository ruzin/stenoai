#!/bin/bash
# Download llama-server (llama.cpp) binaries for both arm64 and x64 macOS,
# bundled alongside Ollama in the StenoAI distribution.
#
# llama-server is the inference path for models Ollama 0.17.x can't load
# (multimodal split-GGUF: Gemma 4, Qwen 3.5, etc.). It exposes an
# OpenAI-compatible chat API on http://127.0.0.1:18080.
#
# Outputs:
#   bin/llamacpp-arm64/llama-server (+ Metal dylibs)
#   bin/llamacpp-x64/llama-server   (+ dylibs)
#
# CI builds for a single architecture only need the matching variant; the
# stenoai.spec PyInstaller bundle picks the right one based on host arch.

set -e

# Pinned version. Bump after re-validating model loads (gemma4, qwen3.5).
LLAMA_CPP_VERSION="b8994"
BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"

case "$(uname -s)" in
    Darwin) ;;
    *)
        echo "llama.cpp bundling currently only supported on macOS host."
        exit 0
        ;;
esac

mkdir -p "$BIN_DIR"

download_arch() {
    local ARCH="$1"
    local FILENAME="llama-${LLAMA_CPP_VERSION}-bin-macos-${ARCH}.tar.gz"
    local URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/${FILENAME}"
    local TARGET_DIR="$BIN_DIR/llamacpp-${ARCH}"

    echo ""
    echo "=== Downloading llama-server (${ARCH}) ==="
    echo "URL: $URL"

    rm -rf "$TARGET_DIR"
    mkdir -p "$TARGET_DIR"

    local TMP_TAR="$BIN_DIR/${FILENAME}"
    curl -L -f "$URL" -o "$TMP_TAR"

    # The archive extracts to llama-${VERSION}/ — flatten into our target dir.
    local TMP_EXTRACT
    TMP_EXTRACT="$(mktemp -d)"
    tar -xzf "$TMP_TAR" -C "$TMP_EXTRACT"

    local SRC_DIR
    SRC_DIR="$(find "$TMP_EXTRACT" -maxdepth 1 -type d -name "llama-*" | head -n1)"
    if [ -z "$SRC_DIR" ]; then
        # Some release packagings flatten everything into root.
        SRC_DIR="$TMP_EXTRACT"
    fi

    cp -R "$SRC_DIR"/* "$TARGET_DIR/"

    # We only need llama-server + the dylibs it links. Strip the rest to
    # keep the bundle small (the archive ships ~30+ binaries).
    find "$TARGET_DIR" -maxdepth 1 -type f \
        -not -name "llama-server" \
        -not -name "*.dylib" \
        -not -name "*.metallib" \
        -not -name "LICENSE" \
        -delete

    chmod +x "$TARGET_DIR/llama-server"

    rm -f "$TMP_TAR"
    rm -rf "$TMP_EXTRACT"

    echo "Extracted to: $TARGET_DIR"
    ls -la "$TARGET_DIR" | head -20
}

# Default: download both architectures (CI uploads per-arch DMGs but we
# keep both available locally so dev rebuilds pick the right one).
# Override with LLAMA_CPP_ARCH=arm64 or LLAMA_CPP_ARCH=x64 to download
# only one (used by the GitHub Actions matrix to save bandwidth).
case "${LLAMA_CPP_ARCH:-both}" in
    arm64)
        download_arch arm64
        ;;
    x64)
        download_arch x64
        ;;
    both)
        download_arch arm64
        download_arch x64
        ;;
    *)
        echo "Unknown LLAMA_CPP_ARCH=${LLAMA_CPP_ARCH}; expected arm64, x64, or both."
        exit 1
        ;;
esac

echo ""
echo "llama-server bundled to ${BIN_DIR}/llamacpp-*"
