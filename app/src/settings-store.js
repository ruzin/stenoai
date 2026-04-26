const path = require('node:path');
const fs = require('node:fs');

const SCHEMA_KEYS = ['newRenderer'];
const DEFAULTS = { newRenderer: false };

let filePath = null;
let cache = { ...DEFAULTS };
let loaded = false;

function resolvePath(app) {
  return path.join(app.getPath('userData'), 'ui-settings.json');
}

function load(app) {
  filePath = resolvePath(app);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULTS };
    for (const key of SCHEMA_KEYS) {
      if (typeof parsed[key] === typeof DEFAULTS[key]) {
        cache[key] = parsed[key];
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[settings-store] failed to read', filePath, err);
    }
    cache = { ...DEFAULTS };
  }
  loaded = true;
}

function persist() {
  if (!filePath) return;
  try {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error('[settings-store] failed to write', filePath, err);
  }
}

function assertLoaded() {
  if (!loaded) {
    throw new Error('[settings-store] called before load(app)');
  }
}

function get(key) {
  assertLoaded();
  if (!SCHEMA_KEYS.includes(key)) {
    throw new Error(`[settings-store] unknown key: ${key}`);
  }
  return cache[key];
}

function set(key, value) {
  assertLoaded();
  if (!SCHEMA_KEYS.includes(key)) {
    throw new Error(`[settings-store] unknown key: ${key}`);
  }
  if (typeof value !== typeof DEFAULTS[key]) {
    throw new Error(`[settings-store] ${key}: expected ${typeof DEFAULTS[key]}, got ${typeof value}`);
  }
  if (cache[key] === value) return;
  cache[key] = value;
  persist();
}

module.exports = { load, get, set };
