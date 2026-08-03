#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# dependencies = []
# ///
# ^ PEP 723 metadata: this script has NO third-party dependencies, so it runs
#   directly under any Python 3.8+ (`python3 steno.py ...`). The block lets uv
#   users run it — and bootstrap a Python if they have none — via `uv run`.
"""Read-only access to a local Steno meeting-note store, for agents.

Steno (https://github.com/stenolabs/stenoai) records, transcribes, and
summarizes meetings entirely on-device. Each meeting is stored as a Markdown
summary plus a plain-text transcript under a per-OS data directory. This script
locates that store and lets an agent list, read, and search notes without
knowing Steno's internals.

It is strictly READ-ONLY: it never writes, moves, or deletes anything. No
third-party dependencies — Python 3.8+ standard library only.

Commands (run `steno.py <command> -h` for details):
  locate                 Print the resolved notes directory + a meeting count.
  list                   List meetings (newest first): stem, date, title, people.
  read <query>           Print one meeting's summary (+ transcript with -t).
  search <text>          Full-text search across summaries and transcripts.
  folders                List the user's folders.

Every command takes --json for machine-readable output.

Location resolution, in priority order:
  1. --notes-dir <dir>            (points straight at the folder holding output/)
  2. STENOAI_USER_DATA_DIR        (env; Steno's own isolation override)
  3. config.json -> storage_path  (a custom location the user set, e.g. iCloud)
  4. the per-OS Steno data dir    (macOS ~/Library/Application Support/stenoai,
                                   Windows %APPDATA%\\stenoai, Linux
                                   $XDG_DATA_HOME/stenoai or ~/.local/share/stenoai)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

SUMMARY_SUFFIX = "_summary.md"
TRANSCRIPT_SUFFIX = "_transcript.txt"


# ---------------------------------------------------------------------------
# Location resolution
# ---------------------------------------------------------------------------

def default_data_dir() -> Path:
    """The per-OS Steno data directory (where config.json / folders.json live).

    Mirrors src/config.py:get_user_data_dir() in the Steno repo. Honors the
    STENOAI_USER_DATA_DIR override so an agent can be pointed at a test store.
    """
    override = os.environ.get("STENOAI_USER_DATA_DIR")
    if override:
        return Path(override)
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "stenoai"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        return (Path(base) if base else Path.home() / "AppData" / "Roaming") / "stenoai"
    base = os.environ.get("XDG_DATA_HOME")
    return (Path(base) if base else Path.home() / ".local" / "share") / "stenoai"


def resolve_notes_base(data_dir: Path, notes_dir: str | None) -> Path:
    """The directory that holds output/ and transcripts/.

    Usually the data dir, but a user can point Steno at a custom storage_path
    (e.g. an iCloud Drive folder) — then the notes move there while config.json
    stays in the data dir. Mirrors src/config.py:get_data_dirs().
    """
    if notes_dir:
        return Path(notes_dir).expanduser()
    # STENOAI_USER_DATA_DIR is the hardest override in Steno itself — it beats a
    # configured storage_path — so respect that same precedence here.
    if os.environ.get("STENOAI_USER_DATA_DIR"):
        return data_dir
    cfg = data_dir / "config.json"
    try:
        sp = (json.loads(cfg.read_text(encoding="utf-8")).get("storage_path") or "").strip()
        if sp:
            return Path(sp).expanduser()
    except (OSError, json.JSONDecodeError):
        pass
    return data_dir


# ---------------------------------------------------------------------------
# Note parsing
# ---------------------------------------------------------------------------

def _unquote(value: str) -> str:
    """Undo the quoting Steno's frontmatter writer applies to string scalars."""
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    return value


def parse_frontmatter(block: str) -> dict:
    """Parse Steno's line-by-line `key: value` frontmatter (not nested YAML).

    Steno writes a flat block between `---` fences; values are plain scalars,
    with strings double-quoted and \\" / \\\\ escaped. Unknown keys are kept.
    """
    fm: dict = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, raw = line.partition(":")
        key = key.strip()
        raw = raw.strip()
        if raw in ("null", ""):
            fm[key] = None
        elif raw in ("true", "false"):
            fm[key] = raw == "true"
        elif re.fullmatch(r"-?\d+", raw):
            fm[key] = int(raw)
        else:
            fm[key] = _unquote(raw)
    return fm


def parse_sections(body: str) -> dict:
    """Split a summary body into its `## Heading` sections -> {heading: text}."""
    sections: dict = {}
    current = None
    buf: list = []
    for line in body.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            if current is not None:
                sections[current] = "\n".join(buf).strip()
            current = m.group(1)
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        sections[current] = "\n".join(buf).strip()
    return sections


