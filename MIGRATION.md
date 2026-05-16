# Repo split — `stenoai` → `stenoai` + `stenoai-enterprise`

Plan for splitting the enterprise adapter out of the open-source repo into
its own **private** repository. To be executed *after* the Google OIDC work
on this branch lands and has been validated end-to-end. Until then the
adapter continues to live in `adapter/` here for fast iteration.

## Why split

| | OSS (`ruzin/stenoai`) | Enterprise (`ruzin/stenoai-enterprise`) |
|---|---|---|
| License | MIT | Commercial (private repo, paid) |
| Code | Electron desktop, Python recording / transcription / summarisation backend, renderer org-mode UI | Adapter (FastAPI), IaC (CDK/Terraform), customer-config templates, SSO wiring, RBAC, audit log |
| Secrets | None | Anthropic API key, AWS keys, OIDC client secrets, customer config |
| Releases | Public DMGs from GitHub Actions | Customer-pinned container images / Terraform modules |
| Contributors | Public PRs welcomed | Internal team + customers only |

The renderer org-mode code (Settings → Organisation tab, Sidebar *Shared
notes* row, AskBar org branch, OrgShared route, useOrg hooks, IPC channels)
is **already generic** — it just consumes an `adapter_url` + JWT. It stays
in OSS. Customers building their own adapter against the public contract
will use the same desktop code.

## What moves

```
stenoai/
├── adapter/                      ──▶  stenoai-enterprise/  (root)
└── DEMO.md                       ──▶  stenoai-enterprise/README.md
```

## What stays in OSS

```
app/main.js                         (org-* IPC handlers, deep-link)
app/preload.js                      (stenoai.org namespace)
app/renderer/src/lib/askBarContext.tsx
app/renderer/src/lib/ipc.ts         (Org* types)
app/renderer/src/lib/orgChat.ts
app/renderer/src/hooks/useOrg.ts
app/renderer/src/hooks/useStreamingQuery.ts (startOrgNoteStream branch)
app/renderer/src/components/Sidebar.tsx      (Shared notes row, ProfileChip)
app/renderer/src/components/AskBar.tsx       (org-meeting branch)
app/renderer/src/components/FolderScopePicker.tsx (Shared notes scope)
app/renderer/src/routes/Settings.tsx         (Organisation tab)
app/renderer/src/routes/OrgShared.tsx
app/renderer/src/routes/Chat.tsx + ChatConversation.tsx (org scope handling)
app/renderer/src/routes/MeetingDetail.tsx    (Share-to-org action)
app/docs/ipc-contract.md            (org-* channels documented)
```

A new `docs/enterprise.md` in OSS pitches the enterprise option without
exposing implementation:

> Steno supports an optional enterprise adapter for shared notes, central
> AI-key management, SSO (Google OIDC), and S3-backed storage in your own
> AWS account. The desktop client speaks a documented HTTP contract
> (`docs/adapter-contract.md`) so you can build your own adapter, or
> contact us for the managed deployment kit.

## Execution steps

### 0. Prereqs

- Confirm Google OIDC end-to-end works on the current `demo-steno` branch.
- Merge any pending PRs touching adapter+renderer together so split commits
  don't get tangled.

### 1. Create the private repo

```bash
gh repo create ruzin/stenoai-enterprise \
  --private \
  --description "Steno enterprise adapter — self-hosted FastAPI service brokering AI keys, S3, SSO for customer deployments"
```

### 2. Extract `adapter/` with full history

```bash
# Fresh clone so the surgery doesn't touch the working repo.
git clone https://github.com/ruzin/stenoai.git /tmp/stenoai-enterprise-extract
cd /tmp/stenoai-enterprise-extract

# Keep only adapter/ + DEMO.md + MIGRATION.md (which becomes the new repo's history root).
# git filter-repo is faster, safer, and supported (install: brew install git-filter-repo).
git filter-repo \
  --path adapter \
  --path DEMO.md \
  --path-rename DEMO.md:README.md

# Push to the new origin.
git remote add origin git@github.com:ruzin/stenoai-enterprise.git
git branch -M main
git push -u origin main
```

### 3. Strip adapter from OSS, land org-mode renderer changes

```bash
cd ~/Code/stenoai
git checkout main
git pull --ff-only
git checkout -b chore/extract-adapter

git rm -rf adapter DEMO.md
git commit -m "chore: extract adapter to stenoai-enterprise repo

Adapter, IaC, and customer-facing demo runbook now live in the private
stenoai-enterprise repo. The renderer's org-mode UI stays in OSS and
talks to any adapter implementing the documented HTTP contract
(see docs/enterprise.md)."

# Open a PR for this commit + cherry-pick the demo-steno renderer changes.
git push -u origin chore/extract-adapter
gh pr create --base main --title "Extract enterprise adapter; land org-mode renderer surface"
```

The renderer org-mode work from `demo-steno` is cherry-picked / squash-
merged into this same PR (one clean addition to `main`).

### 4. Write `docs/enterprise.md` (OSS-side pitch) and `docs/adapter-contract.md` (the wire protocol the renderer expects)

`adapter-contract.md` is the OpenAPI-ish reference:
- Endpoints: `/health`, `/auth/login`, `/auth/sso/google/start`,
  `/auth/sso/google/callback`, `/meetings`, `/meetings/:id`,
  `/meetings/:id` (DELETE), `/uploads/presign`, `/ai/chat`,
  `/ai/chat/stream`
- JWT shape: `{ sub, name, org_id, iat, exp }`
- Error envelope: `{ detail }` on non-2xx
- Auth header: `Bearer <jwt>` on every protected route

Customer engineers reading the OSS repo can implement this contract
against their own backing service.

### 5. First commit in `stenoai-enterprise`

Move the `MIGRATION.md` itself to the new repo (or delete it from OSS —
the plan is now executed). Add a `README.md` at the root that summarises
deployment options, demo setup, and architecture (mostly content from
the OSS `DEMO.md`).

### 6. Lock down `stenoai-enterprise`

- Settings → Manage access: just `@ruzin` initially. Customers and team
  members get added per-deployment.
- Branch protections: PRs required on `main`, status checks, no force
  push.
- Actions: gated, no public secret leakage.

## Risks and rollbacks

| Risk | Mitigation |
|---|---|
| Lose adapter commit history | `git filter-repo` preserves it; verify with `git log` in the new repo before pushing. |
| OSS PR conflicts with concurrent work on `main` | Coordinate timing; do the OSS rm + renderer-merge in a single squash PR. |
| Customers can't find the enterprise repo | OSS `docs/enterprise.md` links to it; access is gated. |
| Need to demo from a single clone again | Add a `dev-clone.sh` script in `stenoai-enterprise` that clones the OSS desktop sibling-folder for end-to-end testing. |

## Out-of-scope (defer)

- Splitting CI workflows — copy-paste for now, refactor once the second
  enterprise feature lands.
- Moving the seed script (`adapter/dev-tools/seed_sales_calls.py`) —
  it's enterprise-only, goes with the adapter.
- Customer-specific config (allowed orgs, IdP client secrets) — these
  live in a per-deployment `.env`, never in the repo.
