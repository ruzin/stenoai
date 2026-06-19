# Plan — Chat model accuracy, local chat, and a new default model

_Drafted 2026-06-19. Source: discussion around issue #198 + PR #205._

Four independent workstreams. Each is its own branch + PR (own luffy run). Sequence:
**WS0 → WS1 → WS2 → WS3** (WS2/WS3 can run in parallel after WS0/WS1 land).

Locked decisions:
- New default summarization model: **`gemma4:e2b-it-qat`** (already in the registry; 2B, 128K ctx, 4.3GB).
- Local models in cross-note chat: **enable, but cap the assembled context** to fit the local model's window.
- Chat model indicator: **accurate display only** (no in-Chat picker).

---

## WS0 — Merge PR #205 (prereq, no new code)

#205 fixes the Settings OpenAI model list (sort newest-first, chat-only filter, cap 25).
It is OpenAI-specific by design — Anthropic (`client.models.list(limit=10)`, recent-first)
and Bedrock (curated `SUPPORTED_BEDROCK_MODELS`) are already clean. Green + cubic-approved.

- **Action:** merge #205 (blocked only on the review gate). Everything below assumes the
  good Settings list exists.

---

## WS1 — Swap the default summarization model to `gemma4:e2b-it-qat`

**Why:** `llama3.2:3b` is the current default; we want Gemma as the out-of-box model.

**Touch:**
- `src/config.py:112` — `DEFAULT_MODEL = "gemma4:e2b-it-qat"`.
- `src/config.py` `SUPPORTED_MODELS` (~:118) — move `gemma4:e2b-it-qat` to first and update its
  description to `(default)`; drop `(default)` from the `llama3.2:3b` entry. **Do not remove**
  `llama3.2:3b` — keep it (un-deprecated is fine) so existing users keep a recognised selection.
- `src/summarizer.py:156` — the hardcoded `"llama3.2:3b"` config-load fallback → `"gemma4:e2b-it-qat"`.
- `src/summarizer.py:319` — reorder `fallback_models` to lead with `"gemma4:e2b-it-qat"`.

**Migration / safety:**
- Only **new installs / first run** get the new default (existing `config.json` keeps the user's
  `model`). Verify the setup flow pulls `DEFAULT_MODEL` (it's backend-driven; `Setup.tsx` has no
  hardcoded model). Audit `setup-check` / first-run pull path in `app/main.js` (~:4379, model-pull
  handlers ~:6321) for any literal `llama3.2`.
- **Onboarding download grows 2GB → 4.3GB.** Call this out in the PR; confirm it's acceptable.

**`num_ctx` (folded in):** the summarizer sets `max_tokens` but **never sets `num_ctx`/`options`**
on the local Ollama call (verified — no `options=`/`num_ctx` in `src/summarizer.py`). So today the
model runs at Ollama's small default context (~2–4K) regardless of its 128K capability — the new
default's window would go unused. As part of WS1, set an explicit `num_ctx` in the local Ollama
request `options` (sized to the model / clamped to a sane ceiling) so long meetings actually use the
context. This also matters because quantized `llama3.2:3b` effectively caps ~8K while QAT
`gemma4:e2b-it-qat` is a real 128K — the swap only pays off if `num_ctx` is set.

**Tests (model-free):**
- Unit: `tests/test_config.py` — assert `Config.DEFAULT_MODEL == "gemma4:e2b-it-qat"` and that the
  registry's first/active entry matches.
- Update the `model-management.t2` e2e if it pins the default id.
- If `num_ctx` is set via a helper, unit-test the helper's clamp/sizing (pure function, no model).

**Acceptance:** fresh `config.json` → `get_model()` returns `gemma4:e2b-it-qat`; setup pulls it;
existing configs untouched; local Ollama requests carry an explicit `num_ctx`.

---

## WS2 — Make the Chat model indicator accurate (no picker)

