'use strict';

/**
 * macOS auto-update OS-eligibility gate (#432).
 *
 * The app's Info.plist floor (LSMinimumSystemVersion) is 14.4.0, and macOS
 * Launch Services refuses to LAUNCH the app below that. So an auto-update must
 * never be downloaded or installed onto a Mac under the floor — combined with
 * idle auto-install (#425), doing so would silently replace a working install
 * with one that then won't start (an active brick; see #432). This gate lets
 * main.js skip the whole electron-updater path on an under-floor Mac, so
 * nothing downloads and the idle installer has nothing to apply.
 *
 * Pure and unit-tested, mirroring update-idle-gate.js: main.js supplies the
 * live platform/version, this only decides.
 *
 * FAIL OPEN: the manifest `minimumSystemVersion` in latest-mac.yml is the
 * authoritative second layer — electron-updater's own `isUpdateSupported`
 * honours it before downloading. So if we can't confidently PARSE the version
 * here, we return true (eligible) rather than silently disabling updates for a
 * real, up-to-date user on a parse hiccup; the manifest gate still catches a
 * genuinely old OS. Only a confidently-parsed darwin version strictly BELOW the
 * floor blocks. Non-darwin is always eligible — this floor is macOS-only
 * (Windows has its own update semantics), so the gate must not touch it.
 *
 * WHICH LAYER PROTECTS WHOM. This gate only ever runs inside a build that
 * already meets the floor — Launch Services would not have started it
 * otherwise — so it cannot protect the installs that are actually at risk:
 * those run the PREVIOUS release, which we cannot ship code to. Only the
 * manifest reaches them, and it is what makes the fail-open above safe. See
 * `darwinFloorForMacos` for how that value is produced, and why
 * `build.mac.minimumSystemVersion` alone does not produce it.
 *
 * NOTE: this deliberately does a full major.minor.patch compare, unlike
 * meeting-detect.js's `isMacos14Plus` which only checks the major version —
 * the floor is 14.**4**, so 14.0–14.3 must be blocked too.
 *
 * @param {Object} o
 * @param {string} o.platform   process.platform
 * @param {string} o.osVersion  process.getSystemVersion() (e.g. "14.4.1")
 * @param {string} o.minVersion the floor, e.g. "14.4.0"
 * @returns {boolean} true when an auto-update may proceed on this OS
 */
// The macOS auto-update floor — single source of truth. MUST equal the
// Info.plist / update-manifest floor (`build.mac.minimumSystemVersion` and
// `extendInfo.LSMinimumSystemVersion` in app/package.json); the unit test pins
// all three together so they can't drift. main.js imports this rather than
// redeclaring it.
const MIN_MACOS_FOR_AUTOUPDATE = '14.4.0';

function isOSUpdateEligible({ platform, osVersion, minVersion } = {}) {
  if (platform !== 'darwin') return true; // macOS-only floor; leave other platforms alone
  const cur = parseVersion(osVersion);
  const min = parseVersion(minVersion);
  if (!cur || !min) return true; // fail open on a parse hiccup — see doc above
  return compareVersion(cur, min) >= 0;
}

// Parse "major.minor.patch" into a [major, minor, patch] number triple. A
// MISSING trailing component ("14.4" has no patch) defaults to 0; a PRESENT but
// empty or non-numeric component ("", "14.", "14.x.0") is malformed and returns
// null (→ fail open), so a garbled version never silently reads as "0.0.0" and
// gets blocked as below-floor.
function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split('.');
  const out = [];
  for (let i = 0; i < 3; i++) {
    const raw = parts[i];
    if (raw === undefined) {
      out.push(0); // fewer than 3 components — pad the missing trailing ones
      continue;
    }
    const trimmed = raw.trim();
    const n = parseInt(trimmed, 10);
    if (trimmed === '' || !Number.isInteger(n) || String(n) !== trimmed) return null;
    out.push(n);
  }
  return out;
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

// macOS product major -> Darwin kernel major. Deliberately a table and not
// `major + 9`: that arithmetic holds from macOS 11 to 15 and then breaks, since
// macOS 26 (Tahoe) is Darwin 25. An unmapped major must fail loudly at release
// time rather than silently produce a floor that gates the wrong OS versions.
const MACOS_TO_DARWIN_MAJOR = {
  11: 20, // Big Sur
  12: 21, // Monterey
  13: 22, // Ventura
  14: 23, // Sonoma
  15: 24, // Sequoia
  26: 25, // Tahoe
};

/**
 * Translate the macOS product floor into the value that belongs in
 * `latest-mac.yml` as `minimumSystemVersion`.
 *
 * Two things make this necessary, and both are invisible from the outside:
 *
 * 1. electron-builder never writes the field. `mac.minimumSystemVersion` only
 *    reaches Info.plist as LSMinimumSystemVersion (app-builder-lib
 *    `macPackager.js`), and `ReleaseInfo` in its schema is
 *    `additionalProperties: false`, so no config path produces it. Verified
 *    empirically against electron-builder 26.8.1: a build with
 *    `mac.minimumSystemVersion: 14.4.0` set emits the plist key and a
 *    latest-mac.yml with zero occurrences of `minimumSystemVersion`. The
 *    release workflow therefore writes it in.
 *
 * 2. electron-updater compares the field against `os.release()`, which on
 *    macOS is the DARWIN kernel version, not the product version
 *    (`AppUpdater.checkIfUpdateSupported`). So the product floor `14.4.0` is a
 *    silent no-op: macOS 12 reports Darwin `21.6.0`, which is not lower. The
 *    manifest needs `23.4.0`.
 *
 * The macOS minor tracks the Darwin minor within a major (macOS 14.4 is Darwin
 * 23.4.0), so only the major needs mapping. A patch level in the floor is
 * deliberately dropped rather than carried over: Darwin's third component does
 * not track the macOS patch release, so mapping it would invent a boundary that
 * does not exist. A floor of 14.4.1 therefore gates at 23.4.0, i.e. one macOS
 * patch release more permissive than stated — pick minor-level floors.
 *
 * @param {string} macosVersion a macOS product version, e.g. MIN_MACOS_FOR_AUTOUPDATE
 * @returns {string} Darwin semver for the update manifest, e.g. '23.4.0'
 * @throws {Error} on an unparseable version or an unmapped major
 */
function darwinFloorForMacos(macosVersion) {
  const parsed = parseVersion(macosVersion);
  if (!parsed) {
    throw new Error(`Unparseable macOS version: ${macosVersion}`);
  }
  const [major, minor] = parsed;
  const darwinMajor = MACOS_TO_DARWIN_MAJOR[major];
  if (darwinMajor === undefined) {
    throw new Error(
      `No Darwin mapping for macOS ${major}. Add it to MACOS_TO_DARWIN_MAJOR in app/update-os-gate.js.`
    );
  }
  return `${darwinMajor}.${minor}.0`;
}

module.exports = {
  isOSUpdateEligible,
  MIN_MACOS_FOR_AUTOUPDATE,
  MACOS_TO_DARWIN_MAJOR,
  darwinFloorForMacos,
};
