# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Do not use excessive emojis anywhere.

## Architecture

The app is a thin Electron shell over a PyInstaller-bundled Python CLI. There is no long-running Python service — every operation is a subprocess invocation.

- **Electron main (`app/main.js`, ~6.2k lines)** owns the UI window, tray, deep-link protocol, and orchestrates everything via `ipcMain.handle(...)`. Handlers shell out to the bundled backend through `getBackendPath()` → `process.resourcesPath/stenoai/stenoai` (or `dist/stenoai/stenoai` in dev) using `child_process.spawn`.
- **Renderer (`app/renderer/`)** is a Vite-built React + TypeScript SPA. Runs with `contextIsolation: true` and talks to the main process exclusively through the typed bridge in `app/preload.js` → `ipc()` (`app/renderer/src/lib/ipc.ts`). Built output lives at `app/renderer/dist/index.html` and is what Electron loads at runtime.
- **Python CLI (`simple_recorder.py`, ~2.9k lines, ~60 click commands)** is the single entry point bundled by `stenoai.spec`. Sub-modules in `src/`: `audio_recorder` (sounddevice), `transcriber` (pywhispercpp), `summarizer` (Ollama HTTP client), `ollama_manager` (lifecycle of the bundled `ollama serve`), `config` (JSON-backed user settings + model registry), `folders`, `models`, `whisper_models`.
- **State across CLI invocations** is persisted to `recorder_state.json` and similar small JSON files — there is no daemon. Long-running recordings are a `record` subprocess kept alive by the Electron main process.
- **User data lives in `~/Library/Application Support/stenoai/`** (`recordings/`, `transcripts/`, `output/`), resolved via `src.config.get_data_dirs()`. Repo-root `recordings/`/`transcripts/`/`output/` dirs are dev-only scratch.
- **Bundled binaries (`bin/`)**: Ollama + ffmpeg, downloaded by `scripts/download-ollama.sh`. PyInstaller copies them into `dist/stenoai/ollama/` and `dist/stenoai/ffmpeg`. Electron then re-bundles `dist/stenoai/` as an `extraResource`.
- **Deep links**: app registers the `stenoai://` URL scheme. Handler logic is in `app/main.js` near `SHORTCUT_PROTOCOL`. Used by macOS Shortcuts: `stenoai://record/start?name=...` and `stenoai://record/stop`.

## Development Commands

### Backend (Python)
- Build the bundled backend: `source venv/bin/activate && pyinstaller stenoai.spec --noconfirm`
- Inspect CLI surface: `dist/stenoai/stenoai --help`
- Most relevant CLI commands for debugging: `status`, `setup-check`, `list_failed`, `reprocess path/to/summary.json`, `query transcript.txt`, `pipeline filename.wav`
- Lint: `ruff check .`
- Run all tests: `python -m unittest discover tests`
- Run a single test: `python -m unittest tests.test_config.ConfigStoragePathTests.test_set_storage_path_handles_permission_errors`

### Desktop App (Electron)
- Start app (dev): `cd app && npm start` — rebuilds the renderer (`vite build`), then launches Electron
- Start without rebuilding renderer: `cd app && npm run start:nobuild` — fast relaunch when only `main.js` / `preload.js` changed
- Renderer dev server (HMR, no Electron): `cd app && npm run dev:renderer`
- Typecheck renderer: `cd app && npm run typecheck:renderer`
- Lint renderer: `cd app && npm run lint:renderer`
- Format renderer: `cd app && npm run format:renderer`
- Build DMG (local, for testing): `cd app && npm run build`

The Electron build pulls the bundled backend from `../dist/stenoai` via `extraResources`, so the PyInstaller step (`pyinstaller stenoai.spec --noconfirm`) must succeed *before* `npm run build` — otherwise the packaged app will be missing `stenoai`, `ollama`, and `ffmpeg`. The same applies in dev: `getBackendPath()` falls back to `dist/stenoai/stenoai`, so a fresh checkout needs the backend built once before the app can record or transcribe.

For setup from a clean checkout, see `CONTRIBUTING.md` and `README.md`.

## Production Readiness
This app ships as a signed DMG to real users. Before considering any change complete:
- **Packaged app test**: Dev mode (`npm start`) is not sufficient. Always rebuild the DMG (`npm run build`) and test the installed app from `/Applications`.
- **Cold start test**: Kill all background processes (`pkill -f ollama`) and launch the app fresh. The full pipeline (record, transcribe, summarize) must work with no pre-existing services running.
- **No shelling out to bundled binaries for operations that have an HTTP/library API**. macOS SIP + Electron hardened runtime strips `DYLD_LIBRARY_PATH` from child processes. Use the `ollama` Python package (HTTP API) for model operations, not `subprocess.run([ollama_path, ...])`. The only acceptable use of the Ollama binary is `ollama serve` (starting the server), which is covered by the `com.apple.security.cs.allow-dyld-environment-variables` entitlement.
- **No bare `exit()` in Python code**. PyInstaller bundles don't have `exit` as a builtin. Always use `sys.exit()`.

