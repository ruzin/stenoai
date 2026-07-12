# Launch on Login Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the launch-on-login feature while requiring an explicitly persisted `true` before Steno registers itself as an OS login item.

**Architecture:** Keep the existing config, IPC, renderer, and Electron login-item flow intact. Change every missing-value fallback from permissive/default-on semantics to strict opt-in semantics, with Python configuration as the persisted source of truth and matching fallbacks in the Electron main process, telemetry, and renderer.

**Tech Stack:** Python `unittest`/pytest, Electron main process JavaScript, React/TypeScript, Vitest, Playwright E2E.

## Global Constraints

- Do not add onboarding UI; mention it only as a possible future improvement in the PR description.
- Do not change `applyLoginItemSetting()`, IPC contracts, CLI commands, hidden-launch behavior, or startup reconciliation.
- Do not add migration or cleanup state because PR #328 has not shipped in a published release.
- An explicit persisted `launch_on_login: true` must remain enabled across launches.
- A new config, a legacy config without the key, and a missing config file must all resolve to disabled.

---

### Task 1: Make launch on login strict opt-in across all layers

**Files:**
- Modify: `tests/test_config.py:231-254`
- Modify: `src/config.py:600-604,1010-1015`
- Modify: `app/main.js:520-539,1305-1324,1503-1518`
- Modify: `app/renderer/src/routes/settings/GeneralTab.tsx:322-330`
- Modify: `e2e/specs/settings-roundtrip.t2.spec.ts:65-68`

**Interfaces:**
- Consumes: Existing `Config.get_launch_on_login() -> bool`, `Config.set_launch_on_login(enabled: bool) -> bool`, Electron `applyLoginItemSetting(enabled)`, and renderer `launchOnLogin.data: boolean | undefined`.
- Produces: A consistent effective preference where only boolean `true` enables launch on login; no signatures or IPC payloads change.

- [ ] **Step 1: Change the Python contract tests to specify opt-in behavior**

Replace `ConfigLaunchOnLoginTests` with:

```python
class ConfigLaunchOnLoginTests(unittest.TestCase):
    def test_default_launch_on_login_is_false(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertFalse(config.get_launch_on_login())

    def test_legacy_config_without_key_defaults_false(self):
        # Existing installs whose config predates this key must remain opt-in.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"model": "gemma3:4b"}))
            config = Config(config_path=path)
            self.assertFalse(config.get_launch_on_login())

    def test_launch_on_login_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_launch_on_login(True))
            self.assertTrue(config.get_launch_on_login())
            reloaded = Config(config_path=path)
            self.assertTrue(reloaded.get_launch_on_login())
            self.assertTrue(reloaded.set_launch_on_login(False))
            self.assertFalse(reloaded.get_launch_on_login())
```

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

Run:

```bash
python -m pytest tests/test_config.py::ConfigLaunchOnLoginTests -q
```

Expected: two failures because a new config and a config without `launch_on_login` still resolve to `True`; the round-trip test passes.

- [ ] **Step 3: Change the Python default and legacy fallback to opt-in**

In `_get_default_config()`, replace the launch-on-login entry and comment with:

```python
            # Default OFF — Steno only registers itself as an OS login item
            # after the user explicitly enables the setting. When enabled, it
            # starts hidden in the tray/menu bar.
            "launch_on_login": False,
```

Implement the getter as:

```python
    def get_launch_on_login(self) -> bool:
        """Get whether Steno launches automatically on login."""
        # Missing keys belong to installs that never opted in. Keep them off;
        # main.js re-applies only the resulting persisted preference.
        return self._config.get("launch_on_login", False)
```

- [ ] **Step 4: Run the focused Python tests and verify they pass**

Run:

```bash
python -m pytest tests/test_config.py::ConfigLaunchOnLoginTests -q
```

Expected: `3 passed`.

- [ ] **Step 5: Align Electron startup and telemetry with explicit consent**

Update the identity comment and property in `loadIdentitySuperProperties()`:

```javascript
// One config.json read (no extra subprocess) + a token-file existence check
// for the identify() super-properties below. `launch_on_login` is opt-in, so a
// legacy config missing the key reports false.
```

```javascript
    launch_on_login: cfg.launch_on_login === true,
```

In hidden-launch resolution, use a disabled fallback and strict boolean check:

```javascript
      let launchOnLoginEnabled = false;
      try {
        const cfgPath = path.join(getUserDataDir(), 'config.json');
        if (fs.existsSync(cfgPath)) {
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          launchOnLoginEnabled = cfg.launch_on_login === true;
        }
      } catch (_) {}
```

Update the startup reconciliation comment and implementation:

```javascript
    // Re-apply the OS "launch on login" item on every startup from the
    // persisted preference (config.json read directly — no subprocess). New
    // installs and existing configs without the key remain off; only an
    // explicit true registers the login item. Idempotent; no-op under E2E / dev
    // (see helper).
    try {
      let launchOnLoginEnabled = false;
      const cfgPath = path.join(getUserDataDir(), 'config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        launchOnLoginEnabled = cfg.launch_on_login === true;
      }
      applyLoginItemSetting(launchOnLoginEnabled);
    } catch (e) {
      console.warn('Failed to apply launch-on-login setting at startup:', e?.message);
    }
```

