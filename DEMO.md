# Steno × enam.co — demo runbook

What's in this branch: the Steno desktop app, an enterprise adapter
service, and the wiring between them. Use this doc to stand up a working
two-user demo on a single Mac.

## What the demo proves

- Steno records and transcribes 100% locally.
- For shared notes, the desktop talks to a customer-hosted **adapter**.
  The adapter holds the Anthropic API key and the AWS credentials —
  Steno on the user's Mac never sees either.
- A note shared with the org lives in the customer's S3 bucket, fetched
  via short-lived presigned URLs the adapter mints on demand.
- Org chat (in the Chat tab under the *Shared notes* scope, or inside a
  shared note's detail view) streams through the adapter's central
  Anthropic key.

## Prereqs

- macOS on Apple Silicon
- Docker Desktop running
- An Anthropic API key
- AWS credentials with `s3:PutObject` + `s3:GetObject` on the demo bucket
  (the seeded credentials in `adapter/.env` work today)

## 1. Run the adapter

```bash
cd adapter
cp .env.example .env       # only on a fresh checkout — keys already in place if not
docker compose up --build
```

The adapter listens on `http://localhost:8000`. Health check:

```bash
curl -s http://localhost:8000/health
# {"status":"ok","service":"steno-adapter","org":"enam.co",
#  "s3_configured":true,"anthropic_configured":true}
```

The bucket is `s3://stenoai-enam-demo-567753` (eu-west-2). Standard
*private bucket + Block Public Access + AES256 SSE + presigned URLs*
setup — see `adapter/README.md` for the architecture detail.

## 2. Install Steno

Open `app/dist/stenoAI-macos-0.3.0-arm64.dmg` (built locally via the
DMG step on this branch) and drag *Steno.app* to Applications.

The DMG is unsigned, so the first launch:

1. Right-click *Steno.app* → **Open**
2. Click **Open** again on the Gatekeeper warning

After that, it launches normally.

## 3. Sign in to the demo org

Open Steno → **Settings → Organisation**:

| Field | Value |
|---|---|
| Adapter URL | `http://localhost:8000` |
| Email | `alice@enam.co` *(or `bob@enam.co`)* |
| Password | `demo` |

After sign-in you should see:
- A **Shared notes** row in the sidebar
- A profile chip (👩‍💼 Alice / 👨‍💼 Bob) bottom-left
- Greeting in the Chat tab adapts to whoever is signed in

The session is persisted (encrypted via Electron `safeStorage`). Sign in
once and survive an app restart.

## 4. Demo flow

The shared corpus is pre-seeded with six AI-for-call-centre sales calls
(`NorthBank`, `Helio Health`, `RetailCo`, `MutualPlus`, `FintechFlux`,
`PowerGrid`). Reset and re-seed with:

```bash
cd adapter
.venv/bin/python dev-tools/seed_sales_calls.py
```

Suggested narrative:

1. **Sign in as Alice**. Click **Shared notes**. Six notes visible.
2. Open *NorthBank Customer Care — Discovery Call*. Note the *from S3*
   tag in the header — body lives in the customer's bucket, the adapter
   served it server-side.
3. Use the **Ask** bar at the bottom of the note. Ask
   *"What's blocking the deal?"*. Streamed reply through Claude via the
   adapter's central key.
4. Switch to **Chat tab**. Change the scope picker to **Shared notes**.
   Ask a cross-corpus question:
   *"Which prospects flagged data-sovereignty concerns?"*
   Reply cites notes by title (no internal IDs).
5. Open any local meeting → *…* → **Share with enam.co**. Body uploads
   to S3 (presign → PUT in the main process; renderer never sees the
   AWS URL). Verify with:

   ```bash
   aws s3 ls s3://stenoai-enam-demo-567753/meetings/enam.co/
   ```

6. **Sign out**. Sign back in as **Bob**. The note Alice just shared
   appears in Bob's *Shared notes*.
7. Bob opens it — fresh presigned GET handed to the renderer; nothing
   was written to Bob's Mac.
8. *Optional:* Bob unshares one of his own notes via the `…` menu on the
   row — instant removal from the corpus + the S3 object.

## 5. Architecture quick-ref

```
┌─────────────────────────────────────────────────────────────────┐
│ Customer's environment (one stack per org)                      │
│                                                                 │
│  ┌─────────────────┐         ┌──────────────────────────────┐   │
│  │ Steno desktop   │  HTTP   │ Adapter (FastAPI / docker)   │   │
│  │ (this Mac)      │ ──────▶ │  – /auth/login → JWT         │   │
│  │  • local rec    │  JWT    │  – /meetings (CRUD)          │   │
│  │  • org-mode IPC │         │  – /uploads/presign          │   │
│  │  • AskBar       │         │  – /ai/chat /ai/chat/stream  │   │
│  └─────────────────┘         └────┬─────────────┬───────────┘   │
│                                   │             │               │
│                          presign  │             │ central key   │
│                                   ▼             ▼               │
│                          ┌──────────────┐  ┌──────────┐         │
│                          │ S3 bucket    │  │ Anthropic│         │
│                          │ (SSE-AES256) │  │ Messages │         │
│                          └──────────────┘  └──────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

The desktop never sees Anthropic or AWS credentials. The adapter
mediates all of it.

## 6. Common reset tasks

```bash
# wipe all shared notes (store + S3 objects)
echo "[]" > adapter/data/meetings.json
aws s3 rm s3://stenoai-enam-demo-567753/meetings/enam.co/ --recursive

# re-seed the AI-for-call-centre corpus
cd adapter && .venv/bin/python dev-tools/seed_sales_calls.py

# clear Steno's persisted org session (force re-login)
rm "$HOME/Library/Application Support/stenoai/.org-session"
```

## 7. Known demo-build caveats

- The DMG is **unsigned**. Right-click → Open the first time.
- The adapter on `localhost:8000` is only reachable from your laptop.
  For a two-Mac demo, `ngrok http 8000` and use the public URL in
  Steno's Settings → Organisation.
- For very short recordings (<10s), processing completes nearly
  instantly — the Processing page may flash by. Record at least 15
  seconds to see the analyser bar slide as tokens stream.
