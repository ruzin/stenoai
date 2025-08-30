# StenoAI - Meeting Transcription & Analysis

A comprehensive meeting transcription service with desktop UI and intelligent summarization. Records audio, transcribes speech, and generates structured meeting summaries with action items and decisions.

## Features

- **🎙️ Real-time Recording**: Desktop app with live recording timer
- **📝 Speech Transcription**: Local transcription using OpenAI Whisper  
- **🧠 AI Summarization**: Intelligent analysis using local Ollama models
- **📊 Structured Output**: JSON format with participants, actions, and decisions
- **🖥️ Desktop Interface**: Modern Electron app with meeting management
- **⚡ Queue Processing**: Sequential handling of multiple recordings
- **🔍 Smart Search**: Filter meetings by content, names, or topics

## Architecture

```mermaid
graph TD
    A[Electron Desktop App] --> B[Python Backend]
    B --> C[Audio Recorder]
    B --> D[Whisper Transcriber]
    B --> E[Ollama Summarizer]
    
    C --> F[recordings/*.wav]
    D --> G[transcripts/*.txt]
    E --> H[output/*_summary.json]
    
    I[User] --> A
    A --> J[Recording Queue]
    J --> B
    
    K[Processing Queue] --> L[Sequential Jobs]
    L --> M[Auto UI Refresh]
    
    subgraph "Data Flow"
        N[Record Audio] --> O[Transcribe Speech]
        O --> P[Generate Summary]
        P --> Q[Save Results]
    end
end
```

### Components

- **Frontend (Electron)**: Modern desktop interface with recording controls
- **Backend (Python)**: Audio processing, transcription, and AI summarization
- **Audio Pipeline**: sounddevice → Whisper → Ollama → structured JSON
- **Queue System**: Sequential processing to prevent conflicts
- **Storage**: Local files for recordings, transcripts, and summaries

## Prerequisites

1. **Node.js**: Required for Electron frontend
2. **Python 3.8+**: Required for backend processing
3. **Ollama**: Local LLM service for summarization
   ```bash
   # Install Ollama (macOS)
   brew install ollama
   
   # Pull recommended model
   ollama pull llama3.2:3b
   ```

## Quick Start

1. **Setup Environment**:
   ```bash
   # Create Python virtual environment
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   
   # Install Python dependencies
   pip install -r requirements.txt
   pip install -e .
   ```

2. **Start Application**:
   ```bash
   # Start Ollama service (in separate terminal)
   ollama serve
   
   # Launch desktop app
   npx electron app/main.js
   ```

## Distribution

### Building DMG for macOS

1. **Install dependencies**:
   ```bash
   cd app
   npm install
   ```

2. **Build DMG**:
   ```bash
   npm run dist
   ```

3. **Outputs**:
   - `app/dist/StenoAI-1.0.0.dmg` (Intel)
   - `app/dist/StenoAI-1.0.0-arm64.dmg` (Apple Silicon)

### Requirements for End Users

Users need to install Python dependencies locally:
```bash
# Required: Python 3.8+ and pip
pip install sounddevice numpy openai-whisper ollama click pydantic

# Required: Ollama service
brew install ollama
ollama pull llama3.2:3b
```

## Usage

### Desktop Application

1. **Recording Meetings**:
   - Enter meeting name in input field
   - Click "Start Recording" 
   - Live timer shows elapsed time
   - Click "Stop Recording" when done
   - Automatic transcription and summarization

2. **Managing Meetings**:
   - Browse meetings in left sidebar
   - Search meetings by content
   - View detailed summaries and transcripts
   - Delete meetings with confirmation

3. **Queue System**:
   - Multiple recordings process sequentially
   - No jobs lost or conflicts
   - UI auto-refreshes when processing completes

### CLI Commands (Legacy)

```bash
# Quick test
python simple_recorder.py record 10 "Test Meeting"

# Check status
python simple_recorder.py status

# List meetings
python simple_recorder.py list-meetings

# Process existing audio
python simple_recorder.py process audio.wav --name "Meeting Name"
```

