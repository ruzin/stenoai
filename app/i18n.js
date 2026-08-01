/*
 * UI-chrome localisation for the MAIN process (issue #337).
 *
 * This is one of two independent i18next instances. The renderer runs its own
 * (app/renderer/src/lib/i18n.ts). Nothing synchronises them automatically —
 * they share these JSON files and are coordinated by an explicit protocol in
 * main.js (persist → main changeLanguage → rebuild menu + tray → tell every
 * renderer). Changing one without the other leaves the app half-translated.
 *
 * Not to be confused with the transcription/content language, which is the
 * `language` config key and the get-language/set-language IPC pair. This
 * module only ever touches `ui_language`.
 */

const fs = require('fs');
const path = require('path');
const i18next = require('i18next');

// Keep in sync with VALID_UI_LANGUAGES in src/config.py.
const SUPPORTED_UI_LANGUAGES = ['en', 'de'];
const FALLBACK_UI_LANGUAGE = 'en';
// The stored preference may also be this sentinel, which means "follow the OS".
const SYSTEM_SENTINEL = 'system';

// Resolved unconditionally from __dirname rather than through the packaged-
// resources branch other assets use: locales/ is inside the electron-builder
// `files` set, so it lands inside app.asar on macOS (Electron's patched fs
// reads straight through it) and as plain files under resources/app on
// Windows, where `win.asar` is false. Both are __dirname-relative.
const LOCALES_DIR = path.join(__dirname, 'locales');

function loadResources() {
  const resources = {};
  for (const lng of SUPPORTED_UI_LANGUAGES) {
    try {
      const raw = fs.readFileSync(path.join(LOCALES_DIR, `${lng}.json`), 'utf-8');
      resources[lng] = { translation: JSON.parse(raw) };
    } catch (err) {
      // A missing or corrupt non-English file degrades to fallback text. A
      // missing English file is a build defect, so let that one be loud.
      if (lng === FALLBACK_UI_LANGUAGE) throw err;
      resources[lng] = { translation: {} };
    }
  }
  return resources;
}

/*
 * Pick the best supported language for an ordered list of user preferences,
 * e.g. Electron's app.getPreferredSystemLanguages() → ['de-DE', 'en-GB'].
 *
 * Ordered, not "first tag wins": a user whose list is ['fr-FR', 'de-DE'] has
 * no French UI available here and should get German rather than falling
 * through to English. Region subtags are dropped — we ship language-level
 * translations only.
 */
function negotiateSystemLanguage(preferred, supported = SUPPORTED_UI_LANGUAGES) {
  if (!Array.isArray(preferred)) return FALLBACK_UI_LANGUAGE;
  for (const tag of preferred) {
    if (typeof tag !== 'string' || !tag) continue;
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (supported.includes(base)) return base;
  }
  return FALLBACK_UI_LANGUAGE;
}

/*
 * Read the stored preference straight from config.json.
 *
 * Same sync-JSON-read-at-startup pattern as loadShowMenuBarIconEnabled() and
 * friends in main.js: the language has to be known before the application menu
 * is built and before the first window loads, which is far too early to wait on
 * a Python subprocess. The Python config remains the source of truth for
 * writes.
 *
 * The absent-key branch mirrors _migrate_ui_language() in src/config.py and the
 * asymmetry is deliberate: a config.json that exists but predates this key
 * belongs to an install that has been running an English UI, and must keep it.
 * Defaulting those to "system" would flip a German-OS user's interface to
 * German without them ever asking. Only a genuinely fresh install follows the
 * OS. If you change this, change the Python migration in the same commit.
 */
function readStoredUiLanguage(userDataDir) {
  try {
    const cfgPath = path.join(userDataDir, 'config.json');
    if (!fs.existsSync(cfgPath)) return SYSTEM_SENTINEL; // fresh install
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const stored = cfg.ui_language;
    if (stored === SYSTEM_SENTINEL || SUPPORTED_UI_LANGUAGES.includes(stored)) {
      return stored;
    }
    return FALLBACK_UI_LANGUAGE; // existing install predating the key
  } catch (_) {
    return FALLBACK_UI_LANGUAGE;
  }
}

/*
 * Turn the stored preference into a concrete language tag.
 * `preferredSystemLanguages` is injected so this stays testable without an
 * Electron app object; main.js passes app.getPreferredSystemLanguages().
 */
function resolveUiLanguage(stored, preferredSystemLanguages) {
  if (stored === SYSTEM_SENTINEL) {
    return negotiateSystemLanguage(preferredSystemLanguages);
  }
  if (SUPPORTED_UI_LANGUAGES.includes(stored)) return stored;
  return FALLBACK_UI_LANGUAGE;
}

let initialized = false;

async function initMainI18n(language) {
  const lng = SUPPORTED_UI_LANGUAGES.includes(language) ? language : FALLBACK_UI_LANGUAGE;
  if (initialized) {
    await i18next.changeLanguage(lng);
    return i18next;
  }
  await i18next.init({
    lng,
    fallbackLng: FALLBACK_UI_LANGUAGE,
    resources: loadResources(),
    interpolation: {
      // Menu labels and notification bodies are plain strings handed to native
      // APIs, never injected as HTML, so i18next's HTML escaping would only
      // mangle characters like & in "&File".
      escapeValue: false,
    },
    returnNull: false,
  });
  initialized = true;
  return i18next;
}

// Bound at call time, not captured — changeLanguage() must be visible to every
// later t() without callers re-importing anything.
function t(key, options) {
  if (!initialized) return key;
  return i18next.t(key, options);
}

async function changeMainLanguage(language) {
  const lng = SUPPORTED_UI_LANGUAGES.includes(language) ? language : FALLBACK_UI_LANGUAGE;
  if (!initialized) return initMainI18n(lng);
  await i18next.changeLanguage(lng);
  return i18next;
}

function currentLanguage() {
  return initialized ? i18next.language : FALLBACK_UI_LANGUAGE;
}

module.exports = {
  SUPPORTED_UI_LANGUAGES,
  FALLBACK_UI_LANGUAGE,
  SYSTEM_SENTINEL,
  negotiateSystemLanguage,
  readStoredUiLanguage,
  resolveUiLanguage,
  initMainI18n,
  changeMainLanguage,
  currentLanguage,
  t,
};
