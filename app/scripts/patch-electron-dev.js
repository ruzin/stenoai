#!/usr/bin/env node
// Rebrands the Electron.app bundle that npm pulls into node_modules so dev
// runs show "Steno Dev" with the dragonfly icon in the dock, Cmd+Tab, and
// menu bar instead of the default "Electron" + atom logo. Runs as a
// postinstall hook so a fresh `npm install` always re-applies the patch.

const fs = require('fs');
const path = require('path');

const APP_NAME = 'Steno Dev';
const ICON_SOURCE = path.join(__dirname, '..', 'build', 'icon-dragonfly.icns');
const ICON_FILENAME = 'icon-dragonfly.icns';

const electronAppDir = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
);

if (!fs.existsSync(electronAppDir)) {
  console.log('[patch-electron-dev] Electron.app not found, skipping.');
  process.exit(0);
}

const infoPlistPath = path.join(electronAppDir, 'Contents', 'Info.plist');
const resourcesDir = path.join(electronAppDir, 'Contents', 'Resources');
const iconDest = path.join(resourcesDir, ICON_FILENAME);

let plist = fs.readFileSync(infoPlistPath, 'utf8');

function replaceStringValue(source, key, value) {
  const re = new RegExp(
    `(<key>${key}</key>\\s*<string>)[^<]*(</string>)`,
    'g',
  );
  return source.replace(re, `$1${value}$2`);
}

plist = replaceStringValue(plist, 'CFBundleName', APP_NAME);
plist = replaceStringValue(plist, 'CFBundleDisplayName', APP_NAME);
plist = replaceStringValue(plist, 'CFBundleIconFile', ICON_FILENAME);

fs.writeFileSync(infoPlistPath, plist);

if (fs.existsSync(ICON_SOURCE)) {
  fs.copyFileSync(ICON_SOURCE, iconDest);
} else {
  console.warn(
    `[patch-electron-dev] Icon source not found at ${ICON_SOURCE}; dock will fall back to the default icon.`,
  );
}

// Touch the .app so macOS Launch Services picks up the new metadata on next
// launch instead of reading a cached entry.
const now = new Date();
fs.utimesSync(electronAppDir, now, now);

console.log(`[patch-electron-dev] Rebranded Electron.app -> "${APP_NAME}".`);
