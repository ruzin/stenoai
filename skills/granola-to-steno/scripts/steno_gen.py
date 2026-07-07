#!/usr/bin/env python3
"""
Granola -> Steno migration generator.

Reads one folder per meeting from an input dir:
  <in>/<id>/meta.txt        # lines "key<TAB>value": title, date, participants
  <in>/<id>/summary.txt     # raw Granola AI summary (may be empty/missing)
  <in>/<id>/transcript.txt  # raw verbatim transcript (may be empty/missing)

meta.txt:
  title<TAB>Candidature peopulse S Ramousse
  date<TAB>Jun 26, 2026 2:30 PM GMT+2
  participants<TAB>Name A <a@x>; Name B from Co <b@y>

Writes Steno's file-based store into:
  <target>/output/<stem>_summary.md      (ONLY this is globbed for listing)
  <target>/transcripts/<stem>_transcript.txt

Usage:
  python3 steno_gen.py <input_dir> <target_dir> [--language LANG]

NOTE: never write *_summary.json -- Steno's list_meetings scans json before md,
dedupes by stem, and the json branch omits session_info.summary_file, which breaks
the detail view ("Note not found"). The .md carries everything the parser needs.
"""
import argparse
import datetime
import hashlib
import re
import sys
from pathlib import Path

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def _stable_fallback_date(raw: str, title: str) -> str:
    # The file stem is derived from this timestamp, so an unparseable date MUST
    # yield the same value on every run or the meeting would get a new stem each
    # sync and duplicate forever. datetime.now() would break that invariant, so
    # we hash the raw date + title into a deterministic pseudo-timestamp instead.
    seed = hashlib.sha256(f"{raw}\x00{title}".encode("utf-8")).hexdigest()
    offset = int(seed[:8], 16)
    dt = datetime.datetime(2000, 1, 1) + datetime.timedelta(seconds=offset)
    return dt.replace(microsecond=0).isoformat()


def parse_date(raw: str, title: str = "") -> str:
    m = re.match(r"([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?", raw or "")
    if m:
        mon, day, year, hh, mm, ap = m.groups()
        hh = int(hh)
        mm = int(mm)
        if ap == "PM" and hh != 12:
            hh += 12
        if ap == "AM" and hh == 12:
            hh = 0
        try:
            return datetime.datetime(int(year), MONTHS[mon], int(day), hh, mm, 0).isoformat()
        except Exception:
            pass
    print(
        f"WARNING: could not parse date {raw!r} for {title!r}, using a stable "
        "fallback timestamp - this meeting's date will be wrong, check your "
        "Granola locale",
        file=sys.stderr,
    )
    return _stable_fallback_date(raw or "", title or "")


def slugify(s, maxlen=48):
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return (s[:maxlen].rstrip("-")) or "meeting"


def make_stem(date_iso, title):
    d = date_iso.replace(":", "").replace("-", "")
    d = re.sub(r"T(\d{2})(\d{2})\d{2}", r"-\1\2", d)
    return f"{d}_{slugify(title)}"


def name_only(p):
    p = re.sub(r"<[^>]*>", "", p)
    p = re.split(r"\s+from\s+", p)[0]
    p = p.replace("(note creator)", "")
    return p.strip().strip(",").strip()


def clean_summary(summary):
    """Steno renders the Summary field as PLAIN TEXT (no markdown) and
    collapses single newlines. So convert Granola markdown into clean text:
    de-escape, '### Heading' -> UPPERCASE line, '- bullet' -> '* bullet',
    and put a blank line between every block so nothing collapses."""
    if not summary or not summary.strip():
        return ""
    s = re.sub(r'\\([~*_`#\-])', r'\1', summary)
    out = []
    for raw in s.splitlines():
        line = raw.strip()
        if not line:
            continue
        h = re.match(r'^#{1,6}\s+(.+)$', line)
        if h:
            out.append(h.group(1).strip().upper())
        elif re.match(r'^[-*]\s+', line):
            out.append(re.sub(r'^[-*]\s+', '• ', line))
        else:
            out.append(line)
    return "\n\n".join(out)


def diarise(transcript):
    if not transcript:
        return "", False
    t = transcript.strip()
    has = bool(re.search(r"\b(Me|Them|Speaker\s*\d+):", t))
    t = re.sub(r"\s*\b(Me|Them|Speaker\s*\d+):\s*", lambda m: "\n" + m.group(1) + ": ", t)
    t = re.sub(r"\n{2,}", "\n", t).strip()
    return t, has


def yaml_scalar(v):
    if v is None:
        return ": null"
    if isinstance(v, bool):
        return ": true" if v else ": false"
    if isinstance(v, int):
        return f": {v}"
    # A literal newline in a scalar would inject a bogus extra "key" line into
    # the frontmatter block once Steno's line-by-line parser reads it back,
    # so collapse embedded newlines before quoting rather than trying to
    # round-trip them (the app's frontmatter has no multi-line scalar syntax).
    s = str(v).replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    return f': "{s}"'


def render_frontmatter(d):
    return "\n".join(["---"] + [f"{k}{yaml_scalar(v)}" for k, v in d.items()] + ["---"])


