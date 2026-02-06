#!/bin/bash
# Download Ollama and ffmpeg binaries for bundling with PyInstaller
# Supports macOS, Linux, and Windows

set -e

OLLAMA_VERSION="v0.15.4"
BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"

# --- Download ffmpeg ---
echo "=== Downloading ffmpeg ==="
case "$(uname -s)" in
    Darwin)
        FFMPEG_URL="https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip"
        mkdir -p "$BIN_DIR"
        curl -L "$FFMPEG_URL" -o "$BIN_DIR/ffmpeg.zip"
        cd "$BIN_DIR"
        unzip -o ffmpeg.zip
        rm ffmpeg.zip
        chmod +x ffmpeg
        echo "ffmpeg downloaded"
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
