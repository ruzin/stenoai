#!/bin/bash
# Download Ollama and ffmpeg binaries for bundling with PyInstaller
# Supports macOS, Linux, and Windows

set -e

OLLAMA_VERSION="v0.30.8"
BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"

# --- Download ffmpeg ---
echo "=== Downloading ffmpeg ==="
case "$(uname -s)" in
    Darwin)
        # ffmpeg must match the BUILD architecture, not just the OS. evermeet.cx
        # (the old URL) ships x86_64-only mac builds, so it bundled an Intel ffmpeg
        # into the arm64 release — which crashes on Apple Silicon without Rosetta
        # (#209). The mac build is Apple-Silicon only (arm64) since v0.4.0, so use
        # osxexperts' arm64 static build (same 7.1.1 as before) and refuse any
        # other arch rather than silently shipping a mismatch.
        if [ "$(uname -m)" != "arm64" ]; then
            echo "macOS build is arm64-only; unsupported arch: $(uname -m)" >&2
            exit 1
        fi
        FFMPEG_URL="https://www.osxexperts.net/ffmpeg711arm.zip"
        mkdir -p "$BIN_DIR"
        curl -L "$FFMPEG_URL" -o "$BIN_DIR/ffmpeg.zip"
        cd "$BIN_DIR"
        # Extract only the binary; skip the __MACOSX resource-fork junk in the zip.
        unzip -o ffmpeg.zip ffmpeg
        rm ffmpeg.zip
        chmod +x ffmpeg
        # Validate the binary before bundling it. Two distinct failure modes:
        #  1. Wrong architecture. An x86_64 ffmpeg runs fine HERE under Rosetta and
        #     would sail through the -version check, then crash on a Rosetta-less
        #     user machine (#209). Assert the Mach-O is arm64 so the script
        #     self-enforces the arch rather than leaning only on the external CI
        #     `file ... arm64` guard.
        #  2. Truncated/corrupt download or wrong-format extract. Run -version and
        #     pin the major; pipefail (scoped to a subshell) makes a non-zero
        #     ffmpeg exit fail loudly instead of being masked by grep's exit.
        # set -e turns either non-zero exit into a loud build failure.
        if ! file ./ffmpeg | grep -q "arm64"; then
            echo "Downloaded ffmpeg is not an arm64 binary: $(file ./ffmpeg)" >&2
            exit 1
        fi
        if ! ( set -o pipefail; ./ffmpeg -version | grep -q "ffmpeg version 7.1" ); then
            echo "Downloaded ffmpeg failed -version or is not 7.1.x" >&2
            exit 1
        fi
        echo "ffmpeg 7.1.1 (arm64) downloaded"
        cd - > /dev/null
        ;;
    Linux)
        # Use static build for Linux
        FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
        mkdir -p "$BIN_DIR"
        curl -L "$FFMPEG_URL" -o "$BIN_DIR/ffmpeg.tar.xz"
        cd "$BIN_DIR"
        tar -xf ffmpeg.tar.xz --strip-components=1 --wildcards '*/ffmpeg'
        rm ffmpeg.tar.xz
        chmod +x ffmpeg
        echo "ffmpeg downloaded"
        cd - > /dev/null
        ;;
    MINGW*|MSYS*|CYGWIN*)
        # Windows (running under Git Bash on windows-latest CI or MSYS). Use
        # BtbN's static GPL build — one self-contained ffmpeg.exe, no DLLs.
        FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
        mkdir -p "$BIN_DIR"
        curl -L "$FFMPEG_URL" -o "$BIN_DIR/ffmpeg.zip"
        cd "$BIN_DIR"
        # Zip nests under a versioned dir; pull just ffmpeg.exe into bin/.
        unzip -o ffmpeg.zip -d ffmpeg-extract > /dev/null
        find ffmpeg-extract -name 'ffmpeg.exe' -exec mv {} . \;
        rm -rf ffmpeg-extract ffmpeg.zip
        echo "ffmpeg.exe downloaded"
        cd - > /dev/null
        ;;
    *)
        echo "Note: ffmpeg not auto-downloaded for this platform. Please install manually."
        ;;
esac

# --- Download Ollama ---
echo ""
echo "=== Downloading Ollama ==="

# Detect platform
case "$(uname -s)" in
    Darwin)
        OLLAMA_FILE="ollama-darwin.tgz"
        ;;
    Linux)
        OLLAMA_FILE="ollama-linux-amd64.tgz"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        OLLAMA_FILE="ollama-windows-amd64.zip"
        ;;
    *)
        echo "Unsupported platform: $(uname -s)"
        exit 1
        ;;
esac

OLLAMA_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/${OLLAMA_FILE}"

echo "Platform: $(uname -s)"
echo "Downloading Ollama ${OLLAMA_VERSION} (${OLLAMA_FILE})..."

# Create bin directory
mkdir -p "$BIN_DIR"
cd "$BIN_DIR"

# Download
curl -L "$OLLAMA_URL" -o "$OLLAMA_FILE"

# Extract based on file type
if [[ "$OLLAMA_FILE" == *.zip ]]; then
    unzip -o "$OLLAMA_FILE"
else
    tar -xzf "$OLLAMA_FILE"
fi

rm "$OLLAMA_FILE"

echo "Ollama downloaded to $BIN_DIR"
ls -la "$BIN_DIR"
