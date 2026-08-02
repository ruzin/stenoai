# AGENTS.md

Instructions for coding agents working in this repository.

`CLAUDE.md` at the repo root is the full guide: architecture, development commands, the e2e tiers, the release process, and the cross-platform rules.
Read it first and treat it as authoritative.
This file deliberately does not repeat it, so the two cannot drift.

The section below is different in kind.
Codex's GitHub code review reads `## Code Review Rules` and applies it to pull requests, so it is written for a reviewer rather than for an implementer.

## Code Review Rules

These are the failure modes that are non-obvious and expensive here.
Each one states the invariant and the safe path.
Report a finding only when the diff actually violates the invariant, and say which input or state produces the wrong result.
If a change is clean, say nothing.

### Bundled binaries with an API

Never invoke a bundled binary through `subprocess`/`spawn` for an operation that also has an HTTP or library API.
macOS SIP and the Electron hardened runtime strip `DYLD_LIBRARY_PATH` from child processes, so such a call works in development and fails only in the signed, shipped app.
Model operations go through the `ollama` Python package.
This rule is narrow: spawning the bundled `stenoai` CLI is the app's architecture, and `ffmpeg` and `ollama serve` have no library alternative, so none of those are findings.

### Bare `exit()` in Python

Use `sys.exit()`, never bare `exit()`.
`exit` is injected by `site` and is absent from a PyInstaller bundle, so the call raises only in the shipped app and never in development.
Ruff's default rule set does not catch this.

### Platform parity

The app ships on macOS and Windows from shared code, and macOS is the signed, stable build that a Windows fix must never disturb.
Platform-specific behaviour must be gated on `process.platform` (JS) or `sys.platform` (Python), and platform-specific electron-builder options belong in the `mac` or `win` block rather than at the top level.
The same applies to `stenoai.spec`: an addition that is platform-specific must be conditional, while a genuinely cross-platform one is correct unconditional.
Flag an ungated change even when it is correct for the platform the author tested on.

### User data paths

Paths into user data must resolve through `get_user_data_dir()` (Python) or `getUserDataDir()` (main.js), and path lists must use `os.pathsep`.
A literal `~/Library/Application Support/...` or a hardcoded `:` separator breaks Windows silently rather than loudly.
An executable name needs the `.exe` suffix on Windows only, gated as `".exe" if sys.platform == "win32" else ""`; Linux takes no suffix.

### Test isolation

A test that starts the real app or the bundled backend must set `STENOAI_USER_DATA_DIR` to a temporary directory, which both `getUserDataDir()` and `get_user_data_dir()` honour.
Without it the test reads and can delete the developer's real recordings and transcripts.
A unit test that isolates paths another way, by a temporary directory plus patching, is equally correct and is not a finding.

### Meeting content in telemetry

Recordings, transcripts, and summaries are the user's private data.
Analytics events carry no free text and no user content: property keys and their values are allowlisted in `app/analytics-helpers.js`, and exceptions are sanitised before capture.
Flag a change that puts transcript text, meeting titles, file names, or model output into an event, that forwards a raw error message or response body, or that adds a setting sending data off device while defaulting to on.
Adding an allowlisted enum property, an event name, or a counter is fine and needs no comment.

### E2E coverage for user-facing changes

Adding or materially changing a user-facing feature ships its e2e spec in the same pull request.
Prefer a model-free T2 spec that drives the `window.stenoai.<group>` preload bridge and asserts backend state on disk; reach for a T1 spec only when the interaction itself is the risk, and keep model or network assertions in the `@pipeline` and nightly lanes.
When a spec is missing, name the tier that fits rather than only noting the absence.
This is scoped to user-facing behaviour.
An internal fix covered by a unit test needs no e2e spec, and documentation, comments, copy, the website, and release chores need none either.
