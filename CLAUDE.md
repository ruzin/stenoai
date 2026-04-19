# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Do not use excessive emojis anywhere.

## Architecture

The app is a thin Electron shell over a PyInstaller-bundled Python CLI. There is no long-running Python service — every operation is a subprocess invocation.

- **Electron main (`app/main.js`, ~4.3k lines)** owns the UI window, tray, deep-link protocol, and orchestrates everything via `ipcMain.handle(...)`. Handlers shell out to the bundled backend through `getBackendPath()` → `process.resourcesPath/stenoai/stenoai` (or `dist/stenoai/stenoai` in dev) using `child_process.spawn`.
- **Renderer (`app/index.html`, ~9.7k lines)** is a single-page HTML/JS UI; no framework. All cross-process work goes through IPC.
- **Python CLI (`simple_recorder.py`, ~2.5k lines, ~46 click commands)** is the single entry point bundled by `stenoai.spec`. Sub-modules in `src/`: `audio_recorder` (sounddevice), `transcriber` (pywhispercpp), `summarizer` (Ollama HTTP client), `ollama_manager` (lifecycle of the bundled `ollama serve`), `config` (JSON-backed user settings + model registry), `folders`, `models`.
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
- Start app (dev): `cd app && npm start`
- Build DMG (local, for testing): `cd app && npm run build`

For setup from a clean checkout, see `CONTRIBUTING.md` and `README.md`.

## Production Readiness
This app ships as a signed DMG to real users. Before considering any change complete:
- **Packaged app test**: Dev mode (`npm start`) is not sufficient. Always rebuild the DMG (`npm run build`) and test the installed app from `/Applications`.
- **Cold start test**: Kill all background processes (`pkill -f ollama`) and launch the app fresh. The full pipeline (record, transcribe, summarize) must work with no pre-existing services running.
- **No shelling out to bundled binaries for operations that have an HTTP/library API**. macOS SIP + Electron hardened runtime strips `DYLD_LIBRARY_PATH` from child processes. Use the `ollama` Python package (HTTP API) for model operations, not `subprocess.run([ollama_path, ...])`. The only acceptable use of the Ollama binary is `ollama serve` (starting the server), which is covered by the `com.apple.security.cs.allow-dyld-environment-variables` entitlement.
- **No bare `exit()` in Python code**. PyInstaller bundles don't have `exit` as a builtin. Always use `sys.exit()`.

## Brand Colors
StenoAI logo gradient (used in website logo SVG and app header):
- Indigo: `#6366f1`
- Sky blue: `#0ea5e9`
- Cyan: `#06b6d4`
- CSS: `linear-gradient(135deg, #6366f1, #0ea5e9, #06b6d4)`

App UI accent: `--accent-primary: #818cf8` (lighter indigo, used for focus states, active tabs, toggles)

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
Releases are automated via `.github/workflows/build-release.yml`. Never create releases manually.

1. Bump version in `app/package.json` (on the branch, before merging)
2. After PR is merged to `main`, create an **annotated tag** on main with the release notes in the tag message:
   ```
   git tag -a v0.2.5 -m "Release notes here..."
   git push origin v0.2.5
   ```
3. The tag push triggers the workflow which:
   - Builds signed + notarized DMGs for both arm64 and x64
   - Creates a GitHub Release with the tag message as the "What's New" section
   - Uploads both DMGs as release assets
4. The tag message becomes the release notes body — write it as markdown with a summary of changes
5. Do NOT build DMGs locally for releases, do NOT use `gh release create` manually

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
