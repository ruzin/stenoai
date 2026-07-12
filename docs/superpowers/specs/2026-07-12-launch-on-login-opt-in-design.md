# Launch on Login Opt-In Design

## Context

PR #328 added launch-on-login support and made it enabled by default for new and existing users. The implementation is complete across configuration, IPC, the settings UI, OS login-item registration, and telemetry, but silently registering existing installations as login items conflicts with Steno's privacy-conscious, local-first product posture.

The feature has been merged into `main` but is not included in a published release. This allows the default to be corrected without a migration or one-time cleanup path.

## Goal

Keep the existing launch-on-login feature while requiring an explicit user choice before Steno registers itself as an OS login item.

## Behavior

| Configuration state | Effective preference | Startup behavior |
| --- | --- | --- |
| New configuration | `false` | Ensure the login item is not registered |
| Existing configuration without `launch_on_login` | `false` | Ensure the login item is not registered |
| Explicit `launch_on_login: false` | `false` | Ensure the login item is not registered |
| Explicit `launch_on_login: true` | `true` | Register or retain the login item |

The settings toggle remains available and applies changes immediately. An explicit `true` remains stable across later launches.

## Changes

### Configuration

- Change the default `launch_on_login` value in `src/config.py` from `true` to `false`.
- Change the legacy-config fallback in `get_launch_on_login()` from `true` to `false`.
- Update comments to describe opt-in behavior.

### Main process

- Treat a missing `launch_on_login` key as `false` when loading telemetry identity properties.
- Treat the key as `false` in both direct startup reads: hidden-launch resolution and login-item application.
- Retain the existing startup reconciliation, IPC handlers, and `applyLoginItemSetting()` implementation.
- Update comments from default-on/opt-out language to opt-in language.

### Settings UI

- Change the temporary render fallback for the switch from `true` to `false`.
- Keep the switch disabled until the persisted setting has loaded, as it is today.

### Tests

- Update the new-config test to expect `false`.
- Update the legacy-config-without-key test to expect `false`.
- Preserve round-trip coverage for explicit `false` and `true` values.
- Change the settings E2E round-trip case to write `true`, the opposite of the new default. This ensures a no-op setter cannot pass accidentally.
- Update test names and comments to describe opt-in behavior.

## Data Flow

At startup, a missing key resolves to `false` consistently in Python configuration, the Electron main process, telemetry, and the renderer. The main process applies `false` to Electron's login-item API. When the user explicitly enables the setting, the existing IPC path persists `true` and immediately registers the login item. Future launches read the explicit value and retain registration.

## Error Handling

No error-handling behavior changes. Login-item API failures remain non-fatal, configuration persistence errors continue through the existing IPC result, and the switch remains disabled while its initial value is unavailable.

## Non-Goals

- No onboarding prompt or callout is added in this PR. A future onboarding step may offer launch-on-login as an explicit choice.
- No change is made to startup reconciliation or handling of users who disable the item directly in macOS System Settings or Windows Task Manager. Respecting OS-level overrides more precisely can be addressed separately after platform-specific testing.
- No migration or cleanup marker is added because the default-on implementation has not shipped in a release.
- No changes are made to hidden-launch behavior, analytics event structure, IPC shape, or CLI commands.

## PR Positioning

The follow-up PR should be framed as a focused product-default correction rather than a rollback of the feature. It preserves all launch-on-login functionality and changes only the consent model from opt-out to opt-in. The description should mention onboarding and OS-level state handling as possible future improvements, without making either a merge requirement for this correction.
