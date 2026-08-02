# steno

A skill that makes an AI agent aware of your local
[Steno](https://github.com/stenolabs/stenoai) meeting notes, so you can run
`/steno` (or just mention your meetings) and have the agent pull the right notes
in and act on them — answer a question, recap your week, extract action items, or
use the meetings as source material to draft a spec, PRD, or follow-up.

Steno records and transcribes entirely on-device; this skill only **reads** the
files it already writes. It never modifies, moves, or deletes anything.

## What you can ask it

- **Answer across meetings** — *"/steno what did we decide about pricing?"*
- **Pull one meeting in** — *"/steno summarize the Acme call"* (with transcript if needed)
- **Recap a range** — *"/steno recap this week's meetings"*
- **Extract action items / decisions** — *"/steno my open action items from this week"*
- **Ground a document in real meetings** — *"/steno write a spec from the Acme discovery calls"*
- **Set up a cloud model** — *"/steno setup"* / *"help me configure Bedrock in Steno"* — a guided
  walkthrough for OpenAI, Anthropic, AWS Bedrock, or a custom endpoint (see
  `references/provider-setup.md`).

Under the hood, the notes functions use one read-only CLI (`scripts/steno.py`:
`locate` / `list` / `read` / `search` / `folders`) to find and pull the notes,
then the agent does the reasoning. Setup is guidance only — it never changes your
config or touches AWS.

## Requirements

- **Python 3.8+** — standard library only. **No dependencies, no `pip install`,
  no venv.** (If you have [`uv`](https://docs.astral.sh/uv/), `uv run` works too
  and will fetch a Python for you if you don't have one — see below.)
- Steno installed and used on the same machine (so there are notes to read).

## Install

There's no build or package step — the skill is a **self-contained folder**
(`SKILL.md` + `scripts/steno.py`). "Installing" just means putting it where your
agent looks for skills:

- **Claude Code:** copy the `steno/` folder into `~/.claude/skills/` (personal,
  available everywhere) or a project's `.claude/skills/` (that repo only):
  ```bash
  cp -r skills/steno ~/.claude/skills/steno
  ```
  Then run `/steno <request>`, or just mention your meetings and the agent uses
  it automatically (it's matched by the description in `SKILL.md`).
- **Any other agent / manually:** nothing to install — run `scripts/steno.py`
  directly and point your agent at it.

## Running the CLI (two equivalent ways)

```bash
# Plain Python — works anywhere Python 3.8+ is on PATH:
python3 scripts/steno.py locate

# Or with uv (bootstraps a Python if you don't have one; reads the PEP 723
# metadata in the script — still zero third-party deps):
uv run scripts/steno.py locate
```

## Use the CLI directly

```bash
cd steno
python3 scripts/steno.py locate                  # confirm it found your notes
python3 scripts/steno.py list --since 2026-07-01
python3 scripts/steno.py read "acme" -t          # summary + transcript
python3 scripts/steno.py search "action items" -t --json
python3 scripts/steno.py folders
```

If `locate` reports 0 meetings, point it at the store:

```bash
python3 scripts/steno.py --notes-dir "/path/to/your/steno" list
# or the same override Steno uses:
STENOAI_USER_DATA_DIR="/path/to/your/steno" python3 scripts/steno.py list
```

Every command accepts `--json` for machine-readable output.

## Privacy

Your meetings never leave your device through this skill — it only reads local
files. Whether an agent *using* this skill sends any of that content elsewhere is
up to that agent and how you run it; treat summaries and transcripts as
confidential.
