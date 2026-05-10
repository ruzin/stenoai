# Steno enterprise adapter — demo

A self-hosted FastAPI service that brokers AI keys, S3 uploads, and shared
meeting metadata for an enterprise Steno deployment. The Steno desktop never
sees the provider key or AWS credentials.

This MVP targets a single demo customer (`enam.co`) with two seeded users.

## What's in here

```
adapter/
├── docker-compose.yml      single service: the adapter
├── Dockerfile              python:3.11-slim + FastAPI + boto3 + anthropic
├── requirements.txt
├── .env.example            JWT, Anthropic key, AWS creds, S3 bucket
├── app/
│   ├── main.py             FastAPI app + /health
│   ├── security.py         HS256 JWT (mock auth) + current_user dependency
│   ├── store.py            JSON-file meeting store with org-visibility filter
│   ├── s3.py               boto3 presigned PUT/GET helpers
│   ├── users.json          seeded enam.co users (alice, bob — both pw `demo`)
│   └── routes/
│       ├── auth.py         POST /auth/login, GET /auth/me
│       ├── meetings.py     CRUD + visibility patch
│       ├── uploads.py      POST /uploads/presign
│       └── ai.py           POST /ai/chat — Claude proxy
└── demo.html               two-pane Alice/Bob UI, talks to localhost:8000
```

## Run locally

```bash
cd adapter
cp .env.example .env
# edit .env — at minimum set JWT_SECRET and ANTHROPIC_API_KEY.
# AWS_*/S3_BUCKET are optional; without them, /uploads/presign returns 503
# but everything else (login, meetings, /ai/chat) works.

docker compose up --build
```

In another terminal:

```bash
curl http://localhost:8000/health
open demo.html      # macOS — opens the two-pane demo in your browser
```

## Two-user demo flow

1. Open `adapter/demo.html`. Both Alice and Bob panes are visible side-by-side.
2. Click **Sign in** in each pane (password is `demo`).
3. **Alice** creates a new note titled *Q1 board prep*, leaves visibility on `org-shared`, hits **Create note**.
4. **Bob** sees the note appear in his Shared Notes list (the adapter filters by `org_id == enam.co`).
5. Either user clicks the note to open it, then asks *"What was decided?"* — the adapter proxies the request to Claude using the central `ANTHROPIC_API_KEY` and returns the reply.

## Optional: enable S3

```bash
aws s3 mb s3://stenoai-enam-demo --region us-east-1
# put the bucket name in .env as S3_BUCKET=stenoai-enam-demo
# and AWS creds with s3:PutObject / s3:GetObject on it
docker compose restart
```

`POST /uploads/presign` then returns a 15-minute presigned PUT URL that the
desktop can upload directly to. `GET /meetings/:id` returns a presigned GET URL
on the artifact.

## Endpoints

| Method | Path                              | Auth | Purpose                                              |
|--------|-----------------------------------|------|------------------------------------------------------|
| GET    | /health                           | no   | service status + capability flags                    |
| POST   | /auth/login                       | no   | email + password → JWT (8h)                          |
| GET    | /auth/me                          | yes  | inspect the current token                            |
| GET    | /meetings                         | yes  | list meetings owner==me OR (org && visibility==org)  |
| POST   | /meetings                         | yes  | create a meeting (visibility default `org`)          |
| GET    | /meetings/{id}                    | yes  | full meeting with body + presigned GET if S3-backed  |
| PATCH  | /meetings/{id}/visibility         | yes  | owner toggles between `private` and `org`            |
| POST   | /uploads/presign                  | yes  | presigned S3 PUT URL for an artifact                 |
| POST   | /ai/chat                          | yes  | proxies to Anthropic with the central API key        |

## Why this shape

- **Self-hosted, single-tenant.** One `docker compose` stack per customer —
  matches the data-sovereignty story (keys + storage live in the customer's
  environment).
- **JWT, not session cookies.** Steno desktop is a non-browser client; bearer
  tokens are simpler to plumb through `child_process.spawn`.
- **Presigned URLs, not uploads through the adapter.** Audio files can be
  hundreds of MB. The adapter brokers; S3 carries the bytes.
- **Org-wide visibility in the metadata layer.** RBAC v2 adds a `team_id` and
  a `members` table; the visibility filter becomes
  `owner OR team OR org`. No schema reset.
- **Claude as the proxy default.** Customer can swap to OpenAI by editing
  `routes/ai.py` — the contract on the wire stays the same.

## Path to production

| Layer    | Demo                  | Production                                    |
|----------|-----------------------|-----------------------------------------------|
| Auth     | hardcoded users + HS256 JWT | OIDC against customer IdP (Okta / Azure AD / Cognito), JWT verified against JWKS |
| Storage  | `store.json`          | DynamoDB or RDS Postgres (vector-ready)       |
| Compute  | local docker compose  | ECS Fargate behind ALB, or App Runner         |
| Secrets  | `.env`                | AWS Secrets Manager + IAM task role           |
| Tenancy  | one stack             | one stack per customer (CDK/Terraform module) |
| Search   | n/a                   | OpenSearch k-NN or Postgres + pgvector        |
