# StenoAI

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
ollama pull qwen2.5:1.5b

# Frontend
cd app
npm install
npm start
```

### Build
```bash
cd app
npm run dist
```

## Models & Performance

**Transcription Models** (Whisper):
- `base`: Fast, good for most meetings
- `small`: Better accuracy for complex audio
- `medium`: High accuracy for important meetings

**Summarization Models** (Ollama):
- `qwen2.5:1.5b`: Fast, efficient (recommended)
- `llama3.2:3b`: Good quality, moderate speed
- `llama3.1:8b`: High quality, slower processing

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
- Real-time transcription during meetings
- Multi-language support
- Custom summarization templates
- Meeting analytics and insights

## License

MIT