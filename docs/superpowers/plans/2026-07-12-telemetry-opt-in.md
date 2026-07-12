# Telemetry Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telemetry runs only for users who affirmatively enabled it — strict opt-in with a one-time consent reset for the installed base.

**Architecture:** Python configuration stays the source of truth. The default and getter become strictly false unless the persisted value is exactly JSON boolean `true`; a one-time migration (guarded by a marker key, written through a locked compare-and-set) resets every non-consented legacy config to `false`. The Electron main process needs no gating changes because it already initializes PostHog only when the Python `get-telemetry` result is enabled.

**Tech Stack:** Python `unittest`, Electron main process JavaScript, React/TypeScript, Playwright E2E.

## Global Constraints

- Strict consent means the persisted value is exactly JSON boolean `true` (`is True` in Python); malformed values (`"true"`, `1`, `null`) must never enable telemetry.
- The migration marker key is `telemetry_opt_in_migrated`; fresh installs get it seeded in the defaults so they never migrate.
- The migration persists `telemetry_enabled: false` unconditionally when the marker is absent — also when the key is merely missing (rollback protection: v0.5.8 treats a missing key as enabled).
- Never persist over a corrupt config (`_load_failed` semantics, same as existing migrations); all migration failure modes fail closed.
- `_save()` is not modified; the migration writes through its own locked compare-and-set.
- No changes to event payloads, sanitization (`app/analytics-helpers.js`), IPC shape, CLI commands, or `anonymous_id`.
- No website/docs copy changes in this PR (release-coordinated follow-up; named as a release-blocking checklist item in the PR description).
- The onboarding toggle stays visible with unchanged notice text; no compensating UI to boost opt-in rates.

---

### Task 1: Python strict opt-in with one-time consent migration

**Files:**
- Modify: `tests/test_config.py` (add class after `ConfigLaunchOnLoginTests`, near line 255)
- Modify: `src/config.py:585-587` (defaults), `src/config.py:835-850` (getter/setter), new methods near the other `_migrate_*` helpers

**Interfaces:**
- Consumes: existing `Config.__init__` migration chain, `self._load_failed`, `self._snapshot`, `filelock.FileLock`, `self._SAVE_LOCK_TIMEOUT`, `self._read_disk_for_merge()`, `_atomic_write_json(path, payload)`.
- Produces: `Config.get_telemetry_enabled() -> bool` (strict `is True`), `Config.set_telemetry_enabled(enabled: bool) -> bool` (also writes the marker), `Config._migrate_telemetry_opt_in() -> None`, `Config._persist_telemetry_migration() -> None`. The CLI (`get-telemetry`/`set-telemetry` in `simple_recorder.py`) goes through these getters/setters and needs no change.

- [ ] **Step 1: Write the failing contract tests**

Add to `tests/test_config.py` directly after `ConfigLaunchOnLoginTests`:

```python
class ConfigTelemetryOptInTests(unittest.TestCase):
    def test_fresh_config_defaults_off_with_marker(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertFalse(config.get_telemetry_enabled())
            self.assertIs(config._config.get("telemetry_opt_in_migrated"), True)

    def test_legacy_persisted_true_is_reset_and_persisted(self):
        # v0.5.8 auto-persisted telemetry_enabled: true without consent; the
        # one-time migration must reset it on disk, not only in memory.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"telemetry_enabled": True}))
            config = Config(config_path=path)
            self.assertFalse(config.get_telemetry_enabled())
            on_disk = json.loads(path.read_text())
            self.assertIs(on_disk["telemetry_enabled"], False)
            self.assertIs(on_disk["telemetry_opt_in_migrated"], True)

    def test_legacy_missing_key_is_persisted_false(self):
        # Rollback protection: v0.5.8 treats a missing key as enabled, so the
        # migration must write an explicit false even when the key is absent.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"model": "gemma3:4b"}))
            config = Config(config_path=path)
            self.assertFalse(config.get_telemetry_enabled())
            on_disk = json.loads(path.read_text())
            self.assertIs(on_disk["telemetry_enabled"], False)
            self.assertIs(on_disk["telemetry_opt_in_migrated"], True)

    def test_malformed_values_never_enable(self):
        for malformed in ("true", "false", 1, 0, None, []):
            with self.subTest(value=malformed):
                with tempfile.TemporaryDirectory() as tmp_dir:
                    path = Path(tmp_dir) / "config.json"
                    path.write_text(json.dumps({
                        "telemetry_enabled": malformed,
                        "telemetry_opt_in_migrated": True,
                    }))
                    config = Config(config_path=path)
                    self.assertFalse(config.get_telemetry_enabled())

    def test_marker_prevents_re_migration(self):
        # An affirmative post-migration true must survive later loads.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({
                "telemetry_enabled": True,
                "telemetry_opt_in_migrated": True,
            }))
            config = Config(config_path=path)
            self.assertTrue(config.get_telemetry_enabled())
            on_disk = json.loads(path.read_text())
            self.assertIs(on_disk["telemetry_enabled"], True)

    def test_round_trip_writes_marker(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_telemetry_enabled(True))
            self.assertTrue(config.get_telemetry_enabled())
            reloaded = Config(config_path=path)
            self.assertTrue(reloaded.get_telemetry_enabled())
            on_disk = json.loads(path.read_text())
            self.assertIs(on_disk["telemetry_opt_in_migrated"], True)
            self.assertTrue(reloaded.set_telemetry_enabled(False))
            self.assertFalse(reloaded.get_telemetry_enabled())

    def test_corrupt_config_never_persisted(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text("{not json")
            config = Config(config_path=path)
            self.assertFalse(config.get_telemetry_enabled())
            # The corrupt original must stay recoverable on disk.
            self.assertEqual(path.read_text(), "{not json")

    def test_migration_cas_aborts_when_marker_lands_first(self):
        # Deterministic race simulation: another process migrated AND the
        # user affirmatively opted in before this (stale) instance persisted
        # its migration. The locked compare-and-set must adopt the disk state
        # instead of clobbering the opt-in.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({
                "telemetry_enabled": True,
                "telemetry_opt_in_migrated": True,
            }))
            config = Config(config_path=path)
            # Rewind this instance to a pre-migration view of the world.
            config._config["telemetry_enabled"] = False
            config._config["telemetry_opt_in_migrated"] = False
            config._persist_telemetry_migration()
            on_disk = json.loads(path.read_text())
            self.assertIs(on_disk["telemetry_enabled"], True)
            self.assertTrue(config.get_telemetry_enabled())
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
source venv/bin/activate && python -m pytest tests/test_config.py::ConfigTelemetryOptInTests -q
```