### Models & Performance

**Whisper Models** (transcription):
- `base`: Recommended balance of speed/accuracy
- `small`: Better accuracy for complex audio
- `medium`: High accuracy for important meetings

**Ollama Models** (summarization):
- `llama3.2:3b`: Fast, good quality (recommended)
- `llama3.1:8b`: Higher quality, slower
- `llama2`: Fallback option

## Output Structure

Each meeting generates structured JSON with comprehensive analysis:

```json
{
  "session_info": {
    "name": "Meeting Name",
    "processed_at": "2025-08-30T12:46:44.672449",
    "duration_seconds": 156,
    "transcript_file": "transcripts/meeting_transcript.txt",
    "summary_file": "output/meeting_summary.json"
  },
  "summary": "Comprehensive meeting overview with context and outcomes",
  "key_points": [
    "Important decision or insight from the meeting"
  ],
  "action_items": [
    "Specific actionable task with clear ownership"
  ],
  "transcript": "Full verbatim meeting transcript"
}
```

## Project Structure

```
steno-poc/
├── app/                    # Electron frontend
│   ├── main.js            # Main process & IPC handlers
│   ├── index.html         # UI interface
│   └── package.json       # Electron dependencies
├── src/                   # Python backend
│   ├── audio_recorder.py  # Audio capture (sounddevice)
│   ├── transcriber.py     # Speech-to-text (Whisper)
│   ├── summarizer.py      # AI analysis (Ollama)
│   └── models.py          # Data structures
├── simple_recorder.py     # Backend CLI interface
├── recordings/            # Audio files (.wav)
├── transcripts/           # Text transcripts (.txt) 
├── output/                # Meeting summaries (.json)
├── requirements.txt       # Python dependencies
└── README.md
```

## Technical Details

### Processing Pipeline
1. **Audio Capture**: Real-time recording with sounddevice
2. **Speech Recognition**: Whisper model transcription
3. **AI Analysis**: Ollama LLM generates structured summaries
4. **Data Storage**: JSON files with meeting metadata

### Queue System
- Sequential processing prevents Ollama conflicts
- Automatic retry logic for connection failures
- Real-time UI updates on completion

### Duration Tracking
- Live recording timer in UI
- Accurate WAV file duration analysis
- Formatted display (25s, 1m 30s, 1h 5m)

## TODO - DMG Distribution Improvements

### Microphone Permissions
- [ ] Add proper macOS microphone permission handling
- [ ] Use Electron's `systemPreferences.askForMediaAccess('microphone')`
- [ ] Add clear error messages for permission denied states
- [ ] Add Info.plist entry with `NSMicrophoneUsageDescription`
- [ ] Test permission flow with `tccutil reset Microphone`

### Security & Privacy
- [ ] Add code signing for DMG distribution
- [ ] Add notarization for macOS Gatekeeper
- [ ] Implement secure file storage permissions
- [ ] Add privacy policy for data handling

### Installation Robustness
- [ ] Handle Homebrew installation failures gracefully
- [ ] Add fallback Ollama installation methods
- [ ] Improve setup progress indicators
- [ ] Add manual setup instructions as fallback

### User Experience
- [ ] Add onboarding tutorial for first-time users
- [ ] Improve error messages and recovery suggestions
- [ ] Add keyboard shortcuts for common actions
- [ ] Implement auto-updater for future releases

## Troubleshooting

### Audio Issues
- **No microphone detected**: Check system permissions
- **Low audio quality**: Verify microphone settings
- **Test audio devices**: `python -c "import sounddevice; print(sounddevice.query_devices())"`

### Ollama Issues
- **Service not running**: `ollama serve`
- **Model not available**: `ollama pull llama3.2:3b`
- **Connection errors**: Check logs for retry attempts

### Performance
- **Slow transcription**: Use smaller Whisper model
- **Slow summarization**: Use lighter Ollama model
- **UI not refreshing**: Check processing queue logs