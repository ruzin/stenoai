#!/bin/bash
# Download Ollama binary for bundling with PyInstaller
# Supports macOS, Linux, and Windows

set -e

OLLAMA_VERSION="v0.15.4"
BIN_DIR="$(dirname "$0")/../bin"

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
