<div align="center">
  <img src="website/public/dragonfly-logo-512.png" alt="Steno Logo" width="120" height="120">

  # Steno

  *Your private stenographer*
</div>

<p align="center">
  <a href="https://github.com/ruzin/stenoai/actions/workflows/build-release.yml"><img src="https://img.shields.io/github/actions/workflow/status/ruzin/stenoai/build-release.yml?branch=main&style=for-the-badge" alt="Build"></a>
  <a href="https://github.com/ruzin/stenoai/releases"><img src="https://img.shields.io/github/v/release/ruzin/stenoai?style=for-the-badge" alt="Release"></a>
  <a href="https://discord.gg/DZ6vcQnxxu"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License"></a>
  <img src="https://img.shields.io/badge/Platform-macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS">
  <a href="#sponsors"><img src="https://img.shields.io/badge/Sponsors-%E2%9D%A4-EA4AAA?style=for-the-badge" alt="Sponsors"></a>
</p>

<p align="center">Steno is the AI powered intelligence layer for all your confidential conversations, your private data never leaves anywhere. Record, transcribe, summarize, and query your meetings using local AI models. Perfect for government, defence, legal and C-suite professionals with confidential data needs.</p>

<p align="center"><sub>Trusted by users at <b>AWS</b>, <b>Deliveroo</b>, <b>Tesco</b>, <b>Hashicorp</b>, <b>Rutgers</b> & <b>European Union</b>.</sub></p>

