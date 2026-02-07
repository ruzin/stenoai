<div align="center">
  <img src="website/public/stenoai-logo-512.svg" alt="StenoAI Logo" width="120" height="120">

  # StenoAI

  *Your very own stenographer for every meeting*
</div>

<p align="center">
  <a href="https://github.com/ruzin/stenoai/actions/workflows/build-release.yml"><img src="https://img.shields.io/github/actions/workflow/status/ruzin/stenoai/build-release.yml?branch=main&style=for-the-badge" alt="Build"></a>
  <a href="https://github.com/ruzin/stenoai/releases"><img src="https://img.shields.io/github/v/release/ruzin/stenoai?style=for-the-badge" alt="Release"></a>
  <a href="https://discord.gg/EHxvAdKf"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-CC%20BY--NC%204.0-blue?style=for-the-badge" alt="License"></a>
  <img src="https://img.shields.io/badge/Platform-macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS">
</p>

AI-powered meeting intelligence that runs entirely on your device, your private data never leaves anywhere. Record, transcribe, summarize, and query your meetings using local AI models. Privacy-first with zero cloud dependencies.

<div align="center">
  <img src="website/public/app-demo.png" alt="StenoAI Interface" width="600">

  <br>

  [![Twitter Follow](https://img.shields.io/twitter/follow/ruzin?style=social)](https://x.com/ruzin_saleem)
</div>

<p align="center"><sub><i>Disclaimer: This is an independent open-source project for meeting-notes productivity and is not affiliated with, endorsed by, or associated with any similarly named company.</i></sub></p>

## Features

- **Local transcription** using whisper.cpp
- **AI summarization** with Ollama models
- **Ask Steno** - Query your meetings with natural language questions
- **Multiple AI models** - Choose from 4 models optimized for different use cases
- **Privacy-first** - 100% local processing, your data never leaves your device
- **macOS desktop app** with intuitive interface

Have questions or suggestions? [Join our Discord](https://discord.gg/EHxvAdKf) to chat with the community.

## Models & Performance

**Transcription Models** (Whisper):
- `small`: Default model - good accuracy and speed on Apple Silicon **(default)**
- `base`: Faster but lower accuracy for basic meetings
- `medium`: High accuracy for important meetings (slower)

**Summarization Models** (Ollama):
- `llama3.2:3b` (2GB): Fastest option for quick meetings **(default)**
- `gemma3:4b` (2.5GB): Lightweight and efficient
- `qwen3:8b` (4.7GB): Excellent at structured output and action items
- `deepseek-r1:8b` (4.7GB): Strong reasoning and analysis capabilities

**Switching Models:**
- Click the 🧠 AI Settings icon in the app
- Select your preferred model
- Models download automatically when selected
- ⚠️ Note: Downloads will pause any active summarization

## Future Roadmap

### Enhanced Features
- Custom summarization templates
- Speaker Diarisation

## Installation

Download the latest release for your Mac:

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg)
- [Intel Macs](https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-x64.dmg) Performance on Intel Macs is limited due to lack of dedicated AI inference capabilities on these older chips.

### Installing on macOS

1. **Download and open the DMG file**
2. **Drag the app to Applications**
3. **When you first launch the app**, macOS may show a security warning
4. **To fix this warning:**
   - Go to **System Settings > Privacy & Security** and click **"Open Anyway"**

   **Alternatively:**
   - Right-click StenoAI in Applications and select **"Open"**
   - Or run in Terminal: `xattr -cr /Applications/StenoAI.app`
5. **The app will work normally on subsequent launches**

You can run it locally as well (see below) if you dont want to install a dmg.

## Local Development/Use Locally

### Prerequisites
- Python 3.9+
- Node.js 18+

### Setup
```bash
git clone https://github.com/ruzin/stenoai.git
cd stenoai

# Backend setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Download bundled binaries (Ollama, ffmpeg)
./scripts/download-ollama.sh

# Build the Python backend
pip install pyinstaller
pyinstaller stenoai.spec --noconfirm

# Frontend
cd app
npm install
npm start
```

Note: Ollama and ffmpeg are bundled - no system installation needed. The setup wizard in the app will download the required AI models automatically.

### Build
```bash
cd app
npm run build
```

## Release Process

### Simple Release Commands
```bash
cd app

# Patch release (bug fixes): 0.0.5 → 0.0.6
npm version patch
git add package.json package-lock.json
git commit -m "Version bump to $(node -p "require('./package.json').version")"
git push
git tag v$(node -p "require('./package.json').version")
git push origin v$(node -p "require('./package.json').version")

# Minor release (new features): 0.0.6 → 0.1.0
npm version minor
git add package.json package-lock.json
git commit -m "Version bump to $(node -p "require('./package.json').version")"
git push
git tag v$(node -p "require('./package.json').version")
git push origin v$(node -p "require('./package.json').version")

# Major release (breaking changes): 0.0.6 → 1.0.0
npm version major
git add package.json package-lock.json
git commit -m "Version bump to $(node -p "require('./package.json').version")"
git push
git tag v$(node -p "require('./package.json').version")
git push origin v$(node -p "require('./package.json').version")
```

**What happens:**
1. `npm version` updates package.json and package-lock.json locally
2. Manual commit ensures version changes are saved to git
3. `git push` sends the version commit to GitHub
4. `git tag` creates the version tag locally
5. `git push origin tag` triggers GitHub Actions workflow
6. Workflow automatically builds DMGs for Intel & Apple Silicon
7. Creates GitHub release with downloadable assets

## Project Structure

```
stenoai/
├── app/                  # Electron desktop app
├── src/                  # Python backend
├── website/              # Marketing site
├── recordings/           # Audio files
├── transcripts/          # Text output
└── output/              # Summaries
```

## Troubleshooting

### Debug Logs

StenoAI includes a built-in debug panel for troubleshooting issues:

**In-App Debug Panel:**
1. Launch StenoAI
2. Click the 🔨 hammer icon (next to settings)
3. The debug panel shows real-time logs of all operations

**Terminal Logging (Advanced):**
For detailed system-level logs, run the app from Terminal:
```bash
# Launch StenoAI with full logging
/Applications/StenoAI.app/Contents/MacOS/StenoAI
```

This displays comprehensive logs including:
- Python subprocess output
- Whisper transcription details  
- Ollama API communication
- HTTP requests and responses
- Error stack traces
- Performance timing

**System Console Logs:**
For system-level debugging:
```bash
# View recent StenoAI-related logs
log show --last 10m --predicate 'process CONTAINS "StenoAI" OR eventMessage CONTAINS "ollama"' --info

# Monitor live logs
log stream --predicate 'eventMessage CONTAINS "ollama" OR process CONTAINS "StenoAI"' --level info
```

**Common Issues:**
- **Recording stops early**: Check microphone permissions and available disk space
- **"Processing failed"**: Usually Ollama service or model issues - check terminal logs
- **Empty transcripts**: Whisper couldn't detect speech - verify audio input levels
- **Slow processing**: Normal for longer recordings - Ollama processing is CPU-intensive especially on older intel Macs

### Logs Location
- **User Data**: `~/Library/Application Support/stenoai/`
- **Recordings**: `~/Library/Application Support/stenoai/recordings/`
- **Transcripts**: `~/Library/Application Support/stenoai/transcripts/`
- **Summaries**: `~/Library/Application Support/stenoai/output/`

## License

**StenoAI is free for personal, non-commercial use.**

CC BY-NC 4.0 (Creative Commons Attribution-NonCommercial 4.0 International)
