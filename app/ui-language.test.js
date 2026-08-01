'use strict';

/**
 * UI-language resolution (#337).
 *
 * The load-bearing case is the migration asymmetry: a config.json that exists
 * but has no `ui_language` key belongs to an install that has been showing an
 * English UI, and must keep showing one. Only a genuinely fresh install follows
 * the OS. Getting that backwards would flip every German-OS user's interface to
 * German on upgrade without them asking — which is exactly what the RFC's
 * original "absence means system" wording would have done.
 *
 * This mirrors _migrate_ui_language() in src/config.py. The two implementations
 * are independent (main reads config.json synchronously at startup, far too
 * early to wait on a Python subprocess), so they are tested independently and
 * must be changed together.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const i18n = require('./i18n');

function tempDirWithConfig(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stenoai-uilang-'));
  if (contents !== null) {
    fs.writeFileSync(path.join(dir, 'config.json'), contents, 'utf-8');
  }
  return dir;
}

// --- negotiateSystemLanguage -------------------------------------------------

test('system negotiation honours the ordered preference list, not just the first tag', () => {
  // A user whose list is French-then-German has no French UI available here and
  // should land on German rather than falling through to English.
  assert.strictEqual(i18n.negotiateSystemLanguage(['fr-FR', 'de-DE', 'en-US']), 'de');
});

test('system negotiation drops region subtags', () => {
  assert.strictEqual(i18n.negotiateSystemLanguage(['de-AT']), 'de');
  assert.strictEqual(i18n.negotiateSystemLanguage(['de_DE']), 'de');
  assert.strictEqual(i18n.negotiateSystemLanguage(['DE']), 'de');
});

test('system negotiation falls back to English when nothing is supported', () => {
  assert.strictEqual(i18n.negotiateSystemLanguage(['ja-JP', 'ko-KR']), 'en');
});

test('system negotiation survives a missing or malformed preference list', () => {
  assert.strictEqual(i18n.negotiateSystemLanguage(undefined), 'en');
  assert.strictEqual(i18n.negotiateSystemLanguage([]), 'en');
  assert.strictEqual(i18n.negotiateSystemLanguage([null, '', 'de']), 'de');
});

// --- readStoredUiLanguage: the migration asymmetry ---------------------------

test('a fresh install (no config.json) follows the system', () => {
  const dir = tempDirWithConfig(null);
  assert.strictEqual(i18n.readStoredUiLanguage(dir), 'system');
});

test('an existing config.json without the key stays English, NOT system', () => {
  // The whole point of the asymmetry. This install has been running an English
  // UI; resolving it to 'system' would silently switch a German-OS user.
  const dir = tempDirWithConfig(JSON.stringify({ model: 'gemma4:e4b-it-qat', language: 'de' }));
  assert.strictEqual(i18n.readStoredUiLanguage(dir), 'en');
});

test('an explicit stored preference is returned unchanged', () => {
  for (const stored of ['system', 'en', 'de']) {
    const dir = tempDirWithConfig(JSON.stringify({ ui_language: stored }));
    assert.strictEqual(i18n.readStoredUiLanguage(dir), stored);
  }
});

test('an unsupported stored value degrades to English rather than throwing', () => {
  const dir = tempDirWithConfig(JSON.stringify({ ui_language: 'fr' }));
  assert.strictEqual(i18n.readStoredUiLanguage(dir), 'en');
});

test('a corrupt config.json degrades to English rather than crashing startup', () => {
  const dir = tempDirWithConfig('{ this is not json');
  assert.strictEqual(i18n.readStoredUiLanguage(dir), 'en');
});

test('a null, empty or wrongly-typed value is treated like an absent key', () => {
  // These are the cases where the two implementations could most easily drift:
  // Python's `in VALID_UI_LANGUAGES` and this file's `includes()` have to agree
  // on non-strings too. Verified against the real Config class over the same
  // matrix — if you change either side, re-check the other.
  for (const value of [null, '', 42]) {
    const dir = tempDirWithConfig(JSON.stringify({ ui_language: value }));
    assert.strictEqual(
      i18n.readStoredUiLanguage(dir),
      'en',
      `ui_language=${JSON.stringify(value)} should resolve like an absent key`,
    );
  }
});

// --- resolveUiLanguage -------------------------------------------------------

test('the system sentinel resolves against the OS preference list', () => {
  assert.strictEqual(i18n.resolveUiLanguage('system', ['de-DE']), 'de');
  assert.strictEqual(i18n.resolveUiLanguage('system', ['en-GB']), 'en');
  assert.strictEqual(i18n.resolveUiLanguage('system', ['it-IT']), 'en');
});

test('an explicit preference ignores the OS entirely', () => {
  // Someone who picked English on a German Mac keeps English.
  assert.strictEqual(i18n.resolveUiLanguage('en', ['de-DE']), 'en');
  assert.strictEqual(i18n.resolveUiLanguage('de', ['en-US']), 'de');
});

test('an unknown preference resolves to English', () => {
  assert.strictEqual(i18n.resolveUiLanguage('klingon', ['de-DE']), 'en');
});

// --- the resource bundle itself ---------------------------------------------

test('both shipped locales load and German actually differs from English', () => {
  // Guards against a de.json that silently failed to parse and fell back to {},
  // which would look like a working German build showing English text.
  const enPath = path.join(__dirname, 'locales', 'en.json');
  const dePath = path.join(__dirname, 'locales', 'de.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
  const de = JSON.parse(fs.readFileSync(dePath, 'utf-8'));
  assert.ok(en.tray && de.tray, 'both bundles carry the tray group');
  assert.notStrictEqual(de.tray.quit, en.tray.quit, 'German is a real translation, not a copy');
});

test('every key used in German exists in English (English is the source)', () => {
  // The completeness direction that matters: i18next falls back to English for
  // a missing German key, so a German-only key is a typo that can never render.
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
    );
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'en.json'), 'utf-8'));
  const de = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'de.json'), 'utf-8'));
  const enKeys = new Set(flatten(en));
  const orphans = flatten(de).filter((k) => !enKeys.has(k));
  assert.deepStrictEqual(orphans, [], `German keys with no English source: ${orphans.join(', ')}`);
});

// --- the i18next instance ----------------------------------------------------

test('initMainI18n renders German and falls back to English for a missing key', async () => {
  await i18n.initMainI18n('de');
  assert.strictEqual(i18n.currentLanguage(), 'de');
  assert.strictEqual(i18n.t('tray.quit'), 'Steno beenden');

  await i18n.changeMainLanguage('en');
  assert.strictEqual(i18n.t('tray.quit'), 'Quit Steno');
});

test('interpolation is not HTML-escaped (menu labels are handed to native APIs)', async () => {
  // "&File" on Windows must survive as-is; i18next's default escaping would
  // turn an interpolated & into &amp; in a native menu label.
  await i18n.initMainI18n('en');
  assert.strictEqual(i18n.t('tray.version', { version: '0.6.5' }), 'Steno v0.6.5');
});
