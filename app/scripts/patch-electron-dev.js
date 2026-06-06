#!/usr/bin/env node
// Rebrands the Electron.app bundle that npm pulls into node_modules so dev
// runs show "Steno Dev" with the dragonfly icon in the dock, Cmd+Tab, and
// menu bar instead of the default "Electron" + atom logo. Runs as a
// postinstall hook so a fresh `npm install` always re-applies the patch.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

const plistBefore = fs.readFileSync(infoPlistPath, 'utf8');
let plist = plistBefore;

// Replace the value of an existing <key>/<string> pair. If the key isn't
// present (or its <string> shape doesn't match), throw — silently doing
// nothing means the dev brand quietly regresses to "Electron" on the next
// Electron version bump that changes plist layout, and the postinstall
// would still print success. Better to fail loudly.
function replaceStringValue(source, key, value) {
  const re = new RegExp(
    `(<key>${key}</key>\\s*<string>)[^<]*(</string>)`,
    'g',
  );
  let replaced = false;
  const next = source.replace(re, (_match, open, close) => {
    replaced = true;
    return `${open}${value}${close}`;
  });
  if (!replaced) {
    throw new Error(
      `[patch-electron-dev] Could not find <key>${key}</key><string>…</string> in ${infoPlistPath}. ` +
        `Electron's Info.plist layout may have changed; update this script.`,
    );
  }
  return next;
}

plist = replaceStringValue(plist, 'CFBundleName', APP_NAME);
plist = replaceStringValue(plist, 'CFBundleDisplayName', APP_NAME);
plist = replaceStringValue(plist, 'CFBundleIconFile', ICON_FILENAME);

const plistChanged = plist !== plistBefore;
if (plistChanged) {
  fs.writeFileSync(infoPlistPath, plist);
}

let iconChanged = false;
if (fs.existsSync(ICON_SOURCE)) {
  // Skip the copy + bundle touch when the icon already matches — keeps
  // routine `npm install` runs silent and idempotent.
  const sourceBuf = fs.readFileSync(ICON_SOURCE);
  const destBuf = fs.existsSync(iconDest) ? fs.readFileSync(iconDest) : null;
  if (!destBuf || !sourceBuf.equals(destBuf)) {
    fs.copyFileSync(ICON_SOURCE, iconDest);
    iconChanged = true;
  }
} else {
  console.warn(
    `[patch-electron-dev] Icon source not found at ${ICON_SOURCE}; dock will fall back to the default icon.`,
  );
}

const bundleChanged = plistChanged || iconChanged;
if (!bundleChanged) {
  // Idempotent run — nothing to do, stay quiet so postinstall logs aren't
  // noisy on every `npm install`.
  process.exit(0);
}

// Touch the .app so macOS Launch Services picks up the new metadata on next
// launch instead of reading a cached entry.
const now = new Date();
fs.utimesSync(electronAppDir, now, now);

// macOS caches CFBundleName aggressively in Launch Services and Spotlight;
// without an explicit flush, the dock + Cmd+Tab + Spotlight keep showing the
// old "Electron" name until reboot. Force re-registration and reindex so a
// fresh `npm install` is enough to see "Steno Dev" everywhere. macOS-only;
// the binaries don't exist on Linux/Windows and aren't needed there anyway.
if (process.platform === 'darwin') {
  const LSREGISTER =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  // `-f` re-reads the bundle's plist; safe to run repeatedly. stdio:'ignore'
  // keeps the install log clean; failures are non-fatal (worst case the user
  // sees the old name until they relaunch the app a second time).
  spawnSync(LSREGISTER, ['-f', electronAppDir], { stdio: 'ignore' });
  spawnSync('mdimport', [electronAppDir], { stdio: 'ignore' });
}

console.log(`[patch-electron-dev] Rebranded Electron.app -> "${APP_NAME}".`);
if (process.platform === 'darwin') {
  // Most macOS surfaces (menu bar, Launch Services, Spotlight on first
  // index) pick up the new name from the lsregister + mdimport above.
  // The Dock + Cmd+Tab tile cache, though, only fully drops at session
  // start — so contributors who ran the old "Electron"-named dev app
  // before this patch will keep seeing the old tile until they log out
  // and back in (or reboot). Fresh installs are unaffected.
  console.log(
    '[patch-electron-dev] If you ran the dev app before this rebrand, log out and back in to refresh the macOS Dock cache.',
  );
}
