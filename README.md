<div align="center">
  <img src="website/public/stenoai-logo-512.svg" alt="StenoAI Logo" width="120" height="120">

  # StenoAI

  *Your very own stenographer for every meeting*
</div>

<p align="center">
  <a href="https://github.com/ruzin/stenoai/actions/workflows/build-release.yml"><img src="https://img.shields.io/github/actions/workflow/status/ruzin/stenoai/build-release.yml?branch=main&style=for-the-badge" alt="Build"></a>
  <a href="https://github.com/ruzin/stenoai/releases"><img src="https://img.shields.io/github/v/release/ruzin/stenoai?style=for-the-badge" alt="Release"></a>
  <a href="https://discord.gg/DZ6vcQnxxu"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License"></a>
  <img src="https://img.shields.io/badge/Platform-macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS">
</p>

<p align="center">AI-powered meeting intelligence that runs entirely on your device, your private data never leaves anywhere. Record, transcribe, summarize, and query your meetings using local AI models. Perfect for healthcare, legal and finance professionals with confidential data needs.</p>

<p align="center"><sub>Trusted by users at <b>AWS</b>, <b>Deliveroo</b> & <b>Tesco</b>.</sub></p>

<div align="center">
  <img src="website/public/app-demo-3.png" alt="StenoAI Interface" width="800">

  <br>

  [![Twitter Follow](https://img.shields.io/twitter/follow/ruzin?style=social)](https://x.com/ruzin_saleem)
</div>

<p align="center"><sub><i>Disclaimer: This is an independent open-source project for meeting-notes productivity and is not affiliated with, endorsed by, or associated with any similarly named company.</i></sub></p>

## 📢 What's New

- **2026-02-19** 🎧 System audio capture — Record both sides of virtual meetings, even with headphones on
- **2026-02-19** 📅 Outlook Calendar integration — Connect Outlook as an alternative to Google Calendar
- **2026-02-19** 🖥️ macOS system tray — Menu bar icon with quick actions; window hides to tray on close
- **2026-02-15** 📅 Google Calendar integration — Auto-name recordings from your upcoming meetings, view today's schedule in the sidebar
- **2026-02-15** 🎨 Sidebar UX redesign — Collapsible sidebar with calendar panel and streamlined navigation
- **2026-02-15** 💾 Custom save location — Choose where StenoAI stores recordings, transcripts, and summaries
- **2026-02-15** 📁 Compact meeting list — Streamlined meeting line items with folder organization

## Features

- **Local transcription** using whisper.cpp
- **AI summarization** with Ollama models
- **System audio capture** - Record mic + system audio simultaneously for virtual meetings with headphones
- **Ask Steno** - Query your meetings with natural language questions
- **Multiple AI models** - Choose from 4 models optimized for different use cases
- **Privacy-first** - 100% local processing, your data never leaves your device
- **macOS desktop app** with intuitive interface

Have questions or suggestions? [Join our Discord](https://discord.gg/DZ6vcQnxxu) to chat with the community.

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

### David vs Goliath: StenoAI Local Models Closing the Gap with Claude Sonnet 4.6

#### YouTube Video Summary Challenge (11m 36s): [High-Speed Rail Systems Around the World](https://www.youtube.com/watch?v=9wJCltuawSs)

**Scoring Criteria**
- **Overall (10):** Holistic quality score
- **Content Accuracy (10):** Numerical and factual correctness
- **Completeness (10):** Coverage of major video points
- **No Hallucination (10):** No fabricated participants, action items, or invented details

| Rank | Model              | Overall (10) | Content Accuracy (10) | Completeness (10) | No Hallucination (10) | Notes |
|------|-------------------|--------------|------------------------|-------------------|-----------------------|-------|
| 1    | Claude Sonnet 4.6 | 9.8          | 9.8                    | 9.5               | 10.0                  | Most precise; strongest quantitative retention; perfect framing |
| 2    | Claude Haiku      | 9.5          | 9.5                    | 9.0               | 10.0                  | Very strong; slightly less detailed than Sonnet |
| 3    | DeepSeek R1:8B    | 8.8          | 9.0                    | 8.0               | 8.5                   | Broad coverage; fewer numerical details |
| 4    | Qwen:8B           | 8.5          | 9.0                    | 7.5               | 8.5                   | Accurate but more compressed |
| 5    | GPT-4.1           | 8.3          | 9.0                    | 8.0               | 6.5                   | Accurate but meeting framing invented |
| 6    | GPT-4o Mini       | 8.0          | 8.5                    | 7.5               | 6.0                   | Invented meeting framing and participants |
| 7    | Gemma 4B          | 7.0          | 8.5                    | 7.0               | 3.5                   | Fabricated participants and action items |

## Future Roadmap

### Enhanced Features
- Custom summarization templates
- Speaker Diarisation

### StenoAI Med
- HIPAA compliance for healthcare workflows
- EHR integration for medical notes

## Installation

Download the latest release for your Mac:

- [Apple Silicon (M1-M5)](https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg)
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

You can run it locally as well (see below) if you don't want to install a DMG.

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

This project is licensed under the [MIT License](LICENSE).
