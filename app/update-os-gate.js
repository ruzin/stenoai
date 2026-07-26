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

module.exports = { isOSUpdateEligible, MIN_MACOS_FOR_AUTOUPDATE };
