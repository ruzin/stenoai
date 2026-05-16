# Steno enterprise adapter — customer setup

Step-by-step for the IT / Security lead at a new customer (e.g. enam.co).
Result: a running adapter in your environment, your employees signing in
with Google Workspace, shared meeting notes stored in your S3 bucket, AI
key managed centrally by you. Steno on each Mac never sees AWS creds or
AI provider keys.

Expected time end-to-end: 60–90 minutes. Most of it is Google Cloud and
AWS console clicks.

## Prerequisites

- A **Google Workspace** account with admin access (to the Cloud Console
  and the Admin Console).
- An **AWS account** with permission to create S3 buckets and IAM users.
  Account ID handy.
- An **Anthropic API key** for your organisation (https://console.anthropic.com).
  If you're already paying Anthropic, generate a fresh key for Steno
  rather than reusing an existing one.
- A host to run the adapter on — Docker available, exposed on a URL your
  employees' Macs can reach. Examples:
    - Internal VM with reverse proxy
    - AWS App Runner or ECS Fargate
    - Anywhere that can run `docker compose up` and serve HTTPS
- Control of a DNS hostname for the adapter
  (e.g. `steno-adapter.enam.co`). TLS required in production.

## Step 1 — Google Cloud: OAuth client for Steno sign-in

The adapter authenticates users via Google OIDC. This step gets you a
client ID + client secret scoped to *just* sign-in (don't reuse a Calendar
or other-purpose client).

1. https://console.cloud.google.com — create or pick a project. Suggested
   name: *Steno SSO*.
2. **Google Auth Platform → Branding** (or the older *OAuth consent screen*):
    - User type: **Internal** (recommended for Workspace — restricts
      sign-in to your domain by Google).
    - App name, support email, logo, privacy policy link — your standard
      enterprise app metadata.
3. **Google Auth Platform → Clients → + Create client**:
    - Application type: **Desktop application**
    - Name: *Steno desktop*
    - Save. A modal shows the **Client ID** and **Client secret** —
      copy both, store in your secret manager. Google won't show the
      secret again after this dialog closes.
4. **Google Auth Platform → Audience**:
    - If you set User type *Internal*, you're done — every `@yourdomain`
      account can sign in.
    - If User type is *External*, **Publish app** (otherwise only listed
      test users can sign in). Internal is strongly preferred for
      enterprise use.

> **Domain attestation.** Steno's adapter trusts the `hd` claim in the
> Google ID token, which Google sets *only* for accounts in your Workspace.
> An attacker creating `evil@yourdomain` on a free Gmail can't fake this —
> they'd need DNS control to add the domain to a Workspace.

### Optional: domain-wide pre-approval

Skip the per-user consent screen entirely by pre-approving the OAuth
client at the Workspace level.

- **Admin Console → Security → Access and data control → API controls → App access control**
- Add the client ID, scope `Trusted: Can access all Google services`
  (or just the OIDC scopes), apply org-wide.

Result: employees clicking *Sign in with Google* in Steno go straight
through with no consent prompt.

## Step 2 — AWS: S3 bucket + IAM user

Customer-owned storage for shared meeting notes. Steno never holds these
credentials — only the adapter does.

```bash
# Set once for the rest of the commands.
export REGION=eu-west-2                  # or your preferred region
export BUCKET=steno-notes-${YOUR_ACCOUNT_ID}     # globally unique
export USER=steno-adapter

# Create the bucket, blocked from public access, with server-side encryption.
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Optional but recommended in regulated environments: SSE-KMS instead of
# SSE-S3 so you control the encryption key and audit usage.
# aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration ...

# CORS — so the adapter can mint presigned URLs the desktop can hit.
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}'

# IAM user with least-privilege policy (just this bucket).
aws iam create-user --user-name "$USER"
aws iam put-user-policy --user-name "$USER" --policy-name s3-bucket-access \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\"],
        \"Resource\": \"arn:aws:s3:::$BUCKET/*\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:ListBucket\"],
        \"Resource\": \"arn:aws:s3:::$BUCKET\"
      }
    ]
  }"

aws iam create-access-key --user-name "$USER"
# Capture AccessKeyId + SecretAccessKey from the output.
```

If you'd prefer an IAM **role** with an instance profile (e.g. ECS task
role), use that instead — the adapter respects the standard AWS SDK
credential chain, so no `.env` changes are needed when running with a
role.

