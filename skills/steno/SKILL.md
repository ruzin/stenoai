---
name: steno
description: >
  Make the agent aware of the user's Steno meeting notes and able to pull them in
  on request. Steno (https://github.com/stenolabs/stenoai) records, transcribes,
  and summarizes meetings entirely on-device, storing each as a Markdown summary
  plus a transcript. This skill locates that store cross-platform (macOS,
  Windows, Linux, and a custom storage path like iCloud) and reads it — then uses
  the notes for whatever the user asked: answer a question across meetings, recap
  a day or week, extract action items and decisions, or use the meetings as
  source material to draft a document (spec, PRD, follow-up email, status update).
  It can also help **set up a cloud model** (`/steno setup`) — guiding OpenAI,
  Anthropic, AWS Bedrock, or a custom endpoint. Use whenever the user runs
  `/steno`, mentions "my Steno notes", "my meetings", "the <name>
  call/standup/1:1", asks to base something on what was discussed, or asks to set
  up / configure a provider — e.g. "/steno what did we decide about pricing",
  "/steno recap this week", "/steno write a spec from the Acme calls", "/steno
  setup", "help me configure Bedrock in Steno". Reading notes is READ-ONLY and
  needs Python 3.8+ (no other deps); setup is guidance only.
---

# /steno — the agent's gateway to Steno meeting notes

Steno keeps every meeting on-device as a Markdown **summary** and a plain-text
**transcript**. This skill makes the agent aware of that store and lets it pull
the relevant notes into context, then do whatever the user asked with them.

Data access is one stdlib-only, **read-only** script: `scripts/steno.py` — no
dependencies. Run it with `python3 scripts/steno.py …` (or `uv run
scripts/steno.py …` if the user has uv but no Python on PATH). It never writes,
moves, or deletes — authoring notes is Steno's job, not this skill's.

## The pattern: gather → then do the task

Almost every `/steno` request is two steps. **Gather** the right notes with the
CLI, then **do the task** (answer, summarize, draft) with them in context.

1. **Always start with `locate`** to confirm the store is found. If it reports 0
   meetings, ask the user where their notes are — don't invent meetings.
2. **Find the relevant meetings** with `list` (browse by date) or `search`
   (by topic). Use `--json` so you can chain the results.
3. **Pull the full text** with `read <stem> -t` for each meeting you need.
4. **Do what was asked** with that material.

```bash
python3 scripts/steno.py locate                 # find the store, count meetings
python3 scripts/steno.py list --since 2026-07-01 --json
python3 scripts/steno.py search "pricing" -t --json
python3 scripts/steno.py read "acme" -t         # one meeting, summary + transcript
python3 scripts/steno.py folders
```

## What the user can ask `/steno` to do

The CLI gives you the raw material; you do the reasoning. Common functions:

- **Answer a question across meetings.** `search` for the topic, `read` the top
  hits, answer with citations (meeting title + date). *"What did we decide about
  the pricing page?"*
- **Pull one meeting in.** `read <query>` (add `-t` if the ask needs the verbatim
  transcript, not just the summary). *"Summarize the Acme call."*
- **Recap a day / week / range.** `list --since <date>`, read the summaries,
  produce a digest grouped by meeting. *"Recap this week's meetings."*
- **Extract action items or decisions.** Read the `## Action Items` sections (and
  scan summaries/transcripts) across the relevant meetings into one list, noting
  owners. *"What are my open action items from this week?"*
- **Ground a document in real meetings.** Gather the meetings, then draft the
  artifact from them — a spec/PRD, a follow-up email, a status update, release
  notes. Quote or cite the source meetings so the user can trace claims. *"Write
  a spec from the Acme discovery calls."*

For anything else, gather with the CLI and apply judgement — these are examples,
not an exhaustive menu.

## Set up a cloud model (`/steno setup`)

A different job from reading notes: help the user point Steno's summarization at a
cloud provider instead of the local default. When the user asks to set up or
configure a provider (OpenAI, Anthropic, AWS Bedrock, or a custom endpoint),
**read `references/provider-setup.md`** and walk them through *their* provider —
it has the exact values, where each goes in Steno's Settings → AI, and
troubleshooting. Bedrock is the involved one (region + model/inference-profile +
a Bedrock API key); OpenAI and Anthropic are a single API key.

This is **guidance only** — you don't touch AWS or change Steno's config. And
**never have the user paste an API key into the chat**; they enter it directly in
Steno's Settings.

## Where notes live (the CLI handles this for you)

Resolution order (mirrors Steno's `src/config.py`):

1. `--notes-dir <dir>` — points straight at the folder containing `output/`.
2. `STENOAI_USER_DATA_DIR` — Steno's isolation override, if set.
3. `config.json` → `storage_path` — a custom location (e.g. iCloud Drive).
4. The per-OS data dir: macOS `~/Library/Application Support/stenoai`,
   Windows `%APPDATA%\stenoai`, Linux `$XDG_DATA_HOME/stenoai` or
   `~/.local/share/stenoai`.

```
<base>/output/<stem>_summary.md           # meeting summary (authoritative)
<base>/transcripts/<stem>_transcript.txt   # verbatim transcript
<stem> = YYYYMMDD-HHMM_<slugified-title>
```

## Reading files directly (if you skip the CLI)

Each `*_summary.md` is a flat frontmatter block then `##` sections:

```
---
title: "Acme Q3 Planning"
date: 2026-07-15T14:00:00
language: en
is_diarised: true
transcription_failed: false
---
## Summary        <- plain text, not markdown
## Participants
## Key Topics / ## Key Points / ## Action Items
## Transcript     <- may be empty; the full text is the transcripts/ file
## User Notes     <- the user's own typed notes
```

Frontmatter is **line-by-line `key: value`, not nested YAML** (strings are
double-quoted, `\"`/`\\` escaped); ignore unknown keys. A meeting's folder
assignment is in its `*_summary.json` sidecar, not the `.md`.

## Guardrails

- **Read-only.** Never modify Steno's data through this skill.
- **Private data.** Summaries and transcripts are the user's confidential
  content. Use them for the user's request; don't send them to external services
  or pull in more than the task needs.
- **`transcription_failed: true`** means the note may be empty or partial — say
  so rather than filling the gap with invention.
- **Cite meetings** (title + date) when you answer from them, so the user can
  verify. If `locate` finds nothing, ask — don't fabricate meetings.