Expected: failures — fresh config still defaults true, legacy configs are not migrated, `_persist_telemetry_migration` does not exist. `test_corrupt_config_never_persisted` may already pass.

- [ ] **Step 3: Implement the strict default, getter, setter, and migration**

In `_get_default_config()` (`src/config.py:585-587`), replace:

```python
            "telemetry_enabled": True,
```

with:

```python
            # Strict opt-in — telemetry runs only after the user explicitly
            # enables it (Setup or Settings → Advanced). Fresh installs carry
            # the migration marker so the one-time consent reset never runs.
            "telemetry_enabled": False,
            "telemetry_opt_in_migrated": True,
```

Replace `get_telemetry_enabled` / extend `set_telemetry_enabled` (`src/config.py:835-850`):

```python
    def get_telemetry_enabled(self) -> bool:
        """Get whether anonymous usage analytics are enabled."""
        # Strict consent: only JSON boolean true counts. Malformed persisted
        # values ("true", 1, null) must never enable telemetry.
        return self._config.get("telemetry_enabled") is True

    def set_telemetry_enabled(self, enabled: bool) -> bool:
        """
        Set whether anonymous usage analytics are enabled.

        Args:
            enabled: True to enable telemetry, False to disable

        Returns:
            True if saved successfully, False otherwise
        """
        self._config["telemetry_enabled"] = enabled
        # Any real toggle is affirmative — it also ends the one-time
        # consent-reset migration window.
        self._config["telemetry_opt_in_migrated"] = True
        return self._save()
```

Add the migration next to the other `_migrate_*` helpers:

```python
    def _migrate_telemetry_opt_in(self) -> None:
        """One-time consent reset for telemetry (strict opt-in).

        v0.5.8 shipped telemetry default-ON and _merge_for_save() lays down
        the full default dict on first write, so existing installs carry
        telemetry_enabled: true that was never an affirmative choice. Until
        the marker is set, force the persisted value to False — also when the
        key is merely missing, so a rollback to a build that treats
        missing-as-true stays off. set_telemetry_enabled() also writes the
        marker, so any real toggle ends the migration window.
        """
        if self._load_failed:
            return  # never persist defaults over a corrupt-but-recoverable file
        if self._config.get("telemetry_opt_in_migrated") is True:
            return
        self._config["telemetry_enabled"] = False
        self._config["telemetry_opt_in_migrated"] = True
        self._persist_telemetry_migration()

    def _persist_telemetry_migration(self) -> None:
        """Locked compare-and-set write for the telemetry consent reset.

        Re-reads config.json after acquiring the lock and aborts if the
        marker already landed on disk (another process migrated, or the user
        affirmatively toggled), so a racing opt-in is never clobbered.
        All failure modes fail closed: this process already sees False in
        memory, and the next process retries the persist.
        """
        lock_path = str(self.config_path) + ".lock"
        try:
            with filelock.FileLock(lock_path, timeout=self._SAVE_LOCK_TIMEOUT):
                base = self._read_disk_for_merge()
                if base is None:
                    # Missing or unreadable on disk: nothing trustworthy to
                    # reset. A later _save() lays down the defaults, which
                    # are already off.
                    return
                if base.get("telemetry_opt_in_migrated") is True:
                    # Lost the race — adopt the disk state (bool by
                    # construction: only the migration or the setter write
                    # it) instead of overwriting an affirmative opt-in.
                    adopted = base.get("telemetry_enabled") is True
                    self._config["telemetry_enabled"] = adopted
                    self._config["telemetry_opt_in_migrated"] = True
                    self._snapshot["telemetry_enabled"] = adopted
                    self._snapshot["telemetry_opt_in_migrated"] = True
                    return
                base["telemetry_enabled"] = False
                base["telemetry_opt_in_migrated"] = True
                _atomic_write_json(self.config_path, base)
                # Sync the snapshot so a later _save() from this instance
                # doesn't re-diff these keys against the pre-migration load.
                self._snapshot["telemetry_enabled"] = False
                self._snapshot["telemetry_opt_in_migrated"] = True
        except filelock.Timeout:
            logger.warning(
                "Timed out acquiring config lock for telemetry consent "
                "migration; will retry on next load"
            )
        except Exception as e:
            logger.error(f"Error persisting telemetry consent migration: {e}")
```

Call it from `__init__` at the end of the migration chain (`src/config.py:296-301`):

```python
        self._migrate_cloud_model_map()
        self._migrate_whisper_model()
        self._migrate_summary_model()
        self._migrate_transcription_engine()
        self._migrate_telemetry_opt_in()
        self._normalize_templates()
        self._seed_sample_template()
```

- [ ] **Step 4: Run the new tests and verify they pass**

Run:

```bash
source venv/bin/activate && python -m pytest tests/test_config.py::ConfigTelemetryOptInTests -q
```

Expected: `9 passed` (with 6 subtests inside the malformed-values test).

- [ ] **Step 5: Run the full config suite and lint**

Run:

```bash
source venv/bin/activate && python -m pytest tests/test_config.py -q && ruff check src/config.py tests/test_config.py
```

Expected: all passed (54 pre-existing + the new class), ruff clean. If an existing test asserted the old default-true behavior, update it to the opt-in contract — but a scan showed no existing telemetry tests in `tests/test_config.py`.

- [ ] **Step 6: Commit**

```bash
git add src/config.py tests/test_config.py
git commit -m "fix: make telemetry strict opt-in with one-time consent reset"
```

---

### Task 2: Align renderer fallback, PostHog options, and the E2E case

**Files:**
- Modify: `app/renderer/src/routes/Setup.tsx:133`
- Modify: `app/main.js:583` and `app/main.js:6401` (PostHog constructor call sites)
- Modify: `e2e/specs/settings-roundtrip.t2.spec.ts:64`

**Interfaces:**
- Consumes: Task 1's persisted contract (default off; setter writes value + marker).
- Produces: no new interfaces; renderer fallback and E2E assertions match the opt-in default. `AdvancedTab.tsx` already uses `?? false` and needs no change.

- [ ] **Step 1: Change the Setup onboarding fallback to off**

In `app/renderer/src/routes/Setup.tsx:133`, replace:

```tsx
  const telemetryEnabled = telemetry.data?.telemetry_enabled ?? true;
```

with:

```tsx
  const telemetryEnabled = telemetry.data?.telemetry_enabled ?? false;
```

- [ ] **Step 2: Add explicit disableGeoip to both PostHog constructors**

In `app/main.js` (init path, ~line 583), replace:

```javascript
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
```

with:

```javascript
      // disableGeoip is already the posthog-node default; explicit here as
      // drift protection so an SDK upgrade can't silently re-enable IP
      // geolocation for opted-in users.
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST, disableGeoip: true });
```

In the `set-telemetry` re-enable path (~line 6401), replace:

```javascript
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
```

with:

```javascript
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST, disableGeoip: true });
```

- [ ] **Step 3: Flip the E2E setter case to the opposite of the new default**

In `e2e/specs/settings-roundtrip.t2.spec.ts:64`, replace:

```typescript
  { kind: 'telemetry', value: false, configKey: 'telemetry_enabled' },
```

with:

```typescript
  // true flips the default (false) so the assertion has teeth — a no-op
  // setter would leave the key unset/false and fail this case.
  { kind: 'telemetry', value: true, configKey: 'telemetry_enabled' },
```

- [ ] **Step 4: Typecheck and lint the renderer**

Run:

```bash
cd app && npm run typecheck:renderer && npm run lint:renderer
```

Expected: both clean.

- [ ] **Step 5: Rebuild the backend bundle and run the focused T2 test**