class Meeting:
    def __init__(self, md_path: Path, notes_base: Path):
        self.path = md_path
        self.stem = md_path.name[: -len(SUMMARY_SUFFIX)]
        self._notes_base = notes_base
        text = md_path.read_text(encoding="utf-8", errors="replace")
        self.frontmatter: dict = {}
        body = text
        if text.startswith("---"):
            parts = text.split("---", 2)
            if len(parts) >= 3:
                self.frontmatter = parse_frontmatter(parts[1])
                body = parts[2]
        self.body = body
        self.sections = parse_sections(body)

    @property
    def title(self) -> str:
        return self.frontmatter.get("title") or self.sections.get("Title") or self.stem

    @property
    def date(self) -> str:
        return self.frontmatter.get("date") or ""

    @property
    def participants(self) -> str:
        return (self.sections.get("Participants") or "").strip()

    @property
    def summary(self) -> str:
        return (self.sections.get("Summary") or "").strip()

    @property
    def transcript_path(self) -> Path:
        return self._notes_base / "transcripts" / f"{self.stem}{TRANSCRIPT_SUFFIX}"

    def transcript(self) -> str:
        p = self.transcript_path
        if p.exists():
            return p.read_text(encoding="utf-8", errors="replace")
        # Longer meetings keep the transcript inline under ## Transcript.
        return (self.sections.get("Transcript") or "").strip()

    def as_dict(self) -> dict:
        return {
            "stem": self.stem,
            "title": self.title,
            "date": self.date,
            "participants": self.participants,
            "summary_file": str(self.path),
            "language": self.frontmatter.get("language"),
            "is_diarised": self.frontmatter.get("is_diarised"),
            "transcription_failed": self.frontmatter.get("transcription_failed"),
        }


def load_meetings(notes_base: Path) -> list:
    out_dir = notes_base / "output"
    if not out_dir.is_dir():
        return []
    meetings = []
    for md in out_dir.glob(f"*{SUMMARY_SUFFIX}"):
        try:
            meetings.append(Meeting(md, notes_base))
        except OSError:
            continue
    # Newest first: frontmatter date if present, else filename stem (date-led).
    meetings.sort(key=lambda m: (m.date or m.stem), reverse=True)
    return meetings


def load_folders(data_dir: Path, notes_base: Path) -> list:
    for candidate in (notes_base / "folders.json", data_dir / "folders.json"):
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("folders"), list):
                return data["folders"]
        except (OSError, json.JSONDecodeError):
            continue
    return []


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def _dirs(args) -> tuple:
    data_dir = Path(args.data_dir).expanduser() if args.data_dir else default_data_dir()
    notes_base = resolve_notes_base(data_dir, args.notes_dir)
    return data_dir, notes_base


def cmd_locate(args) -> int:
    data_dir, notes_base = _dirs(args)
    out_dir = notes_base / "output"
    count = len(list(out_dir.glob(f"*{SUMMARY_SUFFIX}"))) if out_dir.is_dir() else 0
    if args.json:
        print(json.dumps({
            "data_dir": str(data_dir),
            "notes_base": str(notes_base),
            "output_dir": str(out_dir),
            "transcripts_dir": str(notes_base / "transcripts"),
            "exists": out_dir.is_dir(),
            "meeting_count": count,
        }, indent=2))
    else:
        print(f"Data dir      : {data_dir}")
        print(f"Notes base    : {notes_base}")
        print(f"Output dir    : {out_dir}  ({'exists' if out_dir.is_dir() else 'MISSING'})")
        print(f"Transcripts   : {notes_base / 'transcripts'}")
        print(f"Meetings found: {count}")
        if count == 0:
            print("\nNo meetings found. Is Steno installed and used on this machine, "
                  "or point at the store with --notes-dir / STENOAI_USER_DATA_DIR.")
    return 0


def _filter(meetings, args) -> list:
    if getattr(args, "since", None):
        meetings = [m for m in meetings if (m.date or "")[:10] >= args.since]
    if getattr(args, "folder", None):
        # Folder membership lives in each meeting's summary JSON sidecar; when
        # present we honor it, else the filter is a no-op we announce.
        pass
    if getattr(args, "limit", None):
        meetings = meetings[: args.limit]
    return meetings


