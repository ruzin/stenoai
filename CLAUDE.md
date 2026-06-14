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

### End-to-end tests (Playwright)
The e2e suite drives the **real Electron app** (real window, real clicks) to catch
full-app regressions like the org-provider reset before they reach users. It lives
at repo-root `e2e/` (config, fixtures, specs); run it from `app/`.

**Standing rule — keep coverage current:** when you add or materially change a
user-facing feature, add or update its e2e spec in the **same** change. Prefer a
model-free T2 spec that drives the `window.stenoai.<group>` preload bridge and
asserts backend state on disk (config/files/JSON), using the existing specs +
`e2e/fixtures/` helpers as templates — only reach for a UI/T1 spec when the
interaction itself is the risk, and keep model/network-bearing assertions in the
`@pipeline`/nightly lanes. This applies to luffy-built work too (CLAUDE.md
overrides luffy's test-level defaults); the QA review lens checks for it.

- Run the whole suite: `cd app && npm run test:e2e` (needs the renderer built and,
  for T2, the backend bundle at `dist/stenoai/`).
- Run one tier: `cd app && npm run test:e2e -- --project=t1` (or `t2`).
- Tiers are chosen by spec filename:
  - **T1 — `*.t1.spec.ts`**: renderer-only with mock IPC (`STENOAI_E2E_MOCK_IPC=1`,
    stubs in `app/e2e-mock-ipc.js`). No Python/Ollama/network — fully hermetic.
  - **T2 — `*.t2.spec.ts`**: the real bundled backend + mock org adapter / Ollama
    (`e2e/fixtures/`). Proves end-to-end wiring.
  - **`@pipeline` (a T2 spec)**: the transcription→summarize smoke drives a synthetic
    WAV through the real pipeline and asserts HEARTBEAT + a summary written. The engine is
    env-selected (`STENOAI_E2E_ENGINE`): **parakeet** locally (the Mac-divergent path) but
    **whisper** in CI — GitHub-hosted macOS runners have no Metal GPU, so parakeet-mlx can't
    load there. Models aren't bundled (download on use), so it's tagged `@pipeline` and split
    out: `--grep @pipeline` runs it (CI's `t2-pipeline-macos` job caches a whisper model),
    `--grep-invert @pipeline` keeps the other T2 specs model-free. A dev machine without the
    active engine's model **skips** it (loudly) rather than failing.
  - **Current specs:** `org-lock.t1`, `shared-notes-policy.t1`, `org-lock-lifecycle.t2`,
    `config-corruption.t2`, the core-loop trio `recording-lifecycle.t2` /
    `meetings-crud.t2` / `folders-crud.t2`, the config trio `settings-roundtrip.t2` /
    `ai-provider.t2` / `model-management.t2`, and the chat/org pair `chat-sessions.t2`
    (local session persistence) / `org-crud.t2` (meeting CRUD + share/unshare + ai-chat
    against the stateful `mock-adapter.js`), plus `summarize-contract.t2` (a
    deterministic `@contract` driving `reprocess` through the capturing
    `mock-ollama.js` to assert the summariser's prompt-build + response-parse — no
    ASR, no real model), and the calendar/notifications pair `calendar-auth.t2`
    (auth-status from a local token file + auto-detect-meetings toggle) /
    `notifications.t2` (the notifications_enabled toggle gating the note-ready /
    silence notifications via the `shown` signal), and the onboarding/updates pair
    `setup-check.t2` (the setup-wizard allGood + checks contract) / `announcements.t2`
    (the local announcements feed + version stamp) (all model-free, run in `t2-macos` /
    `t2-windows`); `transcription-pipeline.t2` and `honest-failure.t2` (tagged
    `@pipeline`, run in `t2-pipeline-macos` / `t2-pipeline-windows`). Engine selection
    for `@pipeline` specs is shared via `e2e/fixtures/engine.ts`; model-free T2 setup
    helpers (deterministic recording config + seeded meeting summaries) live in
    `e2e/fixtures/user-config.ts`. The core-loop specs drive the preload IPC bridge and
    assert backend state on disk — `recording-lifecycle` exercises the
    start/pause/resume/stop state machine via the renderer-driven (no-device, no-model)
    path and skips loudly where `isSystemAudioSupported()` is false. The config trio
    asserts get/set round-trips persist to the right `config.json` keys (settings),
    the provider matrix + encrypted cloud key (ai-provider), and the deterministic
    model list/status/set surface (model-management) — pulls stay in `@pipeline`.
  - **Windows T2:** the same specs run on `windows-latest` via explicit per-OS jobs
    (`build-backend-windows` → `t2-windows` / `t2-pipeline-windows`). Differences from the
    macOS jobs: no exec-bit restore (Windows has no exec bit), `taskkill`/`Stop-Process`
    instead of `pkill`, and the `@pipeline` job uses the REAL parakeet path —
    `STENOAI_E2E_ENGINE=parakeet` runs onnx-asr on CPU (no Metal needed), caching the
    `models--istupakov--parakeet-tdt-0.6b-v3-onnx` HF snapshot. org-lock T2 may **skip** on
    Windows (safeStorage/DPAPI on a headless runner), acceptable while non-blocking.
  - **T3 — `*.t3.spec.ts` (nightly only):** the heavy `@long-meeting` chunking smoke. Drives a
    multi-minute WAV (`STENOAI_E2E_LONG_WAV_SECONDS`, default 1200) through the real
    **parakeet** windowing path (`PARAKEET_CHUNK_DURATION_S` = 60 s, a hard constant) and
    asserts the pipeline completes. parakeet-only — whisper.cpp doesn't use that path; it
    `skip`s on whisper. Exercises the long-file chunking **plumbing**, NOT the MLX/Metal OOM
    (that needs a GPU runner — tracked follow-up). Too slow for per-PR, so it lives in the
    nightly workflow, not `e2e.yml`.
- **Isolation keystone:** every test sets `STENOAI_USER_DATA_DIR` to a temp dir, which
  both `getUserDataDir()` (main.js) and `get_user_data_dir()` (`src/config.py`) honor,
  so a test can never read/write the real `~/Library/Application Support/stenoai`. The
  launch fixture (`e2e/fixtures/electron.ts`) waits on `[data-app-ready]` (no fixed timeouts)
  and force-kills the app process tree if a graceful close hangs on teardown (Windows).
- **CI:** `.github/workflows/e2e.yml` (T1 on Ubuntu/xvfb, macOS + Windows T2; non-blocking,
  runs per-PR). `.github/workflows/e2e-nightly.yml` (scheduled) reuses that suite via
  `workflow_call` for flake/drift detection and adds the T3 long-meeting job. A CI-only
  Playwright `globalSetup` kills a stray Ollama + waits for a clean 11434 before the run.

## Production Readiness
This app ships as a signed DMG to real users. Before considering any change complete:
- **Packaged app test**: Dev mode (`npm start`) is not sufficient. Always rebuild the DMG (`npm run build`) and test the installed app from `/Applications`.
- **Cold start test**: Kill all background processes (`pkill -f ollama`) and launch the app fresh. The full pipeline (record, transcribe, summarize) must work with no pre-existing services running.
- **No shelling out to bundled binaries for operations that have an HTTP/library API**. macOS SIP + Electron hardened runtime strips `DYLD_LIBRARY_PATH` from child processes. Use the `ollama` Python package (HTTP API) for model operations, not `subprocess.run([ollama_path, ...])`. The only acceptable use of the Ollama binary is `ollama serve` (starting the server), which is covered by the `com.apple.security.cs.allow-dyld-environment-variables` entitlement.
- **No bare `exit()` in Python code**. PyInstaller bundles don't have `exit` as a builtin. Always use `sys.exit()`.

## Cross-Platform (macOS + Windows)
The app ships on **macOS** (primary, signed + notarised DMG) **and Windows** (alpha, NSIS installer). **Any change to shared code must be considered for both platforms** — a fix for one can silently break or regress the other. The macOS build is the stable, signed one; never let a Windows fix change it.

- **Gate platform-specific code on `process.platform`** (JS) / `sys.platform` (Python). Don't apply a platform-only change globally. Examples of macOS-only things that must be gated: `titleBarStyle: 'hiddenInset'` + traffic-light insets (the 82px `sb-top` / toggle offset, behind `html.is-mac`), the `services`/`hide`/`unhide` menu roles, `forceCoreAudioTap`, `app.dock`/dock-icon APIs, `askForMediaAccess`. Windows-only: `windowsHide` on spawns, `setAppUserModelId`, `taskkill` tree-kill, the explicit `BrowserWindow` icon.
- **electron-builder config is per-platform.** `asar: false` lives in the `win` block only — macOS keeps `asar` (its signing/notarisation integrity depends on it). Put platform-specific build options in the `mac`/`win` blocks, not top-level.
- **Paths must be cross-platform.** Use `os.pathsep` (not `:`), `src.config.get_user_data_dir()` (Python) and `getUserDataDir()` (main.js) — never hardcode `~/Library/Application Support/...`. The `.exe` suffix + `shutil.which` for bundled binaries.
- **Transcription backend dispatches by platform**: macOS uses `parakeet-mlx` (Apple Silicon GPU); Windows/Linux use `onnx-asr` (ONNX Runtime, CPU) — both behind `src/parakeet.py`. Call sites must not branch on engine. Windows is CPU-only today (slower; DirectML is a tracked follow-up).
- **PyInstaller spec (`stenoai.spec`) is conditional per `sys.platform`** — MLX hidden-imports/dylibs on darwin, onnx-asr + `copy_metadata('onnx-asr')` + onnxruntime DLLs off-darwin; UPX off and Ollama GPU libs pruned on Windows. Keep new bundling additions gated so they don't bloat or break the other platform's bundle.
- **Verify both.** Windows is built + smoke-tested in CI (`.github/workflows/build-windows.yml`, includes `onnx-selftest`); macOS via `build-release.yml`. When you can't test the other platform locally, at minimum confirm the change is correctly gated.

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
   - Keep only the **most recent 4 entries** in the section — trim older ones as you add new ones, regardless of date. The section is a rolling marquee, not a changelog.
   - Update the "Features" list if any new user-facing capability is being added (or an existing one materially changed).
   - Update "Models & Performance" if the bundled Whisper or Ollama model lineup changed.
3. **Bump version** in `app/package.json`.
4. **Commit and merge** the README + version bump to `main` (or push directly if explicitly authorised).
5. **Draft release notes** as markdown — they become the GitHub Release body verbatim:
   - One-line summary at the top.
   - Headline features grouped under `### Section` headers (e.g., "System audio", "UX polish", "Under the hood", "Fixes").
   - Migration/upgrade notes if anything changed paths, identifiers, defaults, or requires user action.
6. **Run the release gate (blocks the tag).** Push a `release/v<version>` branch — `git push origin main:refs/heads/release/v0.3.0` — to trigger `.github/workflows/e2e-release-gate.yml`, which runs the full e2e matrix (T1 + macOS/Windows T2 + `@pipeline` + the `@long-meeting` T3 smoke). **Do not create the tag until this run is green.** The gate runs on the branch, before the immutable tag exists, so a failure is fixed-and-re-pushed rather than leaving a half-released tag. (You can also dry-run it via `workflow_dispatch`.) `build-release.yml` additionally runs a fast T1 backstop smoke (`gate-smoke`) before signing, but that is defense-in-depth — the branch gate is the real signal.
7. **Create an annotated tag** on `main` with the release notes as the tag message. **Always pass `--cleanup=whitespace`** — without it, `git tag -F` strips every line starting with `#`, which silently deletes Markdown `### Section` headers from the release body:
   ```
   git tag -a v0.3.0 --cleanup=whitespace -F /path/to/notes.md
   git push origin v0.3.0
   ```
   (If using `-m` instead of `-F`, pass `--cleanup=whitespace` anyway — the comment-stripping default applies to both.)
8. The tag push triggers the workflow which:
   - Builds signed + notarized DMGs for both arm64 and x64
   - Creates a GitHub Release with the tag message as the body
   - Uploads both DMGs as release assets
9. Do NOT build DMGs locally for releases, do NOT use `gh release create` manually.

## Session Logging
When the user says "log session" or similar (e.g., "update session log", "document this session"):
1. Update SESSION_LOG.md in the root directory with the current session details
2. Include: date/time, summary of work, key decisions, files modified, issues resolved, next steps
3. REPLACE or CONDENSE previous session entries to keep the file concise (max 2-3 most recent sessions)
4. Keep only relevant context for the next Claude session - remove outdated or completed work details
5. Format with clear headers and organized sections
