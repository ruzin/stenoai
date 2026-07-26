'use strict';

/**
 * Locale completeness gate (#337).
 *
 * English is the source language, so the gate that matters is **English-source
 * completeness**: every key the code asks for must exist in `en.json`. A missing
 * English key renders as the raw key string ("settings.general.name.label") in
 * the UI, which is a visible defect.
 *
 * German coverage is deliberately REPORTED, NOT ENFORCED. i18next falls back to
 * English for a missing key, so a partially translated locale degrades to
 * readable English rather than breaking — which is exactly what makes it safe
 * for a locale to arrive incrementally from a community contributor. Making
 * parity a hard gate would block every English copy change on a translator.
 *
 * What this canNOT prove: that every hardcoded string was extracted in the first
 * place. It only proves the keys that ARE used resolve. Catching un-extracted
 * strings needs a lint rule against raw user-facing literals, which is a
 * separate piece of work.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, 'locales');
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}${k}`;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flatten(v, `${key}.`)) out.add(nested);
    } else {
      out.add(key);
    }
  }
  return out;
}

function loadLocale(lng) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES, `${lng}.json`), 'utf-8'));
}

function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
        files.push(full);
      }
    }
  };
  walk(path.join(__dirname, 'renderer', 'src'));
  // The main-process instance reads the same bundles.
  files.push(path.join(__dirname, 'main.js'), path.join(__dirname, 'settings-ipc.js'));
  return files;
}

/*
 * Only literal keys are collectable. Keys built from a template
 * (`t(`palette.settings.${row.key}.title`)`) are invisible to a text scan, so
 * this is a floor on coverage, not a complete picture — which is why the
 * reverse check (defined-but-unused) is reported rather than asserted.
 */
function usedKeys() {
  const literal = /(?:\bt|i18n\.t)\(\s*['"]([a-zA-Z][\w.]*)['"]/g;
  const transComponent = /i18nKey=\s*['"]([\w.]+)['"]/g;
  const used = new Set();
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const m of src.matchAll(literal)) used.add(m[1]);
    for (const m of src.matchAll(transComponent)) used.add(m[1]);
  }
  return used;
}

/** i18next resolves `key` against `key_one`/`key_other`, so both count as defined. */
function resolvableKeys(locale) {
  const defined = flatten(locale);
  const resolvable = new Set(defined);
  for (const key of defined) {
    if (PLURAL_SUFFIX.test(key)) resolvable.add(key.replace(PLURAL_SUFFIX, ''));
  }
  return resolvable;
}

test('every translation key used in the code exists in en.json', () => {
  const resolvable = resolvableKeys(loadLocale('en'));
  const missing = [...usedKeys()].filter((k) => !resolvable.has(k)).sort();
  assert.deepStrictEqual(
    missing,
    [],
    `keys used in code but absent from en.json (these render as raw key strings): ${missing.join(', ')}`,
  );
});

test('German defines no key that English does not (English is the source)', () => {
  // The direction that is a real bug: a German-only key can never resolve,
  // because nothing in the code asks for a key that has no English source. It
  // is almost always a typo in the German file.
  const en = flatten(loadLocale('en'));
  const orphans = [...flatten(loadLocale('de'))].filter((k) => !en.has(k)).sort();
  assert.deepStrictEqual(orphans, [], `German keys with no English counterpart: ${orphans.join(', ')}`);
});

test('every plural key ships both forms in both locales', () => {
  // A key with `_one` but no `_other` throws at the plural boundary rather than
  // falling back, so this one IS enforced for German too.
  for (const lng of ['en', 'de']) {
    const keys = flatten(loadLocale(lng));
    const broken = [];
    for (const key of keys) {
      if (!PLURAL_SUFFIX.test(key)) continue;
      const base = key.replace(PLURAL_SUFFIX, '');
      if (!keys.has(`${base}_one`) || !keys.has(`${base}_other`)) broken.push(key);
    }
    assert.deepStrictEqual(broken.sort(), [], `${lng}.json has half a plural pair: ${broken.join(', ')}`);
  }
});

test('interpolation placeholders match between English and German', () => {
  // A renamed or dropped placeholder is silent: i18next just leaves the literal
  // {{name}} in the output, or interpolates nothing. Only a comparison catches it.
  const en = loadLocale('en');
  const de = loadLocale('de');
  const flat = (obj, prefix = '', out = {}) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = `${prefix}${k}`;
      if (v && typeof v === 'object') flat(v, `${key}.`, out);
      else out[key] = v;
    }
    return out;
  };
  const enFlat = flat(en);
  const deFlat = flat(de);
  const placeholders = (s) =>
    new Set([...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

  const mismatches = [];
  for (const [key, deValue] of Object.entries(deFlat)) {
    const enValue = enFlat[key];
    if (enValue === undefined) continue; // covered by the orphan test above
    const a = placeholders(enValue);
    const b = placeholders(deValue);
    if (a.size !== b.size || [...a].some((p) => !b.has(p))) {
      mismatches.push(`${key}: en{${[...a]}} de{${[...b]}}`);
    }
  }
  assert.deepStrictEqual(mismatches.sort(), [], `placeholder drift:\n  ${mismatches.join('\n  ')}`);
});

test('German coverage is reported, not enforced', () => {
  // Informational on purpose — see the file header. This prints a number so a
  // reviewer can see coverage move; it must never fail a build.
  const en = flatten(loadLocale('en'));
  const de = flatten(loadLocale('de'));
  const translated = [...en].filter((k) => de.has(k)).length;
  const pct = ((translated / en.size) * 100).toFixed(1);
  console.log(`    German coverage: ${translated}/${en.size} keys (${pct}%)`);
  assert.ok(en.size > 0);
});
