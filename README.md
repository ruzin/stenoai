<div align="center">
  <img src="website/public/stenoai-logo.svg" alt="StenoAI Logo" width="120" height="120">
  
  # StenoAI
</div>

AI-powered meeting transcription and summarization that runs entirely on your device.

## Features

- **Local transcription** using OpenAI Whisper
- **AI summarization** with Ollama models
- **Privacy-first** - no cloud dependencies
- **macOS desktop app** with intuitive interface

## Installation

Download the latest release for your Mac:

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg)
- [Intel Macs](https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-intel.dmg)

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

# Patch release (bug fixes): 0.0.4 → 0.0.5
npm version patch && git push && git push --tags

# Minor release (new features): 0.0.4 → 0.1.0
npm version minor && git push && git push --tags

# Major release (breaking changes): 0.0.4 → 1.0.0
npm version major && git push && git push --tags
```

**What happens:**
1. `npm version` updates package.json, creates commit & git tag
2. `git push` sends the version commit to GitHub
3. `git push --tags` triggers GitHub Actions workflow
4. Workflow automatically builds DMGs for Intel & Apple Silicon
5. Creates GitHub release with downloadable assets

**Example release workflow:**
```bash
cd app
npm version patch    # Creates commit "0.0.5" and tag "v0.0.5"
git push            # Push the version commit
git push --tags     # Trigger release workflow
# ✅ Release appears at: github.com/ruzin/stenoai/releases
```

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