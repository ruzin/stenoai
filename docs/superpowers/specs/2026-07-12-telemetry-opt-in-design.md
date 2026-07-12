# Telemetry Opt-In Design

## Context

Steno sends anonymous product analytics to PostHog (`https://us.i.posthog.com`) from the Electron main process.
The base implementation shipped in v0.5.8 with `telemetry_enabled` defaulting to `True`; PR #323 expanded the event set after that release.
All payloads are metadata-only (enums, buckets, a random UUID `anonymous_id`); the sanitization layer in `app/analytics-helpers.js` prevents content, paths, and PII from being sent.

Two consent problems exist:

1. The default is opt-out, with an onboarding toggle that defaults to on.
2. `Config._merge_for_save()` writes the full default dict wholesale when `config.json` is missing, so existing installations very likely have `telemetry_enabled: true` persisted without any affirmative user action.
A persisted `true` therefore cannot be trusted as consent.

Unlike the launch-on-login correction (#335), this cannot be fixed by a default flip alone: the installed base must be migrated.

## Goal

Telemetry runs only for users who have affirmatively enabled it after this change ships.
Strict consent means the persisted value is exactly JSON boolean `true`, written by the user-facing toggle.

## Behavior

| Configuration state | Effective | Action |
| --- | --- | --- |
| New installation | off | Marker seeded in defaults; no migration ever runs |
| Existing config, marker absent (any prior value: `true`, missing, malformed) | off | One-time migration persists `telemetry_enabled: false` + marker |
| Explicit `true` written after migration (only reachable via the toggle) | on | Unchanged |
| Explicit `false` | off | Unchanged |
| Corrupt config (`_load_failed`) | off (in memory) | Never persisted over |

Accepted consequence: v0.5.8 users who did affirmatively enable the toggle are also reset once (locally indistinguishable from auto-persisted `true`) and must re-enable.

## Changes

### Python (`src/config.py`) — core

- Default `"telemetry_enabled": False` in `_get_default_config()`; seed the migration marker (`"telemetry_opt_in_migrated": True`) in the defaults so fresh installs never migrate.
- `get_telemetry_enabled()` returns `self._config.get("telemetry_enabled") is True` — malformed persisted values (`"false"`, `1`, `null`) must not enable telemetry.
- New one-time migration `_migrate_telemetry_opt_in()`, called from `__init__` after the existing migrations:
  - Skips when `_load_failed` (corrupt-file recovery semantics, same as the other migrations).
  - Skips when the marker is already `True` in the loaded config.
  - Otherwise persists `telemetry_enabled: false` and the marker **unconditionally** — also when the key was merely missing, so a rollback to v0.5.8 (which treats a missing key as `true`) stays off.
  - Persists through a dedicated locked compare-and-set write: acquire the existing config file lock, re-read the file from disk, abort without writing if the marker is already present on disk, else atomically write the updated file. `_save()` is not modified. Residual races fail closed (a lost affirmative opt-in at worst requires toggling again).
- `set_telemetry_enabled()` additionally writes the marker, so any toggle action also ends the migration window.

### Renderer

- `Setup.tsx`: `telemetryEnabled` fallback `?? true` → `?? false`. The onboarding toggle stays visible with the existing notice text; no dark patterns, no new UI.
- Same fallback change in `AdvancedTab.tsx` if a `?? true` fallback exists there.

### Electron main (`app/main.js`)

- No gating logic changes: `initTelemetry` already reads the Python `get-telemetry` result and only constructs PostHog when enabled.
- Add explicit `disableGeoip: true` to both PostHog constructor call sites (init and re-enable). posthog-node 4.18.0 already defaults this to true; the explicit option is drift protection only.

### Tests

- Python contract tests (`ConfigTelemetryOptInTests`):
  - Fresh config: off, marker present, no migration write needed.
  - Legacy config with persisted `true` and no marker: getter returns `False`, file afterwards contains `telemetry_enabled: false` + marker.
  - Legacy config **without** the key and no marker: same result (rollback protection).
  - Malformed persisted values (`"false"`, `1`, `None`): getter `False`; migration normalizes to `false`.
  - Marker present: migration never rewrites; an explicit post-migration `true` survives reload.
  - Round trip: `set_telemetry_enabled(True/False)` persists value + marker.
  - Corrupt config: nothing persisted.
  - Concurrency: migration racing `set_telemetry_enabled(True)` — the locked compare-and-set aborts when the marker landed first.
- E2E: `settings-roundtrip.t2.spec.ts` telemetry case flips to `value: true` (the opposite of the new default, so a no-op setter fails).
- Renderer vitest for Setup/Advanced if their tests assert the fallback.

## Data Flow

Every CLI invocation constructs a fresh `Config`, so the migration takes effect in memory immediately even before its persist lands; `initTelemetry` in the Electron main process reads the migrated value via `get-telemetry` and simply never constructs the PostHog client for non-consented users.
When the user enables the toggle, the existing IPC path persists `true` (+ marker) and main.js constructs the client immediately, as today.

## Error Handling

Unchanged outside the migration.
The migration never writes over a corrupt config, degrades to no-op on lock timeout (the in-memory value is still `False` for this process; the next process retries), and all failure modes are fail-closed for privacy.

## Out of Scope

- Website and docs copy (`website/public/privacy.html` "enabled by default", `docs/privacy/how-on-device-works.mdx` "no analytics", FAQ claims): prepared as a **separate, release-coordinated PR** and named in this PR as an explicit release-blocking checklist item with an owner — the website auto-deploys on merge while released v0.5.8 still defaults on, so bundling would create a disclosure/version skew.
- No changes to event payloads, sanitization, IPC shape, CLI commands, or the `anonymous_id` mechanism.
- No compensating onboarding changes to boost opt-in rates.

## PR Positioning

Framed as a consent-model correction and an explicit product decision for the maintainer: analytics volume will collapse because the installed base is reset, and pre/post release metrics must not be compared as if collection were stable (mark the boundary in PostHog dashboards).
The reset is the price of the previous `true` never having been affirmative.
