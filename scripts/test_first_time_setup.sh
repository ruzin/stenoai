#!/bin/bash

# Script to simulate first-time user experience by removing dependencies
# This lets us test the setup wizard

echo "🧪 Simulating first-time user setup..."

# Remove Whisper to test installation
if [ -d "venv" ]; then
    echo "📦 Removing Whisper to test installation..."
    venv/bin/pip uninstall -y openai-whisper
    echo "✅ Whisper removed"
fi

# Remove directories to test creation
echo "📁 Removing directories to test creation..."
rm -rf recordings transcripts output

echo "🎯 Setup test ready! Now run the Electron app to test first-time setup."
echo "Expected behavior:"
echo "  1. App should detect missing dependencies"
echo "  2. Show setup wizard automatically"
echo "  3. Guide user through installation process"
echo "  4. Create all required directories"
echo "  5. Install Whisper and other dependencies"
echo ""
echo "To run app: cd app && npm start"