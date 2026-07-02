---
name: granola-to-steno
description: >
  Sync Granola meeting notes into StenoAI's file-based store. Reads recent
  meetings from the Granola MCP (titles, dates, participants, AI summaries,
  verbatim transcripts) and regenerates StenoAI's `output/*_summary.md` and
  `transcripts/*_transcript.txt` files in a target folder (e.g. an iCloud Drive
  directory). The operation is idempotent: filenames derive from date + title,
  so re-running rewrites existing meetings in place and only adds new ones. Use
  when the user says "sync Granola to Steno", "import my Granola meetings into
  StenoAI", "resync Steno", "refresh Steno from Granola", or runs this on a
  schedule. Requires a connected Granola MCP and Python 3.
---

# Granola -> StenoAI sync

This skill rebuilds StenoAI's local meeting files from Granola. StenoAI stores
each meeting as two files in a folder it watches:

```
<STENO_DIR>/output/<stem>_summary.md        # frontmatter + Summary + Transcript + sections
<STENO_DIR>/transcripts/<stem>_transcript.txt
```

`<stem>` is `YYYYMMDD-HHMM_<slugified-title>`. Because the stem is derived from
the meeting's date and title, **rewriting an existing meeting is a no-op and new
meetings are simply added** - the whole flow is safe to run repeatedly and on a
schedule.

The bundled generator (`scripts/steno_gen.py`) does the StenoAI-specific
formatting (cleans Granola markdown into the plain-text shape Steno renders,
diarises the transcript, writes both files). This skill's job is to gather the
raw Granola data into a simple staging folder and hand it to the generator.

---

## Prerequisites

- A connected **Granola MCP** exposing `list_meetings`, `get_meetings`, and
  `get_meeting_transcript`. The MCP server id is environment-specific, so load
  the tools by name with ToolSearch rather than assuming a fixed prefix.
- **Python 3** available in the shell.
- A **target StenoAI directory** containing (or able to contain) `output/` and
  `transcripts/` subfolders. This is often inside iCloud Drive - see Step 3.

---

## Step 0 - Gather settings

Decide these up front (ask the user only if not obvious; otherwise use the
defaults):

- **Time range** - default: union of `this_week` and `last_week`. For a one-off
  backfill use `last_30_days` or a `custom` range.
- **Target StenoAI directory** (`STENO_DIR`) - see Step 3.
- **Language** - the language your meetings are in, as a short code (`en`, `fr`,
  `de`, ...). Defaults to `en`. Passed to the generator via `--language` in
  Step 6.

## Step 1 - Load the Granola tools

Load the three Granola tools in one ToolSearch call, e.g.:

```
ToolSearch { query: "list_meetings get_meetings get_meeting_transcript", max_results: 5 }
```

Confirm the matched tools belong to the Granola server before calling them.

## Step 2 - List recent meetings

Call `list_meetings(time_range="this_week")` and
`list_meetings(time_range="last_week")` (or the chosen range). Take the **union
of meeting ids** and de-duplicate. If there are none, report "Nothing to sync"
and stop.

## Step 3 - Locate the target StenoAI directory

Resolve `STENO_DIR` in this order:

1. An explicit path the user gave you.
2. A `STENO_DIR` environment variable, if set.
3. Auto-detect a StenoAI folder under the user's connected folders. In a shell
   with iCloud mounted this is typically:
   ```bash
   BASE=$(ls -d /sessions/*/mnt/*CloudDocs* 2>/dev/null | head -1)
   STENO_DIR="$BASE/StenoAI"
   ```
   (Adjust the mount glob to the actual workspace layout.)

If you cannot find it, ask the user for the path. Ensure
`"$STENO_DIR/output"` and `"$STENO_DIR/transcripts"` exist (create them).

> **iCloud note:** files in an iCloud folder can be cloud-only or briefly locked
> by sync. If a shell command on such a path fails with *"Resource deadlock
> avoided"* or the file is cloud-only, fall back to the host file tools
> (Read/Write) for that file - they download/write through iCloud natively.
> See Step 6.

## Step 4 - Fetch meeting data and transcripts

For the collected ids:

- Call `get_meetings(meeting_ids=[...])` in **batches of <=10**. Capture for each
  meeting: `title`, the **exact displayed date** string (e.g.
  `"Jun 26, 2026 2:30 PM GMT+2"`), `known_participants`, and `summary`.
- Call `get_meeting_transcript(meeting_id)` for each meeting. It may return
  `null`/empty (no transcript) - that's fine, treat it as an empty transcript.

## Step 5 - Write the raw staging files