**Why:** `Chat.tsx:230` / `ChatConversation.tsx:471` render a read-only `<span>` keyed on stored
`cloud_provider`/`cloud_model`, so a local/adapter user sees `openai · gpt-4o` — a label that
*lies* about what's answering (root of #198's confusion).

**Design — label reflects the **active** `ai_provider`:**
- `cloud` → `${cloud_provider} · ${cloud_model}` (current behavior, now only in cloud mode).
- `local` → `Ollama · <model>` where `<model>` is the configured local model.
- `remote` → `Remote Ollama · <model>`.
- `adapter` → `Organisation` (server brokers the model; client has no id — do **not** show a cloud id).

**Touch:**
- Provider payload lacks the local/remote model name. Two options — pick one:
  - (a) Add `model: string` (the local Ollama model) to the `get-ai-provider` handler in
    `app/main.js` and to `GetAiProviderResponse` in `app/renderer/src/lib/ipc.ts:406`; **or**
  - (b) Source the active local model from the existing `useModels` hook in the renderer.
  Prefer (a) for a single source of truth in the same payload the label already reads.
- `app/renderer/src/routes/Chat.tsx:230-234` and `ChatConversation.tsx:471-475` — replace the
  `cloud_provider ? … : 'Auto'` expression with an `ai_provider`-driven helper (extract a small
  `formatActiveModel(provider.data)` shared util so the two call sites can't drift).

**Tests:** T1 renderer spec (mock IPC) asserting the label string for each `ai_provider` value.

**Acceptance:** the indicator never shows a cloud model when local/adapter is active; matches the
provider actually used for the answer.

---

## WS3 — Allow local models in cross-note chat (enable + cap context)

**Why:** chat is hard-blocked for local today. `chat_global_streaming` (`simple_recorder.py:2876`)
rejects anything but cloud/adapter (`"Local models can't fit"`) and the renderer's `localReady`
(`Chat.tsx:67`) only counts cloud/adapter. The block exists because cross-note chat assembles
~400k chars (~100k tokens) of context, which small local models can't hold.

**Backend (`simple_recorder.py` `chat_global_streaming` ~:2876):**
- Remove the hard `if get_ai_provider() not in ("cloud","adapter")` rejection; allow `local`/`remote`.
- **Cap the assembled context to the model's window.** The context is already assembled
  most-recent-first (comment ~:2939), so truncate from the tail: keep whole notes until a char
  budget is hit. Derive the budget from the local model's context window
  (`gemma4:e2b-it-qat` is 128K ctx) with headroom for the prompt + reply; fall back to a
  conservative default for unknown models. Emit a signal (e.g. a `CHAT_SCOPE_CAPPED:` line or a
  field) when notes were dropped so the UI can disclose it.

**Renderer (`Chat.tsx`):**
- Extend `localReady` to include local/remote ready states (provider configured + model present).
- Update the disabled-state placeholder copy (`Chat.tsx:223`) so it no longer implies cloud-only.
- When local and context was capped, show a subtle note ("Answering over your most recent notes").

**Tests (model-free T2):** drive `chat_global_streaming` with `ai_provider=local` through the
capturing `mock-ollama.js`; assert (1) it's no longer rejected, and (2) the prompt is capped /
the capped signal fires when over-budget. Keep any real-model assertions in `@pipeline`.

**Acceptance:** with a local model selected, cross-note chat answers (capped to recent notes) and
discloses the cap; cloud/adapter behavior unchanged.

**Risks / follow-ups:**
- Local cross-note quality is lower than cloud; the cap silently narrows scope — disclosure is the
  mitigation. A fuller fix is map-reduce over note summaries (ties into issue #188) — out of scope here.

---

## Cross-cutting

- Per CLAUDE.md: add/update a model-free e2e spec **in the same change** for each WS that touches
  user-facing behavior (WS1 model-management, WS2 a chat-label T1, WS3 a chat-local T2).
- Gate nothing on `process.platform` here — all four WS are cross-platform.
- Each WS ships as its own PR via luffy → nami; WS0 is just a merge.
