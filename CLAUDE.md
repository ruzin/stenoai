# Claude Code Instructions

This file contains instructions for Claude Code to help with this meeting transcription POC project. Do not use excessive emojis anywhere.

## Project Overview
This is a local meeting transcription service:

### Desktop App
- sounddevice for audio recording
- OpenAI Whisper for transcription
- Ollama for LLM summarization
- Electron GUI with CLI backend

## Project Structure
```
steno-poc/
├── app/                  # Electron desktop app
├── src/                  # Python backend
│   ├── audio_recorder.py      # Local audio recording
│   ├── transcriber.py         # Whisper transcription
│   ├── summarizer.py          # Ollama LLM processing
│   └── models.py             # Data models
├── simple_recorder.py    # CLI interface
├── website/              # Marketing site
├── recordings/           # Local audio files
├── transcripts/          # Local transcripts
└── output/              # Processed summaries
```

## Development Commands

### CLI Commands
- Check status: `python simple_recorder.py status`
- Start recording: `python simple_recorder.py start --name meeting_name`
- Stop recording: `python simple_recorder.py stop`
- Transcribe audio: `python simple_recorder.py transcribe filename.wav`
- Summarize transcript: `python simple_recorder.py summarize filename.txt`
- Full pipeline: `python simple_recorder.py pipeline filename.wav`
- List failed summaries: `python simple_recorder.py list_failed`
- Reprocess failed summary: `python simple_recorder.py reprocess path/to/summary.json`

### Desktop App Commands
- Start app: `cd app && npm start`
- Build app: `cd app && npm run build`

## Setup Instructions
1. Install Ollama: `brew install ollama` (macOS)
2. Pull model: `ollama pull llama2`
3. Start Ollama: `ollama serve`
4. Create virtual environment: `python -m venv venv`
5. Activate virtual environment: `source venv/bin/activate` (Linux/Mac) or `venv\Scripts\activate` (Windows)
6. Install dependencies: `pip install -r requirements.txt`
7. Install package: `pip install -e .`

## Testing Commands
- Test basic functionality: `python simple_recorder.py status`
- Test audio devices: `python -c "import sounddevice; print(sounddevice.query_devices())"`
- Test Ollama: `ollama list`

## Dependencies
- sounddevice>=0.4.6 (audio recording)
- numpy>=1.24.0 (audio processing)
- openai-whisper>=20230918 (transcription)
- ollama>=0.1.7 (LLM summarization)
- click>=8.1.0 (CLI interface)
- pydantic>=2.5.0 (data validation)

## Code Style
- Follow PEP 8 guidelines
- Use type hints where appropriate
- Write docstrings for functions and classes
- Use logging for debugging and monitoring

## Git Commit Guidelines
- Do NOT include "🤖 Generated with Claude Code" attribution in commit messages
- Do NOT include "Co-Authored-By: Claude <noreply@anthropic.com>" in commit messages
- Keep commit messages concise and focused on what changed
- Use conventional commit format when appropriate (feat:, fix:, docs:, etc.)

## Session Logging
When the user says "log session" or similar (e.g., "update session log", "document this session"):
1. Update SESSION_LOG.md in the root directory with the current session details
2. Include: date/time, summary of work, key decisions, files modified, issues resolved, next steps
3. REPLACE or CONDENSE previous session entries to keep the file concise (max 2-3 most recent sessions)
4. Keep only relevant context for the next Claude session - remove outdated or completed work details
5. Format with clear headers and organized sections