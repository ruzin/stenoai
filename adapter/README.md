# Steno enterprise adapter

Self-hosted FastAPI service that brokers AI keys, S3 uploads, and shared
meeting metadata for a single customer's Steno deployment. The Steno
desktop never sees the provider key or AWS credentials — every privileged
operation goes through this service.

One adapter == one customer organisation. Customers run it in their own
environment (laptop, VPC, on-prem) with their own AWS bucket, their own
Anthropic key, and their own Google Workspace tying SSO to their domain.

For customer-facing deployment instructions see **`customer-setup.md`**.
This README covers what's in the repo and how to develop against it.

## Layout

```
adapter/
├── docker-compose.yml      single service (the adapter container)
├── Dockerfile              python:3.11-slim + FastAPI + boto3 + anthropic + pyjwt + httpx
├── requirements.txt
├── .env.example            JWT secret, Anthropic key, AWS creds, S3 bucket, Google OIDC config
├── customer-setup.md       step-by-step guide for a customer IT lead
├── app/
│   ├── main.py             FastAPI app, route wiring, /health
│   ├── security.py         HS256 session JWT (issued by /auth/login + /auth/sso/google/callback)
│   ├── store.py            JSON-file meeting store with org-visibility filter
│   ├── s3.py               boto3 wrappers — presigned PUT/GET, server-side get-object-text, delete
│   ├── users.json          Optional hardcoded fallback users for /auth/login (dev convenience)
│   └── routes/
│       ├── auth.py         POST /auth/login              (password — kept for dev / fallback)
│       ├── sso.py          POST /auth/sso/google/start   (mints Google authorize URL)
│       │                   POST /auth/sso/google/callback (code exchange + ID-token verify)
│       ├── meetings.py     CRUD + visibility patch + owner-only delete
│       ├── uploads.py      POST /uploads/presign         (presigned PUT URL)
│       └── ai.py           POST /ai/chat                 (one-shot Claude proxy)
│                           POST /ai/chat/stream          (NDJSON token stream)
└── dev-tools/
    ├── seed_sales_calls.py Fills the store with sample notes for testing
    └── web-tester.html     Vanilla-JS adapter tester — no Steno install needed
```

## Run locally for development

```bash
cd adapter
cp .env.example .env
# Fill in at minimum: JWT_SECRET, ANTHROPIC_API_KEY.
# AWS_* + S3_BUCKET are optional — without them /uploads/presign returns 503
# but everything else still works.
# Google OIDC vars are optional too — leave blank to disable the SSO flow.

docker compose up --build
```

Health check:

```bash
curl http://localhost:8000/health
# {
#   "status": "ok",
#   "service": "steno-adapter",
#   "org_id_allowlist": ["yourdomain.com"],
#   "s3_configured": true,
#   "anthropic_configured": true,
#   "google_oidc_configured": true
# }
```

Two ways to drive it:

- **Steno desktop** (`Settings → Organisation → Adapter URL`, then *Sign
  in with Google* or *Sign in with password*).
- **`dev-tools/web-tester.html`** — opens in any browser, two-pane Alice/Bob
  UI for round-tripping the password-auth, meetings, presign, and chat
  endpoints. Useful for debugging the adapter in isolation from the desktop.

## Endpoint reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + config flags |
| POST | `/auth/login` | Password sign-in (returns session JWT) |
| GET | `/auth/me` | Current session inspection |
| POST | `/auth/sso/google/start` | Build Google authorize URL given desktop loopback redirect + PKCE |
| POST | `/auth/sso/google/callback` | Exchange code → verify ID token → mint session JWT |
| GET | `/meetings` | List meetings visible to caller (owner OR org-shared) |
| POST | `/meetings` | Create a meeting (inline body or with `s3_key`) |
| GET | `/meetings/{id}` | Get one meeting — body inlined from S3 if needed |
| PATCH | `/meetings/{id}/visibility` | Owner-only visibility toggle |
| DELETE | `/meetings/{id}` | Owner-only unshare (also deletes the S3 object) |
| POST | `/uploads/presign` | Presigned PUT URL for an artifact |
| POST | `/ai/chat` | One-shot Claude proxy |
| POST | `/ai/chat/stream` | NDJSON streaming Claude proxy |

All endpoints under `/auth/*` are unauthenticated. Everything else requires
`Authorization: Bearer <session-jwt>`.

## Design notes

- **Single-tenant.** One adapter, one customer, one `ORG_ID_ALLOWLIST`.
  Avoids multi-tenant complexity (per-tenant key vault, audit isolation)
  until there's actual demand.
- **JWT, not session cookies.** Steno desktop is a non-browser client —
  bearer tokens are simpler to plumb through `child_process.spawn`.
- **Presigned URLs, not uploads through the adapter.** Audio files can
  be hundreds of MB; the adapter brokers, S3 carries the bytes.
- **Server-side S3 read for shared note bodies.** The adapter inlines
  the body on `GET /meetings/{id}` rather than handing a presigned GET
  URL to the renderer — keeps the renderer out of the AWS path entirely
  and avoids cross-origin fetch quirks in Electron.
- **Org-wide visibility in the metadata layer.** `visibility ∈ {private, org}`
  plus an `org_id` (set from the user's authenticated Workspace domain).
  RBAC v2 will add a `team_id` and members table; the visibility filter
  becomes `owner OR team OR org` — same shape, one extra clause.
- **Claude as the proxy default.** Customer can swap to OpenAI by editing
  `routes/ai.py` — the wire contract on the desktop side stays the same.

## Path to production

| Layer | Current | Production |
|---|---|---|
| Auth (sign-in) | HS256 session JWT after Google OIDC code exchange | Same. Optionally swap session JWT for opaque refresh-tokens + a session store if you want forceful revoke. |
| Auth (alt path) | `/auth/login` with hardcoded `users.json` | Kept for dev / break-glass. Disable in customer deployments by removing the route. |
| Storage | `store.json` on a Docker volume | DynamoDB or RDS Postgres. Same `store.py` interface — swap the read/write functions. |
| Compute | local docker compose | ECS Fargate / App Runner / on-prem container host behind a reverse proxy with TLS |
| Secrets | `.env` | AWS Secrets Manager + IAM task role |
| Tenancy | one stack | one stack per customer (CDK/Terraform module) |
| Identity | Google OIDC | + SAML for legacy IdPs (Active Directory, ForgeRock); + SCIM for provisioning |
| Search | basic SQL-style listing | OpenSearch k-NN or Postgres + pgvector |
| Audit | stdout logs | Structured logs → customer's SIEM; per-action audit trail in dedicated S3 bucket |

## Dev-tools

- **`dev-tools/seed_sales_calls.py`** — populates an adapter with sample
  meeting summaries (AI-for-call-centres sales calls) so a fresh
  install has content to chat across. Logs in as the hardcoded `users.json`
  alice, then presigns + uploads + registers each note.

  ```bash
  cd adapter
  .venv/bin/python dev-tools/seed_sales_calls.py
  ```

- **`dev-tools/web-tester.html`** — vanilla-JS two-pane tester. Open in any
  browser pointed at `localhost:8000`. Lets two users sign in (password
  flow), share/list notes, chat, without needing Steno installed.