## Step 3 — Anthropic API key

Single key, held by the adapter, used for all your employees. Steno on
each Mac calls `POST /ai/chat` on the adapter, which forwards to
Anthropic — the desktop never sees the key.

- https://console.anthropic.com → **API keys → Create key**
- Name it *Steno adapter (production)*
- Copy the value. You won't see it again.
- Set a usage cap matching your expected employee count.

## Step 4 — Deploy the adapter

`docker compose up` is the simplest start. Production deployments will
front this with TLS (Cloudflare Tunnel, ALB + ACM cert, or any reverse
proxy).

```bash
# On your adapter host:
git clone <stenoai-enterprise repo URL>
cd stenoai-enterprise/adapter
cp .env.example .env
```

Edit `.env`:

```
JWT_SECRET=<openssl rand -hex 32>                 # used to sign adapter session JWTs

ANTHROPIC_API_KEY=<from step 3>

AWS_ACCESS_KEY_ID=<from step 2>
AWS_SECRET_ACCESS_KEY=<from step 2>
AWS_REGION=eu-west-2
S3_BUCKET=steno-notes-<your account>

GOOGLE_OIDC_CLIENT_ID=<from step 1>
GOOGLE_OIDC_CLIENT_SECRET=<from step 1>
ORG_ID_ALLOWLIST=yourdomain.com           # comma-separated if multi-domain Workspace
OIDC_ALLOW_NON_WORKSPACE=false            # MUST be false in prod
```

Bring it up:

```bash
docker compose up --build -d
curl -s https://steno-adapter.yourdomain.com/health
# Expect: {"status":"ok","google_oidc_configured":true,"s3_configured":true,"anthropic_configured":true,...}
```

### TLS

In production the adapter MUST run behind HTTPS:

- Google's OAuth flow forbids non-HTTPS redirects to anything other than
  `127.0.0.1` (the desktop loopback works on plain HTTP because it never
  leaves the user's Mac — that part stays HTTP for the loopback step).
- The desktop → adapter calls (`/auth/sso/google/callback`, `/meetings`,
  `/ai/chat`, etc.) MUST be HTTPS. Don't run the adapter on plain HTTP
  in production.

Easiest options:
- **Cloudflare Tunnel** — `cloudflared` runs alongside the adapter,
  exposes it on `https://steno-adapter.yourdomain.com` with a managed
  certificate, no inbound firewall changes.
- **AWS ALB** + ACM certificate + ECS Fargate task.
- **Traefik / Caddy / nginx** in front of `docker compose` with
  Let's Encrypt.

## Step 5 — Configure Steno on every employee Mac

Two paths:

### Manual (per-Mac, for small rollouts)

Each employee:
1. Install Steno (DMG).
2. Open **Settings → Organisation**.
3. Adapter URL: `https://steno-adapter.yourdomain.com`
4. Click **Sign in with Google** → completes in browser → session lands.

### MDM-managed (for org-wide rollouts)

If you push Steno via Jamf / Kandji / Intune, you can pre-seed the
adapter URL so users don't have to type it. Place a JSON config under
`~/Library/Application Support/stenoai/managed-config.json`:

```json
{ "orgAdapterUrl": "https://steno-adapter.yourdomain.com" }
```

(*Roadmap item — confirm support in your Steno build version.*)

## Step 6 — Day-2 operations

### Rotating secrets

- **Google client secret**: in Google Cloud → Clients → your client →
  *Add secret*. Update `.env`, `docker compose up -d`. Old secret stays
  valid for 24 h so there's zero-downtime overlap, then revoke it.
- **AWS access keys**: `aws iam create-access-key` → update `.env` →
  redeploy → `aws iam delete-access-key` for the old one.
- **Anthropic key**: console → rotate → update `.env` → redeploy.
- **JWT_SECRET**: regenerating invalidates every existing user session.
  Use sparingly; users will need to sign in again.

### Revoking a user

- Workspace admin disables the user's account → their next sign-in fails
  at Google's end.
- The adapter session JWT they currently hold remains valid until its
  `exp` (default 8 h). To shorten this, set `JWT_TTL_SECONDS` in the
  adapter env (in `app/security.py` today; consider promoting to env
  before going to prod).

### Auditing

- Adapter logs to stdout — capture with your logging stack (Datadog,
  CloudWatch, whatever). Every `/meetings`, `/ai/chat`, `/uploads/*` call
  is logged with the caller's email.
- S3 server access logging or CloudTrail data events on the bucket give
  you a separate paper trail for the actual artifact reads/writes.

### Backups

- `data/meetings.json` (metadata) is the only piece of state the
  adapter writes locally. Mount it on a volume that survives container
  restarts. Snapshot it nightly.
- Production deployments should swap `app/store.py` for DynamoDB or RDS
  Postgres — easier ops, better concurrency. Tracked in the enterprise
  backlog.

## Hardening checklist before going live

- [ ] TLS in front of the adapter — never `http://` for non-loopback callers.
- [ ] `OIDC_ALLOW_NON_WORKSPACE=false` in `.env`.
- [ ] `ORG_ID_ALLOWLIST` set to *only* your Workspace domain(s).
- [ ] Bucket Block Public Access verified (`aws s3api get-public-access-block`).
- [ ] CORS `AllowedOrigins` tightened from `*` to your Steno install range
      if you serve Steno via a managed origin; loopback presigned PUT
      from Electron's renderer needs * unless you proxy.
- [ ] IAM user policy scoped to bucket-only, no `s3:*`.
- [ ] Anthropic usage cap set.
- [ ] JWT_SECRET is a 32-byte random value, not the example string.
- [ ] Logs being shipped to your central logging tool.
- [ ] Backup / snapshot of `data/meetings.json` configured.

## Common errors

| Symptom | Likely cause |
|---|---|
| `redirect_uri_mismatch` from Google | Desktop client OAuth type doesn't list the loopback URI Steno is using. Recreate the client as *Desktop application* (not Web). |
| `Email domain 'x' is not in this adapter's allowlist` (403) | Either the signed-in user is from a different Workspace, or `ORG_ID_ALLOWLIST` is wrong in `.env`. |
| `This account isn't a Google Workspace account` (403) | User signed in with personal Gmail; in prod with `OIDC_ALLOW_NON_WORKSPACE=false` this is intentional. |
| `s3 upload failed (403)` when sharing a note | IAM user lacks `s3:PutObject` on the bucket; double-check the inline policy. |
| `/ai/chat` returns 502 | Anthropic key invalid or rate-limited. Check the adapter logs for the upstream error. |
| Sidebar shows "Shared notes" but list is empty for all users | First-run state. Have someone share a note from Steno (`...` menu → *Share with org*) to populate it. |
| Session disappears after restart | Steno failed to write to `~/Library/Application Support/stenoai/.org-session` — usually a permissions issue. Check the Steno log via Settings → Developer. |

## What's not covered yet

- **SAML** for IdPs that don't expose OIDC (Active Directory Federation
  Services without OIDC, legacy SAML-only providers). On the enterprise
  roadmap.
- **SCIM provisioning** — auto-provision/deprovision Steno users from
  your IdP. Roadmap.
- **Audit log export** to a customer-controlled S3 bucket. Roadmap.
- **Multi-tenant adapter** — today one adapter == one customer. Roadmap
  if there's demand from MSPs / consultancies.

For roadmap requests or deployment help, contact your Steno enterprise
support channel.