In your working directory, create `granola_sync/<id>/` per meeting and write
**plain-text `.txt` files only** (do not write `.md` for staging, and never
write a `_summary.json`):

- `meta.txt` - exactly three lines, a real **TAB** between key and value:
  ```
  title<TAB><title>
  date<TAB><exact date string>
  participants<TAB><Name A>; <Name B>; ...
  ```
  Strip emails (`<...>`), `from <Company>`, and `(note creator)` from
  participant names; separate names with `; `.
- `summary.txt` - the raw Granola summary verbatim (empty file if none).
- `transcript.txt` - the raw verbatim transcript (empty file if null).

## Step 6 - Generate and copy into StenoAI

Snapshot the existing summaries first so you can report what's new, then run the
bundled generator and copy the results into `STENO_DIR` with retries (iCloud may
lock files transiently):

```bash
WORK=/path/to/your/working/dir          # holds granola_sync/
SKILL_DIR=/path/to/this/skill           # holds scripts/steno_gen.py
LANG_CODE=en                            # meeting language from Step 0

ls "$STENO_DIR/output" > /tmp/steno_before.txt 2>/dev/null || true

rm -rf /tmp/steno_out
python3 "$SKILL_DIR/scripts/steno_gen.py" "$WORK/granola_sync" /tmp/steno_out --language "$LANG_CODE"

cp_retry(){ for i in 1 2 3 4 5 6; do cp -f "$1" "$2" 2>/dev/null && return 0; sleep 2; done; echo "FAIL $2"; }
mkdir -p "$STENO_DIR/output" "$STENO_DIR/transcripts"
for f in /tmp/steno_out/output/*;      do cp_retry "$f" "$STENO_DIR/output/$(basename "$f")"; done
for f in /tmp/steno_out/transcripts/*; do cp_retry "$f" "$STENO_DIR/transcripts/$(basename "$f")"; done
```

Verify by comparing file **sizes** between `/tmp/steno_out/...` and
`STENO_DIR/...` (use `stat -c %s`, which does not trigger the iCloud read lock
that `cmp`/`diff` can). If any file failed to copy because of an iCloud
*"Resource deadlock avoided"* lock, write that one file through the **host file
tools** instead: read the generated file's content and Write it directly to the
`STENO_DIR` path (the host filesystem handles iCloud natively).

If the generator prints a `WARNING: could not parse date ...` line to stderr,
surface it to the user: that meeting's date could not be read (usually a locale
mismatch in the displayed Granola date), so it got a stable placeholder date.
The file is still written idempotently, but its date will be wrong until the raw
date string parses.

## Step 7 - Report

Give a short summary: number of meetings processed, and the list of **new**
titles - those whose `*_summary.md` was not present in
`/tmp/steno_before.txt`. Do not paste summaries or transcripts into the report.

---

## Notes for implementers (StenoAI team)

- The generator intentionally **never writes `*_summary.json`**. StenoAI's
  `list_meetings` scans JSON before Markdown and de-dupes by stem; the JSON
  branch omits `session_info.summary_file`, which breaks the detail view
  ("Note not found"). The `.md` carries everything the parser needs.
- StenoAI renders the **Summary** field as plain text and collapses single
  newlines, so the generator converts Granola markdown into clean text:
  de-escapes `\~ \* \_` etc., turns `### Heading` into an UPPERCASE line and
  `- bullet` into `• bullet`, and inserts a blank line between blocks so nothing
  collapses. Change this only if StenoAI's renderer changes.
- The output **language** is a CLI flag: `--language <code>` (default `en`). It
  is written to the frontmatter `language` field and to the transcript header's
  `Language setting:` / `Detected language:` / `Summary output language:` lines.
  Granola does not expose a per-meeting language, so this is a single value for
  the whole sync run.
- `duration_seconds` is written as `null` (unknown), matching what StenoAI's own
  writer emits when it has no duration. Granola does not expose a meeting
  duration.
- An **unparseable date** falls back to a *deterministic* placeholder derived
  from the raw date + title (never `now()`), so re-running the sync produces the
  same stem and the meeting is not duplicated. The generator prints a `WARNING`
  to stderr in that case.
- Transcript diarisation keys off `Me:` / `Them:` / `Speaker N:` markers and puts
  each turn on its own line. Meetings with no transcript yield an empty
  transcript body (and `is_diarised: false` in the frontmatter).
- Everything is keyed on `stem = <date>_<slug(title)>`, so the sync is
  idempotent and append-only by construction. Each file's frontmatter also
  carries the source `granola_id`, so if two different meetings ever compute
  the same stem, a later run can tell "this is the same meeting again" apart
  from "a different meeting took this stem" and suffix the newcomer instead of
  overwriting unrelated content.