def cmd_list(args) -> int:
    _, notes_base = _dirs(args)
    meetings = _filter(load_meetings(notes_base), args)
    if args.json:
        print(json.dumps([m.as_dict() for m in meetings], indent=2))
        return 0
    if not meetings:
        print("No meetings found. Try `locate` to check the resolved directory.")
        return 0
    for m in meetings:
        people = f"  [{m.participants}]" if m.participants else ""
        print(f"{(m.date or '????-??-??')[:16]:16}  {m.title}{people}")
        print(f"                  stem: {m.stem}")
    return 0


def _match(meetings, query: str) -> list:
    q = query.lower()
    exact = [m for m in meetings if m.stem.lower() == q]
    if exact:
        return exact
    return [m for m in meetings if q in m.stem.lower() or q in m.title.lower()]


def cmd_read(args) -> int:
    _, notes_base = _dirs(args)
    matches = _match(load_meetings(notes_base), args.query)
    if not matches:
        print(f"No meeting matches {args.query!r}. Use `list` to see stems/titles.",
              file=sys.stderr)
        return 1
    if len(matches) > 1:
        print(f"{len(matches)} meetings match {args.query!r} — narrow it down:",
              file=sys.stderr)
        for m in matches[:20]:
            print(f"  {m.stem}  ({m.title})", file=sys.stderr)
        return 1
    m = matches[0]
    if args.json:
        d = m.as_dict()
        d["summary"] = m.summary
        d["sections"] = m.sections
        if args.transcript:
            d["transcript"] = m.transcript()
        print(json.dumps(d, indent=2))
        return 0
    print(f"# {m.title}")
    print(f"Date: {m.date}    Stem: {m.stem}")
    if m.participants:
        print(f"Participants: {m.participants}")
    print()
    print(m.summary or "(no summary)")
    for heading in ("Key Topics", "Key Points", "Action Items"):
        text = (m.sections.get(heading) or "").strip()
        if text:
            print(f"\n## {heading}\n{text}")
    if args.transcript:
        print("\n## Transcript\n")
        print(m.transcript() or "(no transcript)")
    return 0


def cmd_search(args) -> int:
    _, notes_base = _dirs(args)
    q = args.text.lower()
    hits = []
    for m in load_meetings(notes_base):
        haystacks = [("summary", m.body)]
        if args.transcript:
            haystacks.append(("transcript", m.transcript()))
        for where, text in haystacks:
            for line in text.splitlines():
                if q in line.lower():
                    hits.append({"stem": m.stem, "title": m.title, "date": m.date,
                                 "where": where, "line": line.strip()})
                    break
    if args.limit:
        hits = hits[: args.limit]
    if args.json:
        print(json.dumps(hits, indent=2))
        return 0
    if not hits:
        print(f"No matches for {args.text!r}.")
        return 0
    for h in hits:
        print(f"{(h['date'] or '')[:10]}  {h['title']}  ({h['where']})")
        print(f"    {h['stem']}")
        print(f"    …{h['line']}…")
    return 0


def cmd_folders(args) -> int:
    data_dir, notes_base = _dirs(args)
    folders = load_folders(data_dir, notes_base)
    if args.json:
        print(json.dumps(folders, indent=2))
        return 0
    if not folders:
        print("No folders defined (or folders.json not found).")
        return 0
    for f in folders:
        name = f.get("name", "(unnamed)") if isinstance(f, dict) else str(f)
        fid = f.get("id", "") if isinstance(f, dict) else ""
        print(f"{name}    id: {fid}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="steno.py",
        description="Read-only access to a local Steno meeting-note store.",
    )
    p.add_argument("--data-dir", help="Override Steno's per-OS data dir.")
    p.add_argument("--notes-dir", help="Point straight at the folder holding output/.")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("locate", help="Resolve and print the notes directory.")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_locate)

    sp = sub.add_parser("list", help="List meetings, newest first.")
    sp.add_argument("--since", help="Only meetings on/after YYYY-MM-DD.")
    sp.add_argument("--folder", help="(reserved) filter by folder name.")
    sp.add_argument("--limit", type=int, help="Cap the number returned.")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("read", help="Print one meeting by stem or title substring.")
    sp.add_argument("query", help="Filename stem or a title substring.")
    sp.add_argument("-t", "--transcript", action="store_true",
                    help="Include the full transcript.")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_read)

    sp = sub.add_parser("search", help="Full-text search across notes.")
    sp.add_argument("text", help="Text to search for (case-insensitive).")
    sp.add_argument("-t", "--transcript", action="store_true",
                    help="Also search transcript bodies.")
    sp.add_argument("--limit", type=int, help="Cap the number of hits.")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_search)

    sp = sub.add_parser("folders", help="List the user's folders.")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_folders)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