def build(meeting, language="en"):
    title = (meeting.get("title") or "Untitled").strip()
    date_iso = parse_date(meeting.get("date_raw", ""), title)
    stem = make_stem(date_iso, title)
    parts = [name_only(p) for p in meeting.get("participants", []) if name_only(p)
             and name_only(p).lower() != "unknown"]
    summary = clean_summary(meeting.get("summary") or "")
    transcript, is_diar = diarise(meeting.get("transcript") or "")

    fm = render_frontmatter({
        "title": title,
        "date": date_iso,
        "duration_seconds": None,
        "language": language,
        "is_diarised": is_diar,
        "transcription_failed": False,
        # Unknown frontmatter keys are ignored by Steno's parser. This one
        # lets a later run tell "re-syncing the same Granola meeting" apart
        # from "a different meeting collided on the same computed stem".
        "granola_id": meeting.get("id"),
    })
    md = [fm, ""]
    md += ["## Summary", "", summary or "_(migrated from Granola)_", ""]
    md += ["## Participants", "", ", ".join(parts), ""]
    md += ["## Key Topics", "", ""]
    md += ["## Key Points", "", ""]
    md += ["## Action Items", "", ""]
    md += ["## Transcript", "", transcript, ""]
    md += ["## User Notes", "", ""]
    summary_md = "\n".join(md)

    header = (
        f"Session: {title}\nFile: {stem}\n"
        f"Date: {date_iso.replace('T', ' ')}\n"
        f"Language setting: {language}\nDetected language: {language}\n"
        f"Summary output language: {language}\n"
        + "=" * 60 + "\n"
    )
    transcript_txt = header + transcript + "\n"
    return stem, summary_md, transcript_txt


def load_meeting(folder: Path):
    meta = {}
    mp = folder / "meta.txt"
    if mp.exists():
        for line in mp.read_text(encoding="utf-8").splitlines():
            if "\t" in line:
                k, v = line.split("\t", 1)
                meta[k.strip().lower()] = v.strip()
    parts = []
    if meta.get("participants"):
        parts = [p.strip() for p in re.split(r"[;|]", meta["participants"]) if p.strip()]
    summary = ""
    for cand in ("summary.txt", "summary.md"):
        sp = folder / cand
        if sp.exists():
            summary = sp.read_text(encoding="utf-8")
            break
    transcript = ""
    tp = folder / "transcript.txt"
    if tp.exists():
        transcript = tp.read_text(encoding="utf-8")
    return {
        "id": folder.name,
        "title": meta.get("title", ""),
        "date_raw": meta.get("date", ""),
        "participants": parts,
        "summary": summary,
        "transcript": transcript,
    }


def _stem_owner(md_path: Path):
    """Return the granola_id recorded in an existing Steno file's frontmatter,
    or None if the file has no such marker (pre-upgrade file, or unrelated
    content). Used to distinguish a re-sync of the same meeting from a
    same-stem collision with something else."""
    try:
        content = md_path.read_text(encoding="utf-8")
    except OSError:
        return None
    if not content.startswith("---"):
        return None
    parts = content.split("---", 2)
    if len(parts) < 3:
        return None
    for line in parts[1].strip().splitlines():
        if line.startswith("granola_id:"):
            value = line.split(":", 1)[1].strip()
            return value.strip('"') or None
    return None


def _stem_taken(out_dir: Path, candidate: str, source_id: str, seen: set) -> bool:
    if candidate in seen:
        return True
    existing = out_dir / f"{candidate}_summary.md"
    return existing.exists() and _stem_owner(existing) != source_id


def resolve_stem(out_dir: Path, stem: str, source_id: str, seen: set) -> str:
    """Pick the stem to actually write under. A stem collides if it was
    already claimed earlier in this run, or if a file for it already exists on
    disk and belongs (per its granola_id) to a different meeting -- including
    files with no marker at all, which are treated conservatively as foreign
    rather than silently overwritten. On collision, suffix with (a prefix of)
    the source meeting's own id so repeated runs land on the same name.

    The suffixed candidate is checked for uniqueness too: two different ids
    can share their first few characters, so a short prefix alone isn't
    guaranteed free. We widen the prefix and, in the pathological case where
    even the full id is taken, fall back to a deterministic counter -- never
    randomness, so the same input always resolves to the same final stem."""
    if not _stem_taken(out_dir, stem, source_id, seen):
        return stem

    sid = source_id or "dup"
    tried_ids = []
    for length in (6, 8, len(sid)):
        candidate_id = sid[:length]
        if candidate_id in tried_ids:
            continue
        tried_ids.append(candidate_id)
        candidate = f"{stem}-{candidate_id}"
        if not _stem_taken(out_dir, candidate, source_id, seen):
            return candidate

    counter = 2
    while True:
        candidate = f"{stem}-{sid}-{counter}"
        if not _stem_taken(out_dir, candidate, source_id, seen):
            return candidate
        counter += 1


def main():
    ap = argparse.ArgumentParser(description="Render Steno files from staged Granola meetings.")
    ap.add_argument("input_dir")
    ap.add_argument("target_dir")
    ap.add_argument("--language", default="en",
                    help="Language code written to the frontmatter and transcript header (default: en).")
    args = ap.parse_args()

    in_dir = Path(args.input_dir)
    target = Path(args.target_dir)
    out_dir = target / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    tr_dir = target / "transcripts"
    tr_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    seen = set()
    for folder in sorted(p for p in in_dir.iterdir() if p.is_dir()):
        if not (folder / "meta.txt").exists():
            continue
        meeting = load_meeting(folder)
        if not meeting["title"]:
            print(f"  ! skip {folder.name} (no title)")
            continue
        stem, smd, ttxt = build(meeting, language=args.language)
        final_stem = resolve_stem(out_dir, stem, meeting["id"], seen)
        if final_stem != stem:
            ttxt = ttxt.replace(f"File: {stem}\n", f"File: {final_stem}\n", 1)
        seen.add(final_stem)
        (out_dir / f"{final_stem}_summary.md").write_text(smd, encoding="utf-8")
        (tr_dir / f"{final_stem}_transcript.txt").write_text(ttxt, encoding="utf-8")
        n += 1
    print(f"Done: {n} meeting(s) -> {target}")


if __name__ == "__main__":
    main()
