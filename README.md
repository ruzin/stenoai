<div align="center">
  <img src="website/public/stenoai-logo-512.svg" alt="StenoAI Logo" width="120" height="120">
  
  # StenoAI
</div>

AI-powered meeting transcription and summarization that runs entirely on your device using small lanuage model locally hosted or Bring you Own AI (OpenAI or Anthropic) API keys. Privacy first approach & zero service costs.

<div align="center">
  <img src="website/public/app-screenshot.png" alt="StenoAI Interface" width="600">
</div>

## Features

- **Local transcription** using OpenAI Whisper
- **AI summarization** with Ollama models
- **Privacy-first** - no cloud dependencies
- **macOS desktop app** with intuitive interface

## Installation

Download the latest release for your Mac:

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg)
- [Intel Macs](https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-intel.dmg)

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

## Development

### Prerequisites
- Python 3.8+
- Node.js 18+
- Homebrew

### Setup
```bash
git clone https://github.com/ruzin/stenoai.git
cd stenoai

# Backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Install Ollama
brew install ollama
ollama serve &
ollama pull llama3.2:3b

# Frontend
cd app
npm install
npm start
```

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


## Models & Performance

**Transcription Models** (Whisper):
- `base`: Fast, good for most meetings
- `small`: Better accuracy for complex audio
- `medium`: High accuracy for important meetings

**Summarization Models** (Ollama):
- `llama3.2:3b`: Good quality, moderate speed (recommended)

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

## Future Roadmap

### Bring Your Own AI API
- Support for OpenAI GPT models via API key
- Anthropic Claude integration for summarization
- Azure OpenAI service compatibility
- User choice between local and cloud processing

### Enhanced Features
- Multi-language support
- Custom summarization templates
- Meeting analytics and insights

## License

MIT