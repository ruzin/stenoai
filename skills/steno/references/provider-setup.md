# Setting up a cloud model for Steno

Steno summarizes locally by default (Ollama). It can instead use a **cloud model**
for summarization + chat: **OpenAI**, **Anthropic**, **AWS Bedrock**, or a
**custom OpenAI-compatible endpoint**. Everything below is entered in Steno →
**Settings → AI**, and stored in Steno's `config.json` — these are **not** OS
environment variables. Only the transcript and any typed notes are sent to the
provider; **never audio**.

Pick the section for the provider the user wants. OpenAI and Anthropic are a
one-key setup; Bedrock needs three values and is the involved one.

> **Never have the user paste an API key into the chat.** Have them enter it
> directly in Steno's Settings. If one is pasted anyway, treat it as a secret —
> don't echo, log, or store it — and suggest rotating it.

---

## OpenAI

1. Create an API key: <https://platform.openai.com/api-keys> → "Create new secret
   key". Copy it (shown once).
2. In Steno: **Settings → AI → select OpenAI** → paste the **API key** → pick a
   **model** from the list (e.g. a current GPT model) → Save.
3. Generate a summary on any meeting to confirm.

Needs: just the API key + a model. Billing must be active on the OpenAI account.

---

## Anthropic

1. Create an API key: <https://console.anthropic.com/settings/keys> → "Create
   Key". Copy it.
2. In Steno: **Settings → AI → select Anthropic** → paste the **API key** → pick
   a **Claude model** from the list → Save.
3. Generate a summary to confirm.

Needs: just the API key + a model.

---

## AWS Bedrock

Steno calls Bedrock's **Converse REST endpoint** with a **Bedrock API key**
(bearer token, `Authorization: Bearer <key>`) — **no boto3, no AWS access
key/secret, no SigV4**. You configure three values.

### The three values

| Steno field | What it is | Example |
|---|---|---|
| **Region** | AWS region hosting your Bedrock endpoint (default `us-east-1`) | `eu-west-2` |
| **Model / inference profile** | a model/inference-profile **id**, or an **application-inference-profile ARN** | `us.anthropic.claude-sonnet-4-20250514-v1:0` or `arn:aws:bedrock:eu-west-2:123456789012:application-inference-profile/abc123` |
| **API key** | a Bedrock **long-term API key** (bearer token) | `ABSKQmVk…` |

### Walkthrough (AWS console — destinations, not exact clicks; the UI shifts)

1. **Enable model access — per region.** AWS Console → **Amazon Bedrock**
   (<https://console.aws.amazon.com/bedrock>) → **Model access** → enable the
   models you want (e.g. Anthropic Claude). Access is granted **per region**, so
   enable it in the region you'll use. This is the #1 cause of later
   "access denied" errors.
2. **Pick the region** you enabled — that's Steno's **Region** field.
3. **Get the model / inference profile** (Steno's second field):
   - Simplest: a model or **cross-region inference-profile id** from the model
     catalog / **Inference profiles** (they look like `us.anthropic.claude-…` /
     `eu.anthropic.claude-…`).
   - Or, if you made an **application inference profile** (for cost allocation),
     open it and copy its **ARN**
     (`arn:aws:bedrock:<region>:<account>:application-inference-profile/<id>`).
   - Paste the **raw** id or ARN into Steno — don't URL-encode it; Steno encodes
     the ARN correctly when it builds the request (past bug #299).
4. **Generate a Bedrock API key.** Bedrock console → **API keys** → create a
   **long-term** key. Its IAM identity needs `bedrock:InvokeModel` on the chosen
   model/profile. Copy it now (usually shown once). This is Steno's **API key**.
   - (If the user already uses Bedrock from a shell, AWS's standard env var for
     this same key is `AWS_BEARER_TOKEN_BEDROCK` — but Steno takes it in Settings,
     not from the environment.)
5. **Enter into Steno.** Settings → AI → **AWS Bedrock** → paste Region, Model /
   inference profile, and API key → Save → generate a summary to confirm.

### IAM, in one line

The API key's identity needs **`bedrock:InvokeModel`** (and, for an inference
profile, permission on the profile ARN + its underlying model), plus **model
access enabled in that region**. No S3, no other services.

### Bedrock troubleshooting

- **403 / AccessDenied** → model access not enabled *in that region*, or the key's
  IAM identity lacks `bedrock:InvokeModel` / access to the inference profile.
- **"model not found" / wrong output** → region doesn't match the inference
  profile's region (profiles are region-scoped), or a typo in the id/ARN.
- **Malformed-ARN / odd URL errors** → paste the **raw** ARN with its literal `/`,
  not a URL-encoded one.
- **OpenAI/Anthropic work but Bedrock doesn't** → those need only a key; Bedrock
  also needs the correct region + model/profile. Recheck all three.

---

## Custom (OpenAI-compatible endpoint)

For a self-hosted or third-party OpenAI-compatible API:

1. In Steno: **Settings → AI → select Custom** → set the **Base URL** (the
   OpenAI-compatible endpoint), the **API key**, and the **model** name the
   endpoint expects → Save.
2. Generate a summary to confirm.

---

## After any provider

- Send a test summary on a real meeting; if it fails, read the error and use the
  provider's troubleshooting above.
- The default local pipeline (Ollama) still works offline — switching to cloud is
  reversible in the same Settings screen.