- [ ] **Step 6: Align the renderer fallback and E2E setter case**

Change the settings switch fallback in `GeneralTab.tsx`:

```tsx
        <Switch
          checked={launchOnLogin.data ?? false}
          onCheckedChange={(v) => setLaunchOnLogin.mutate(v)}
          disabled={launchOnLogin.data === undefined}
        />
```

Change the E2E case so it writes the opposite of the new default:

```typescript
  // true flips the default (false) so the assertion has teeth — a no-op setter
  // would leave the key unset/false and fail this case.
  { kind: 'launchOnLogin', value: true, configKey: 'launch_on_login' },
```

- [ ] **Step 7: Scan for stale default-on semantics**

Run:

```bash
rg -n -C 2 "launch_on_login|launchOnLogin" src/config.py app/main.js app/renderer/src/routes/settings/GeneralTab.tsx tests/test_config.py e2e/specs/settings-roundtrip.t2.spec.ts
```

Expected: all defaults and missing-key fallbacks are `false`/`=== true`; no launch-on-login comment describes default-on or opt-out behavior.

- [ ] **Step 8: Run focused and layer-level verification**

Run:

```bash
python -m pytest tests/test_config.py::ConfigLaunchOnLoginTests -q
python -m pytest tests/test_config.py -q
cd app && npx vitest run renderer/src/routes/settings/GeneralTab.test.tsx
npm run test:e2e -- --project=t2 --grep "settings setters persist"
```

Expected: all Python and Vitest tests pass. The focused T2 test passes when the bundled backend in `dist/stenoai/` is available; if the bundle is unavailable locally, record that constraint and rely on the required T2 CI job rather than claiming a local pass.

- [ ] **Step 9: Review the final diff for scope and formatting**

Run:

```bash
git diff --check
git diff -- src/config.py tests/test_config.py app/main.js app/renderer/src/routes/settings/GeneralTab.tsx e2e/specs/settings-roundtrip.t2.spec.ts
```

Expected: no whitespace errors; only default/fallback values, associated comments, and tests change. No IPC, CLI, onboarding, or login-item API code changes.

- [ ] **Step 10: Commit the implementation**

```bash
git add src/config.py tests/test_config.py app/main.js app/renderer/src/routes/settings/GeneralTab.tsx e2e/specs/settings-roundtrip.t2.spec.ts
git commit -m "fix: make launch on login opt-in"
```

Expected: one focused implementation commit after the existing design and plan commits.

---

### Task 2: Prepare the follow-up pull request

**Files:**
- No product files change in this task.

**Interfaces:**
- Consumes: The verified implementation commit from Task 1.
- Produces: A focused GitHub pull request against `ruzin/stenoai:main`.

- [ ] **Step 1: Verify branch state and commit range**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: clean worktree; the range contains the design, plan, and implementation commits only.

- [ ] **Step 2: Push the branch to the fork**

Run:

```bash
git push -u fork fix/launch-on-login-opt-in
```

Expected: the branch is available as `Optic00:fix/launch-on-login-opt-in`.

- [ ] **Step 3: Create the pull request**

Use title:

```text
fix: make launch on login opt-in
```

Create `/tmp/launch-on-login-opt-in-pr-body.md` with exactly this body:

```markdown
## Summary

- default launch on login to off for new installations
- treat legacy configs without an explicit preference as off
- align Electron startup, telemetry, the Settings toggle, and tests with opt-in semantics
- preserve explicit opt-ins and the existing login-item implementation

## Rationale

PR #328 added the launch-on-login plumbing, but enabling it automatically for existing installations would register Steno as an OS login item without prior user consent. This follow-up keeps the feature intact while requiring an explicit opt-in, which better matches Steno's local-first and user-respecting product posture.

PR #328 has not shipped in a published release, so no migration or cleanup marker is required.

## Testing

- `python -m pytest tests/test_config.py::ConfigLaunchOnLoginTests -q`
- `python -m pytest tests/test_config.py -q`
- `cd app && npx vitest run renderer/src/routes/settings/GeneralTab.test.tsx`
- T2 settings round-trip test locally if the bundled backend is available; otherwise required CI coverage

## Follow-ups

- A future onboarding step could offer launch on login as an explicit choice.
- OS-level disabling in macOS System Settings or Windows Task Manager could be handled more precisely after platform-specific testing; this PR intentionally leaves startup reconciliation unchanged.
```

Run:

```bash
gh pr create --repo ruzin/stenoai --base main --head Optic00:fix/launch-on-login-opt-in --title "fix: make launch on login opt-in" --body-file /tmp/launch-on-login-opt-in-pr-body.md
```

Expected: GitHub creates a PR targeting `ruzin/stenoai:main`. Do not create the PR until the user has authorized the external write.
