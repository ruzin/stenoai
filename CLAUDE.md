# Claude Code Instructions

This file contains instructions for Claude Code to help with this meeting transcription POC project.

## Project Overview
This is a comprehensive meeting transcription service with two modes:

### Local POC (Original)
- sounddevice for audio recording
- OpenAI Whisper for transcription
- Ollama for LLM summarization
- Click for CLI interface

### Teams Integration (New)
- Microsoft Graph API for calendar monitoring
- Bot Framework for automated meeting joining
- Teams transcript download and processing
- Integration with existing LLM pipeline

## Project Structure
```
steno-poc/
├── src/
│   ├── audio_recorder.py      # Local audio recording
│   ├── transcriber.py         # Whisper transcription
│   ├── summarizer.py          # Ollama LLM processing
│   ├── models.py             # Data models
│   └── teams/                # Teams integration
│       ├── auth.py           # Azure authentication
│       ├── graph_client.py   # Microsoft Graph API
│       └── calendar_monitor.py # Meeting detection
├── main.py                   # Local POC CLI
├── teams_main.py            # Teams integration CLI
├── config/                  # Configuration files
├── recordings/              # Local audio files
├── transcripts/             # Local transcripts
└── output/                  # Processed summaries
```

## Development Commands

### Local POC Commands
- Check status: `python main.py status`
- Start recording: `python main.py start --output meeting_name`
- Stop recording: `python main.py stop`
- Transcribe audio: `python main.py transcribe filename.wav`
- Summarize transcript: `python main.py summarize filename.txt`
- Full pipeline: `python main.py pipeline filename.wav`

### Teams Integration Commands
- Setup guide: `python teams_main.py setup`
- Install dependencies: `python teams_main.py install-deps`
- Test authentication: `python teams_main.py test-auth`
- Test Graph API: `python teams_main.py test-graph`
- Monitor calendar: `python teams_main.py monitor --duration 300`
- List meetings: `python teams_main.py list-meetings`
- Check status: `python teams_main.py status`

## Setup Instructions
1. Install Ollama: `brew install ollama` (macOS)
2. Pull model: `ollama pull llama2`
3. Start Ollama: `ollama serve`
4. Create virtual environment: `python -m venv venv`
5. Activate virtual environment: `source venv/bin/activate` (Linux/Mac) or `venv\Scripts\activate` (Windows)
6. Install dependencies: `pip install -r requirements.txt`
7. Install package: `pip install -e .`

## Testing Commands
- Test basic functionality: `python main.py status`
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