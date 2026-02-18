# Claude Code Instructions

This file contains instructions for Claude Code to help with this meeting transcription POC project. Do not use excessive emojis anywhere.

## Project Overview
This is a local meeting transcription service:

### Desktop App
- sounddevice for audio recording
- whisper.cpp (via pywhispercpp) for transcription
- Bundled Ollama for LLM summarization
- Electron GUI with PyInstaller-bundled Python backend

## Project Structure
```
stenoai/
├── app/                  # Electron desktop app
├── src/                  # Python backend
│   ├── audio_recorder.py      # Local audio recording
│   ├── transcriber.py         # whisper.cpp transcription
│   ├── summarizer.py          # Ollama LLM processing
│   ├── ollama_manager.py      # Bundled Ollama management
│   ├── config.py              # User settings & model selection
│   └── models.py              # Data models
├── bin/                  # Bundled binaries (Ollama, ffmpeg)
├── dist/                 # PyInstaller build output
├── scripts/              # Build scripts
├── simple_recorder.py    # CLI interface (entry point)
├── stenoai.spec          # PyInstaller configuration
├── website/              # Marketing site
├── recordings/           # Local audio files
├── transcripts/          # Local transcripts
└── output/              # Processed summaries
```

## Development Commands

### CLI Commands (via bundled backend: `dist/stenoai/stenoai`)
- Check status: `stenoai status`
- Setup check: `stenoai setup-check`
- Download whisper model: `stenoai download-whisper-model`
- Start recording: `stenoai start --name meeting_name`
- Stop recording: `stenoai stop`
- Transcribe audio: `stenoai transcribe filename.wav`
- Summarize transcript: `stenoai summarize filename.txt`
- Full pipeline: `stenoai pipeline filename.wav`
- List failed summaries: `stenoai list_failed`
- Reprocess failed summary: `stenoai reprocess path/to/summary.json`

### Desktop App Commands
- Start app: `cd app && npm start`
- Build app: `cd app && npm run build`
- Build backend: `source venv/bin/activate && pyinstaller stenoai.spec --noconfirm`

## Setup Instructions (Development)
1. Create virtual environment: `python -m venv venv`
2. Activate virtual environment: `source venv/bin/activate`
3. Install dependencies: `pip install -r requirements.txt`
4. Download bundled binaries: `./scripts/download-ollama.sh`
5. Build the backend: `pyinstaller stenoai.spec --noconfirm`
6. Start the app: `cd app && npm install && npm start`

Note: Ollama is bundled in `bin/` - no system installation needed.

## Testing Commands
- Test basic functionality: `dist/stenoai/stenoai status`
- Test setup: `dist/stenoai/stenoai setup-check`
- Test audio devices: `python -c "import sounddevice; print(sounddevice.query_devices())"`

## Dependencies
- sounddevice>=0.4.6 (audio recording)
- numpy>=1.24.0 (audio processing)
- pywhispercpp (whisper.cpp transcription - preferred, faster)
- ollama>=0.1.7 (LLM client)
- click>=8.1.0 (CLI interface)
- pydantic>=2.5.0 (data validation)
- pyinstaller (bundling)

## Brand Colors
StenoAI logo gradient (used in website logo SVG and app header):
- Indigo: `#6366f1`
- Sky blue: `#0ea5e9`
- Cyan: `#06b6d4`
- CSS: `linear-gradient(135deg, #6366f1, #0ea5e9, #06b6d4)`

App UI accent: `--accent-primary: #818cf8` (lighter indigo, used for focus states, active tabs, toggles)

## Production Readiness
This app ships as a signed DMG to real users. Before considering any change complete:
- **Packaged app test**: Dev mode (`npm start`) is not sufficient. Always rebuild the DMG (`npm run build`) and test the installed app from `/Applications`.
- **Cold start test**: Kill all background processes (`pkill -f ollama`) and launch the app fresh. The full pipeline (record, transcribe, summarize) must work with no pre-existing services running.
- **No shelling out to bundled binaries for operations that have an HTTP/library API**. macOS SIP + Electron hardened runtime strips `DYLD_LIBRARY_PATH` from child processes. Use the `ollama` Python package (HTTP API) for model operations, not `subprocess.run([ollama_path, ...])`. The only acceptable use of the Ollama binary is `ollama serve` (starting the server), which is covered by the `com.apple.security.cs.allow-dyld-environment-variables` entitlement.
- **No bare `exit()` in Python code**. PyInstaller bundles don't have `exit` as a builtin. Always use `sys.exit()`.

## Code Style
- Follow PEP 8 guidelines
- Use type hints where appropriate
- Write docstrings for functions and classes
- Use logging for debugging and monitoring

## Git Workflow
- Always create a branch for changes unless explicitly told otherwise
- Never commit directly to `main`
- Before creating a PR, run a self-review of the full branch diff (`git diff main...HEAD`):
  - Review backend code for security issues, error handling gaps, edge cases, and best practices
  - Review frontend code for layout bugs, CSS consistency, accessibility, and polish
  - Use the frontend-design skill for UI-related changes
  - Categorize findings by severity (critical/medium/low) and fix critical issues before merging

## Git Commit Guidelines
- Do NOT include "🤖 Generated with Claude Code" attribution in commit messages
- Do NOT include "Co-Authored-By: Claude <noreply@anthropic.com>" in commit messages
- Keep commit messages concise and focused on what changed
- Use conventional commit format when appropriate (feat:, fix:, docs:, etc.)

## README "What's New" Section
The README has a "What's New" table that should be updated every ~2 weeks. When asked to update it (or when shipping a notable feature):
1. Check recently merged PRs: `gh pr list --state merged --limit 10`
2. For each notable PR, add a row to the table with the merge date and a one-sentence summary
3. Keep "Coming soon" items for features that are planned but not yet shipped
4. Remove entries older than ~2 months to keep the section fresh
5. Most recent entries go at the top of the table

## Session Logging
When the user says "log session" or similar (e.g., "update session log", "document this session"):
1. Update SESSION_LOG.md in the root directory with the current session details
2. Include: date/time, summary of work, key decisions, files modified, issues resolved, next steps
3. REPLACE or CONDENSE previous session entries to keep the file concise (max 2-3 most recent sessions)
4. Keep only relevant context for the next Claude session - remove outdated or completed work details
5. Format with clear headers and organized sections