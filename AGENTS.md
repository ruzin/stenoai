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

### Bundled binaries

Never invoke a bundled binary through `subprocess`/`spawn` for an operation that has an HTTP or library API.
macOS SIP and the Electron hardened runtime strip `DYLD_LIBRARY_PATH` from child processes, so such a call works in development and fails only in the signed, shipped app.
Use the `ollama` Python package for model operations.
Starting the server with `ollama serve` is the one sanctioned exception, covered by the `com.apple.security.cs.allow-dyld-environment-variables` entitlement.

### Platform parity

The app ships on macOS and Windows from shared code, and macOS is the signed, stable build that a Windows fix must never disturb.
Platform-specific behaviour must be gated on `process.platform` (JS) or `sys.platform` (Python).
Platform-specific electron-builder options belong in the `mac` or `win` block, never at the top level.
New additions to `stenoai.spec` must be conditional on the platform so they do not bloat or break the other bundle.
Flag an ungated change even when it is correct for the platform the author tested on.

### User data paths

Paths into user data must resolve through `get_user_data_dir()` (Python) or `getUserDataDir()` (main.js), and path lists must use `os.pathsep`.
A literal `~/Library/Application Support/...` or a hardcoded `:` separator breaks Windows silently rather than loudly.
Bundled binary names need the `.exe` suffix off-darwin.

### Test isolation

Every test that can reach the backend must set `STENOAI_USER_DATA_DIR` to a temporary directory, which both `getUserDataDir()` and `get_user_data_dir()` honour.
Without it the test reads and can delete the developer's real recordings and transcripts.
Flag a new or modified test that touches user data without setting it.

### Meeting content in telemetry

Recordings, transcripts, and summaries are the user's private data, and analytics events carry event names and counts only.
Flag any change that puts transcript text, meeting titles, file names, or model output into a telemetry event, and any new setting that sends data off device while defaulting to on.
Adding or reclassifying an event name, an error reason, or a counter is fine and needs no comment.

### E2E coverage for behaviour changes

A change to how the app behaves ships with its e2e spec in the same pull request.
Prefer a model-free T2 spec that drives the `window.stenoai.<group>` preload bridge and asserts backend state on disk; reach for a T1 spec only when the interaction itself is the risk, and keep model or network assertions in the `@pipeline` and nightly lanes.
When a spec is missing, name the tier that fits rather than only noting the absence.
This applies to behaviour only.
Documentation, comments, copy, the website, and release chores need no spec, so do not ask for one there.