The T2 spec drives the bundled backend, so it must contain Task 1's migration:

```bash
source venv/bin/activate && python -m PyInstaller stenoai.spec --noconfirm
cd app && npm run test:e2e -- --project=t2 --grep "settings setters persist"
```

Expected: `1 passed`. If the local environment cannot run Electron, record the constraint and rely on the required T2 CI job.

- [ ] **Step 6: Scan for stale default-on semantics**

Run:

```bash
rg -n -C 2 "telemetry_enabled|telemetryEnabled|telemetry_opt_in_migrated" src/config.py app/main.js app/renderer/src/routes/Setup.tsx app/renderer/src/routes/settings/AdvancedTab.tsx e2e/specs/settings-roundtrip.t2.spec.ts tests/test_config.py
```

Expected: no fallback resolves to enabled; no comment describes default-on behavior; the marker key appears only in `src/config.py` and its tests (it must not leak into `identify()` properties or the settings UI).

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/routes/Setup.tsx app/main.js e2e/specs/settings-roundtrip.t2.spec.ts
git commit -m "fix: opt-in telemetry fallbacks and explicit disableGeoip"
```

---

### Task 3: Prepare the follow-up pull request

**Files:**
- No product files change in this task.

**Interfaces:**
- Consumes: the verified commits from Tasks 1 and 2.
- Produces: a focused GitHub pull request against `ruzin/stenoai:main`.

- [ ] **Step 1: Verify branch state and commit range**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: clean worktree; the range contains the design, plan, and two implementation commits only.

- [ ] **Step 2: Push the branch to the fork (requires explicit user authorization)**

```bash
git push -u fork fix/telemetry-opt-in
```

- [ ] **Step 3: Create the pull request (requires explicit user authorization)**

Title:

```text
fix: make telemetry strict opt-in
```

Body (`telemetry-opt-in-pr-body.md` in the session scratchpad):

```markdown
## Summary

Telemetry becomes strict opt-in. The PostHog integration, event payloads, and sanitization layer are unchanged; only the consent model changes.

- New installs default to `telemetry_enabled: false`.
- Strict consent semantics: only JSON boolean `true` enables telemetry (`is True` in Python); malformed persisted values can never turn it on.
- One-time consent reset for the installed base: v0.5.8 shipped default-on, and the config layer auto-persists the full default dict on first write, so existing installs carry `telemetry_enabled: true` that was never an affirmative choice. A marker-guarded migration (`telemetry_opt_in_migrated`) resets those configs to `false` once — written through a locked compare-and-set so a concurrent affirmative opt-in is never clobbered. The reset also writes an explicit `false` when the key was merely missing, so a rollback to v0.5.8 (missing key = on) stays off.
- The onboarding and Settings toggles are unchanged and remain the only paths that persist `true`, so post-migration consent is affirmative by definition.
- `disableGeoip: true` is now explicit on both PostHog constructors (already the SDK default; drift protection).

## Rationale

Anonymous, content-free analytics are legitimately useful, but default-on conflicts with Steno's local-first, privacy-respecting posture — the same reasoning as the launch-on-login opt-in correction (#335). Because default-on already shipped in v0.5.8, a default flip alone would not deliver opt-in for existing users; the one-time reset is the price of the previous `true` never having been affirmative.

Known consequence: analytics volume will collapse after this ships, and users who genuinely opted in on v0.5.8 are reset once (locally indistinguishable) and must re-enable. Worth marking the release boundary in the PostHog dashboards so pre/post metrics are not compared as if collection were stable.

## Testing

- `python -m pytest tests/test_config.py -q` — full config suite including the new `ConfigTelemetryOptInTests` (fresh install off, legacy true reset on disk, missing key persisted false, malformed values never enable, marker prevents re-migration, round trip, corrupt config untouched, CAS race adoption).
- `cd app && npm run typecheck:renderer && npm run lint:renderer`.
- Focused T2 settings round-trip against a freshly built backend bundle; the telemetry case now writes `true` (the opposite of the new default).

## Release checklist (blocking)

- [ ] Website/docs copy must ship with the release that contains this change: `website/public/privacy.html` ("enabled by default"), `docs/privacy/how-on-device-works.mdx` ("no analytics"), and FAQ claims need release-coordinated corrections in a separate PR — the website deploys on merge while the latest published release still defaults on, so bundling the copy here would create a disclosure/version skew.

## Follow-ups

- A future onboarding step could present the telemetry choice more prominently; intentionally out of scope here.
```

```bash
gh pr create --repo ruzin/stenoai --base main --head Optic00:fix/telemetry-opt-in --title "fix: make telemetry strict opt-in" --body-file <scratchpad>/telemetry-opt-in-pr-body.md
```

Do not push or create the PR until the user has authorized the external writes.