## Brand Colors
Paper + ink — a cream page with deep ink text. The logo
(`website/public/stenoai-logo.svg`) is `#1B1B19` ink on `#FAF9F5` paper.
There is no chromatic brand accent; UI accents (focus rings, active
states, links) use the foreground ink itself, so the whole interface
reads as one neutral palette.

**Light mode**
- Page / surface: `#FAF9F5` (paper-0)
- Sunken / hover: `#F5F3EC` (paper-1)
- Primary text + accent: `#1B1B19` (ink-900)
- Secondary text: `#6B6B66` (ink-500)

**Dark mode**
- Page / surface: `#1A1A18`
- Raised: `#24241F`
- Primary text + accent: `#EDEAE0`
- Secondary text: `#9A968A`

Tokens live in `app/renderer/src/globals.css` under `:root` (light) and
`.dark, [data-theme="dark"]` (dark). Prefer the semantic tokens
(`--fg-1`, `--surface-raised`, `--accent-primary`) over raw hex.

## Git Workflow
- Always create a branch for changes unless explicitly told otherwise
- Never commit directly to `main`
- Before creating a PR, run a self-review of the full branch diff (`git diff main...HEAD`):
  - Review backend code for security issues, error handling gaps, edge cases, and best practices
  - Review frontend code for layout bugs, CSS consistency, accessibility, and polish
  - Use the frontend-design skill for UI-related changes
  - Categorize findings by severity (critical/medium/low) and fix critical issues before merging

## Git Commit Guidelines
- Do NOT include "Generated with Claude Code" attribution in commit messages
- Do NOT include "Co-Authored-By: Claude <noreply@anthropic.com>" in commit messages
- Keep commit messages concise and focused on what changed
- Use conventional commit format when appropriate (feat:, fix:, docs:, etc.)

## Release Process
Releases are automated via `.github/workflows/build-release.yml`. Never create releases manually. The full checklist for shipping a new version (do all of this before pushing the tag — the tag push is the public release trigger):

1. **Survey what's shipping** — `git log v<previous>..HEAD --oneline` and `gh pr list --state merged --limit 20` to confirm the changeset.
2. **Update the README** to reflect what's shipping:
   - Add bullet entries to the "📢 What's New" section for each notable user-facing change. Format: `- **YYYY-MM-DD** <emoji> <Title> — <one-sentence description>`. Most recent entries at the top.
   - Remove "What's New" entries older than ~2 months to keep the section fresh.
   - Update the "Features" list if any new user-facing capability is being added (or an existing one materially changed).
   - Update "Models & Performance" if the bundled Whisper or Ollama model lineup changed.
3. **Bump version** in `app/package.json`.
4. **Commit and merge** the README + version bump to `main` (or push directly if explicitly authorised).
5. **Draft release notes** as markdown — they become the GitHub Release body verbatim:
   - One-line summary at the top.
   - Headline features grouped under `### Section` headers (e.g., "System audio", "UX polish", "Under the hood", "Fixes").
   - Migration/upgrade notes if anything changed paths, identifiers, defaults, or requires user action.
6. **Create an annotated tag** on `main` with the release notes as the tag message. **Always pass `--cleanup=whitespace`** — without it, `git tag -F` strips every line starting with `#`, which silently deletes Markdown `### Section` headers from the release body:
   ```
   git tag -a v0.3.0 --cleanup=whitespace -F /path/to/notes.md
   git push origin v0.3.0
   ```
   (If using `-m` instead of `-F`, pass `--cleanup=whitespace` anyway — the comment-stripping default applies to both.)
7. The tag push triggers the workflow which:
   - Builds signed + notarized DMGs for both arm64 and x64
   - Creates a GitHub Release with the tag message as the body
   - Uploads both DMGs as release assets
8. Do NOT build DMGs locally for releases, do NOT use `gh release create` manually.

## Session Logging
When the user says "log session" or similar (e.g., "update session log", "document this session"):
1. Update SESSION_LOG.md in the root directory with the current session details
2. Include: date/time, summary of work, key decisions, files modified, issues resolved, next steps
3. REPLACE or CONDENSE previous session entries to keep the file concise (max 2-3 most recent sessions)
4. Keep only relevant context for the next Claude session - remove outdated or completed work details
5. Format with clear headers and organized sections
