#!/bin/bash

# Script to simulate a completely fresh DMG install
# This removes ALL dependencies and data to test true first-time experience

echo "🚀 Simulating completely fresh DMG install..."
echo "This will remove EVERYTHING to test the full setup flow"
echo ""

# 1. Remove Python virtual environment entirely
echo "🗑️ Removing Python virtual environment..."
rm -rf venv

# 2. Remove all user data directories  
echo "📁 Removing user data directories..."
rm -rf recordings transcripts output

# 3. Remove Whisper from system Python
echo "🎤 Removing Whisper from system Python..."
python3 -m pip uninstall -y openai-whisper 2>/dev/null || echo "Whisper not in system Python"

# 4. Remove Ollama completely (binary + models)
echo "🧠 Removing Ollama completely..."
if command -v ollama &> /dev/null; then
    echo "  - Stopping Ollama services..."
    pkill -f "ollama" 2>/dev/null || echo "  - No Ollama processes running"
    
    echo "  - Uninstalling Ollama via Homebrew..."
    brew uninstall ollama 2>/dev/null || echo "  - Ollama not installed via Homebrew"
    
    echo "  - Removing Ollama models and data..."
    rm -rf ~/.ollama 2>/dev/null || echo "  - No Ollama data to remove"
else
    echo "  - Ollama not found (already removed)"
fi

# 5. Remove Whisper cache
echo "🗄️ Removing Whisper cache..."
rm -rf ~/.cache/whisper 2>/dev/null || echo "No Whisper cache to remove"

# 6. Optionally test without Homebrew (uncomment to test Homebrew auto-install)
# echo "🍺 Removing Homebrew (EXTREME TEST)..."
# /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)" || echo "Homebrew removal failed or not installed"

echo ""
echo "🎯 Complete fresh install simulation ready!"
echo ""
echo "Removed:"
echo "  ❌ Python virtual environment"
echo "  ❌ All user data directories"  
echo "  ❌ Whisper (system-wide)"
echo "  ❌ Ollama binary and models"
echo "  ❌ All caches"
echo ""
echo "Expected setup flow:"
echo "  1. 🖥️ System Check → Create venv, directories"
echo "  2. 🐍 Python → Install basic libraries"
echo "  3. 🎤 Whisper → Install OpenAI Whisper"
echo "  4. 🧠 Ollama → Install Homebrew (if needed) → Install Ollama → Download model"
echo "  5. ✅ Test → Verify everything works"
echo ""
echo "To test: cd app && npm start"