'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  isOSUpdateEligible,
  MIN_MACOS_FOR_AUTOUPDATE,
  darwinFloorForMacos,
} = require('./update-os-gate');

const FLOOR = '14.4.0';
const eligible = (platform, osVersion) =>
  isOSUpdateEligible({ platform, osVersion, minVersion: FLOOR });

// --- darwin below the floor: BLOCKED (the whole point of #432) ---

test('darwin macOS 12 blocked', () => {
  assert.strictEqual(eligible('darwin', '12.7.6'), false);
});

test('darwin macOS 13 blocked', () => {
  assert.strictEqual(eligible('darwin', '13.6.9'), false);
});

test('darwin 14.0 blocked (below 14.4, not just below 14)', () => {
  assert.strictEqual(eligible('darwin', '14.0'), false);
});

test('darwin 14.3.1 blocked (minor-version aware)', () => {
  assert.strictEqual(eligible('darwin', '14.3.1'), false);
});

// --- darwin at/above the floor: ALLOWED ---

test('darwin 14.4.0 boundary allowed', () => {
  assert.strictEqual(eligible('darwin', '14.4.0'), true);
});

test('darwin 14.4 (no patch) allowed', () => {
  assert.strictEqual(eligible('darwin', '14.4'), true);
});

test('darwin 14.4.1 allowed', () => {
  assert.strictEqual(eligible('darwin', '14.4.1'), true);
});

test('darwin 14.5 allowed', () => {
  assert.strictEqual(eligible('darwin', '14.5'), true);
});

test('darwin 15.x allowed', () => {
  assert.strictEqual(eligible('darwin', '15.1.1'), true);
});

test('darwin 26.x allowed (future naming)', () => {
  assert.strictEqual(eligible('darwin', '26.0'), true);
});

// --- non-darwin: always eligible (macOS-only floor, Windows untouched) ---

test('win32 always eligible regardless of version', () => {
  assert.strictEqual(eligible('win32', '10.0.19045'), true);
  assert.strictEqual(eligible('win32', '6.1.7601'), true);
});

test('linux always eligible', () => {
  assert.strictEqual(eligible('linux', '0.0.0'), true);
});

// --- fail-open on a parse hiccup (manifest gate is the backstop) ---

test('darwin empty version fails open (eligible)', () => {
  assert.strictEqual(eligible('darwin', ''), true);
});

test('darwin garbled version fails open (eligible)', () => {
  assert.strictEqual(eligible('darwin', 'not-a-version'), true);
  assert.strictEqual(eligible('darwin', '14.x.0'), true);
  assert.strictEqual(eligible('darwin', '14a'), true);
});

test('darwin non-string version fails open (eligible)', () => {
  assert.strictEqual(eligible('darwin', undefined), true);
  assert.strictEqual(eligible('darwin', null), true);
  assert.strictEqual(eligible('darwin', 14.4), true);
});

test('unparseable minVersion fails open (eligible)', () => {
  assert.strictEqual(isOSUpdateEligible({ platform: 'darwin', osVersion: '12.0.0', minVersion: 'oops' }), true);
});

test('no args does not throw and is eligible', () => {
  assert.strictEqual(isOSUpdateEligible(), true);
  assert.strictEqual(isOSUpdateEligible({}), true);
});

// --- config assertion: the runtime floor MUST match the Info.plist/manifest floor ---

test('package.json mac floor matches the runtime gate floor (single-source #432)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const mac = pkg.build && pkg.build.mac;
  assert.ok(mac, 'build.mac block present');
  // The runtime gate constant is the single source; the config floors must both
  // equal it, or a user could be offered / installed a build their OS can't run.
  // NOTE: mac.minimumSystemVersion only sets the Info.plist launch floor — it
  // does NOT reach latest-mac.yml (verified against electron-builder 26.8.1).
  // The manifest floor is written by the release workflow from
  // darwinFloorForMacos(MIN_MACOS_FOR_AUTOUPDATE); see below.
  assert.strictEqual(mac.minimumSystemVersion, MIN_MACOS_FOR_AUTOUPDATE, 'mac.minimumSystemVersion == runtime floor');
  // The Info.plist launch floor must agree too.
  assert.strictEqual(mac.extendInfo.LSMinimumSystemVersion, MIN_MACOS_FOR_AUTOUPDATE, 'LSMinimumSystemVersion == runtime floor');
});

// --- the manifest floor: Darwin, not the product version (#432) ---
// This is the layer that protects installs already in the field, so a wrong
// value here is a SILENT no-op rather than a visible failure.

test('the release manifest floor derives to the Darwin value that blocks macOS 12/13', () => {
  assert.strictEqual(MIN_MACOS_FOR_AUTOUPDATE, '14.4.0');
  assert.strictEqual(darwinFloorForMacos(MIN_MACOS_FOR_AUTOUPDATE), '23.4.0');
});

test('maps macOS product versions to their Darwin equivalents', () => {
  assert.strictEqual(darwinFloorForMacos('14.4'), '23.4.0');
  assert.strictEqual(darwinFloorForMacos('14.0'), '23.0.0');
  assert.strictEqual(darwinFloorForMacos('12'), '21.0.0');
  assert.strictEqual(darwinFloorForMacos('15.2'), '24.2.0');
  // macOS 26 is Darwin 25 — the version jump that rules out `major + 9`.
  assert.strictEqual(darwinFloorForMacos('26.1'), '25.1.0');
});

test('raising the floor to an unmapped major fails the release loudly', () => {
  assert.throws(() => darwinFloorForMacos('27.0'), /No Darwin mapping for macOS 27/);
});

test('a malformed floor throws instead of deriving a plausible-looking value', () => {
  for (const bad of ['sonoma', '14x.4y', '14.', '', '14.4-beta']) {
    assert.throws(() => darwinFloorForMacos(bad), /Unparseable macOS version/, `accepted: ${bad}`);
  }
});