<div align="center">
  <picture>
    <source srcset="website/public/demo.gif" type="image/gif">
    <img src="website/public/readme.png" alt="Steno" width="800">
  </picture>

  <br>

  [![Twitter Follow](https://img.shields.io/twitter/follow/ruzin?style=social)](https://x.com/ruzin_saleem)
</div>

<p align="center"><sub>Sponsored by <b>Gitlab Founder's Open Core Ventures</b>.</sub></p>

<p align="center"><sub><i>Disclaimer: This is an independent open-source project for meeting-notes productivity and is not affiliated with, endorsed by, or associated with any similarly named company.</i></sub></p>

## Sponsors

### Recall.ai - API for desktop recording

If you're looking for a hosted desktop recording API, consider checking out [Recall.ai](https://www.recall.ai/product/desktop-recording-sdk?utm_source=github&utm_medium=sponsorship&utm_campaign=ruzin-stenoai), an API that records Zoom, Google Meet, Microsoft Teams, in-person meetings, and more.

## 📢 What's New
- **2026-06-07** 🎙️ Live transcription with Parakeet TDT v3 — Real-time on-screen transcripts during recording via Apple Silicon's MLX backend. Sentences appear as you speak in a Granola-style chat-bubble view; speakers are attributed to You vs Others in real time.
- **2026-06-07** 🎛️ Choose your transcription engine — Settings → Transcribe now offers Parakeet (default, live + post-stop, 25 European languages) or Whisper (post-stop only, 99 languages incl. Chinese, Japanese, Arabic, Hindi). Existing Whisper users keep Whisper; new installs default to Parakeet.
- **2026-06-07** 🛟 Crash recovery for stuck recordings — If Steno is force-quit mid-recording, the orphan recorder subprocess is detected and reaped on the next launch so the mic isn't left hot writing audio to disk.
- **2026-06-07** 📅 Cleaner Home Upcoming — Cancelled, declined, and all-day events are filtered out so they don't crowd real meetings. Locale-aware times (`11:30 PM` in US, `23:30` in EU) and "Ends in 5 min" / "Started 12 min ago" labels for in-progress events.


## Features

- **Privacy-first** — 100% on-device; your recordings, transcripts, and summaries never leave your Mac
- **Live transcription** — Real-time on-screen text as you speak via Parakeet TDT v3 on Apple Silicon (MLX). Granola-style chat-bubble view with You / Others attribution.
- **Auto start/stop meetings** — Steno notifies you when a meeting starts and offers to take notes, then offers to summarise when it ends (Granola-style)
- **In-app note-taking** — Jot notes while you record; they're folded straight into the AI summary
- **Ask your meetings** — Natural-language Q&A across a single note or your entire library via the Chat tab (summary, key topics, full transcript)
- **System audio capture** — Record both sides of virtual meetings, headphones on, no extra setup. Native Core Audio Tap on macOS 14.4+ with automatic fallback on older versions
- **Speaker diarisation** — `[You]` vs `[Others]` labels live during the recording and on the final transcript
- **Multi-language** — Parakeet covers 25 European languages with live transcription; Whisper handles 99 languages (incl. Chinese, Japanese, Arabic, Hindi) post-stop
- **Markdown notes** — Summaries and transcripts saved as clean Markdown you can edit, search, or sync
- **Choose your transcription engine** — Settings → Transcribe lets you pick Parakeet (default) or Whisper, with in-app downloads and a progress bar
- **Crash-safe recording** — If Steno is force-quit mid-recording, the orphan recorder subprocess is detected and cleaned up on the next launch
- **Auto-updates** — New versions download in the background and install on next quit; a top-right toast lets you know when one's ready
- **macOS Shortcuts** — Start and stop recordings via `stenoai://` deep links for calendar-driven automation
- **Remote Ollama server** — Offload summarisation to a beefier Mac or workstation on your network
- **Bring your own cloud model** — Optional OpenAI, Anthropic, or custom API endpoint for users who prefer a hosted LLM
- **Organisation AI** — On managed deployments, sign in to your org's Steno adapter and AI routes through it automatically — no local API key, no setup
- **Under the hood** — Local transcription via Parakeet TDT v3 (MLX) or whisper.cpp, summarisation via bundled Ollama (5 models to choose from)

## macOS Shortcuts (Optional)

<details>
<summary>Expand setup and calendar automation guide</summary>

Steno supports Apple Shortcuts via deep links using the `stenoai://` URL scheme.

- Start recording: `stenoai://record/start?name=Daily%20Standup`
- Stop recording: `stenoai://record/stop`

### How to set it up

1. Open the **Shortcuts** app on macOS.
2. Create a new shortcut (for example: "Start Steno Recording").
3. Add the **Open URLs** action.
4. Use one of the URLs above.
5. (Optional) Add a keyboard shortcut from the shortcut settings.

### Calendar event naming (optional)

If you want calendar-based names, resolve the event title in your Shortcut workflow and pass it as the `name` query value in the start URL.

Example:

`stenoai://record/start?name=Weekly%20Product%20Sync`

### Calendar event start automation (via Rules bridge)

macOS Shortcuts **cannot natively trigger** exactly at Calendar event start.  
To run this automatically on event timing, a third-party automation app is required.

This addon uses:

- **Apple Shortcuts**: builds the `stenoai://record/start?...` action.
- **Rules – Calendar Automation**: watches Calendar events and triggers the shortcut.

#### Architecture overview

1. Rules App monitors upcoming Calendar events.
2. Rules checks the event note/body for a marker keyword (for example `stenoai`).
3. If matched, Rules runs a Shortcut.
4. The Shortcut gets the next event title and opens:
   - `stenoai://record/start?name={calendar_event_title}`
5. Steno receives the URL and starts recording with that name.

#### Step-by-step setup

1. Install **Rules – Calendar Automation** on macOS.
2. Create a Shortcut in Apple Shortcuts (example name: `Steno Start From Calendar Event`).
3. In that Shortcut, add actions in this order:
   - `Find Calendar Events` (limit to `1`, sorted by start date ascending, upcoming only)
   - Extract the event title from the found event
   - `URL Encode` the title
   - `Open URLs` with:
     - `stenoai://record/start?name=<encoded title>`
4. Open Rules and create a calendar-trigger rule:
   - Source: your target calendar(s)
   - Trigger window: event start (or preferred offset)
   - Condition: event note contains `stenoai`
   - Action: run Shortcut `Steno Start From Calendar`
5. In your Calendar event notes, add the word `stenoai` for meetings that should auto-start recording.
6. Test with a near-future event:
   - create event with `stenoai` in notes,
   - wait for trigger,
   - confirm Steno starts and uses the event title as session name.

#### Notes

- Without Rules (or another automation bridge), this cannot be fully event-driven from Calendar start time.
- Keep using regular manual shortcuts (`Open URLs`) for non-automated scenarios.

Have questions or suggestions? [Join our Discord](https://discord.gg/DZ6vcQnxxu) to chat with the community.
</details>

## Models & Performance

**Transcription Models:**
- `Parakeet TDT v3` (572 MB): Highest quality, supports live transcription, 25 European languages (English, Spanish, French, German, Italian, Portuguese, Dutch, Russian, Polish, Czech, and 15 others). Apple Silicon only via MLX. **(default on fresh installs)**
- `Whisper Large V3 Turbo` (1.6 GB): Best accuracy Whisper model. 99 languages including Chinese, Japanese, Arabic, Korean, and Hindi. Post-stop only.
- `Whisper Small` (466 MB): Balanced speed and accuracy. Same 99-language coverage. **(legacy — kept available for existing users; Large V3 Turbo recommended)**

**Summarization Models** (Ollama):
- `llama3.2:3b` (2GB): Fast and lightweight for quick meetings **(default)**
- `gemma3:4b` (2.5GB): Lightweight and efficient
- `qwen3.5:9b` (6.6GB): Excellent at structured output and action items
- `deepseek-r1:14b` (9.0GB): Strong reasoning and analysis capabilities
- `gpt-oss:20b` (14GB): OpenAI open-weight model with reasoning capabilities

## Future Roadmap

### Enhanced Features
- Live transcription during recording
- NVIDIA Parakeet as a transcription engine option
- Editing notes after processing
- Windows version

## Installation

Download the latest release (**Apple Silicon Mac, macOS 12 Monterey or later**):

- [Apple Silicon (M1-M5)](https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg)

> **Intel Mac users**: v0.4.0 is Apple Silicon only. Stay on [v0.3.8](https://github.com/ruzin/stenoai/releases/tag/v0.3.8) — the last release supporting Intel Macs. Auto-update on existing Intel installs will not push v0.4.0 to those machines.

### Installing on macOS

1. **Download and open the DMG file**
2. **Drag the app to Applications**
3. **When you first launch the app**, macOS may show a security warning
4. **To fix this warning:**
   - Go to **System Settings > Privacy & Security** and click **"Open Anyway"**

   **Alternatively:**
   - Right-click Steno in Applications and select **"Open"**
   - Or run in Terminal: `xattr -cr /Applications/Steno.app`
5. **The app will work normally on subsequent launches**

You can run it locally as well (see below) if you don't want to install a DMG.

### Windows (alpha)

Windows 10/11 (x64) is supported in **alpha**, with the full pipeline verified working: record → live Parakeet transcription → batch transcript → Ollama summary, **including system-audio loopback capture with `[You]`/`[Others]` diarisation**.

**Install:** download **`stenoAI-windows-x64.exe`** from the [latest release](https://github.com/ruzin/stenoai/releases/latest) and run it — it installs per-user (no admin needed) and creates Start-menu/desktop shortcuts. On first launch, Windows SmartScreen warns because the alpha is unsigned — click **More info → Run anyway**. The first-run setup wizard then downloads the transcription model (~670 MB) and the summarisation model (~2 GB).

> Before the first tagged Windows release lands, grab the installer from the [Windows build workflow](https://github.com/ruzin/stenoai/actions/workflows/build-windows.yml): sign in to GitHub, open the latest green run, download the `stenoai-windows` artifact, and run the `.exe` inside.

Known alpha limitations:

- **Unsigned** — SmartScreen warns on first launch; we'll code-sign before 1.0.
- **CPU-only summarisation** — the bundled Ollama runs on CPU (the NVIDIA GPU libraries are excluded to keep the download small); a separate GPU build is a follow-up. Transcription is CPU on every platform regardless.
- **Auto-update** is wired (NSIS + `latest.yml`) but updates are unsigned until code signing is in place.
- **Transcription** runs through `onnx-asr` (ONNX Runtime) instead of MLX, with the same Parakeet model and behaviour as macOS. Whisper is also available as an engine option.

Issues + feedback welcome on the GitHub issues tracker.

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

**Setup wizard debug console:** during first-time setup, expand the debug console panel to see real-time logs of model downloads and service startup.

**Terminal logging (recommended for runtime issues):** launch the app from a terminal to stream all logs (Python subprocess output, Whisper transcription, Ollama API traffic, error stack traces):
```bash
/Applications/Steno.app/Contents/MacOS/Steno
```

**System Console:**
```bash
# View recent Steno-related logs
log show --last 10m --predicate 'process CONTAINS "Steno" OR eventMessage CONTAINS "ollama"' --info

# Monitor live logs
log stream --predicate 'eventMessage CONTAINS "ollama" OR process CONTAINS "Steno"' --level info
```

### Common Issues

- **Update didn't install**: Auto-updates are applied on next quit. Quit via the **Steno → Quit** menu (not just closing the window), then reopen.
- **No system audio / no `[Others]` speaker labels**: macOS needs **Screen Recording** permission. Go to **System Settings → Privacy & Security → Screen & System Audio Recording**, enable Steno, and relaunch the app.
- **`stenoai://` deep link doesn't start recording**: Make sure Steno has launched at least once after install so the URL scheme is registered. If it still fails, check the terminal log for `Protocol handler registration` output.
- **Recording stops early**: Check microphone permissions, Screen Recording permission (if using system audio), and available disk space.
- **"Processing failed"**: Usually an Ollama service or model issue — check the terminal logs.
- **Empty transcripts**: Whisper couldn't detect speech — verify audio input levels.
- **Slow processing**: Normal for longer recordings; Ollama is CPU-intensive. If summaries are unusually slow, switch to a smaller model in Settings → AI (Llama 3.2 3B is the fastest).

### Logs Location
- **User Data**: `~/Library/Application Support/stenoai/`
- **Recordings**: `~/Library/Application Support/stenoai/recordings/`
- **Transcripts**: `~/Library/Application Support/stenoai/transcripts/`
- **Summaries**: `~/Library/Application Support/stenoai/output/`

## License

This project is licensed under the [MIT License](LICENSE).
