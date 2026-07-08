# granola-to-steno

Originally contributed by @SylvainRamousse in ruzin/stenoai#265, polished for
inclusion in the repo.

A Cowork / Claude **skill** that syncs Granola meeting notes into Steno's
file-based store. Drop it into a Cowork session (or any Claude environment that
loads skills) and ask it to "sync Granola to Steno".

## What it does

1. Reads recent meetings from a connected **Granola MCP**
   (`list_meetings` -> `get_meetings` -> `get_meeting_transcript`).
2. Stages each meeting as plain-text files (`meta.txt`, `summary.txt`,
   `transcript.txt`).
3. Runs `scripts/steno_gen.py` to render Steno's expected files:
   - `output/<stem>_summary.md`
   - `transcripts/<stem>_transcript.txt`
4. Copies them into the target Steno directory (iCloud-aware, with retries).

The sync is **idempotent and append-only**: filenames derive from
`date + slug(title)`, so re-running rewrites existing meetings in place and only
adds new ones. Safe to run on a schedule. Each generated file also carries the
source Granola meeting id in its frontmatter (`granola_id`), so if two different
meetings ever hash to the same filename, the generator can tell them apart
across separate runs instead of one silently overwriting the other - see
"Notes for the Steno team" below for the residual edge case this doesn't
cover.

## Who it's for

People who already migrated (or are migrating) from Granola to Steno and use
Claude Code / Cowork with a connected Granola MCP. It is an agent skill, not an
in-app feature: nothing in the Steno app runs it, and it never talks to Granola
directly - it drives the Granola MCP tools the host agent already has.

## Contents

- `SKILL.md` - the skill definition and step-by-step instructions for the agent.
- `scripts/steno_gen.py` - the standalone generator (the Steno-specific
  formatting). Usage:
  `python3 steno_gen.py <input_dir> <target_dir> [--language LANG]`.

## Notes for the Steno team

- The generator **never writes `*_summary.json`** (Steno's lister prefers JSON
  and its JSON branch drops `session_info.summary_file`, breaking the detail
  view). The `.md` carries everything the parser needs.
- Summary text is normalized for Steno's plain-text renderer (UPPERCASE
  headings, `•` bullets, blank line between blocks).
- Output language is a `--language` flag (default `en`), written to both the
  frontmatter `language` field and the transcript header. Granola exposes no
  per-meeting language, so it is one value per sync run.
- `duration_seconds` is written as `null` (unknown), matching what Steno's own
  writer emits when it has no duration - the app hides an absent/`0` duration
  identically, so this is a correctness fix (represent unknown as unknown), not
  a behavior change.
- Dates that fail to parse fall back to a **deterministic** placeholder (hash of
  the raw date + title), never `datetime.now()`, so the stem is stable across
  runs and the meeting is not duplicated. A `WARNING` is printed to stderr so the
  operator can fix the locale mismatch.
- **Cross-run stem collisions.** Two different meetings can compute the same
  stem (same title + date to the minute). Within a single run this was already
  suffixed; across separate runs (e.g. meeting X drops out of the sync window
  in a later run, meeting Y takes over its stem) the generator now checks the
  on-disk file's `granola_id` before writing: if it belongs to a different
  meeting (or has no `granola_id` at all, e.g. a file from before this fix, or
  something unrelated), the incoming write is suffixed with the source id
  instead of overwriting it. This is safe-by-default but not perfect: a file
  that already existed under the exact target stem *before* this fix shipped
  will look "foreign" the first time and get a one-off suffixed sibling rather
  than being adopted in place.

## Known limitations

- **Key Topics / Key Points / Action Items are empty.** Granola's data shape does
  not expose these as separate structured fields (they are folded into the free
  text summary), so the generator leaves those Steno sections blank rather than
  inventing content. The full summary still lands in the Summary section.
- **Language is per-run, not per-meeting.** Granola does not report a detected
  language, so `--language` applies to the whole batch. Run separate syncs if you
  have meetings in different languages and care about the tag.
- **Duration is unknown.** Granola does not expose a meeting duration, so
  `duration_seconds` is always `null` (the app simply omits the duration badge).
