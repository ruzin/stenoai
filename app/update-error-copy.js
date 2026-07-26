'use strict';

/**
 * User-facing copy for auto-updater failures.
 *
 * electron-updater's `error` event carries developer text: `net::` codes, HTTP
 * status lines, absolute paths inside the app bundle. That string used to go
 * straight into the About tab, which produced messages like
 * "Update download failed: ENOENT: no such file or directory, open
 * '/Applications/Steno.app/Contents/Resources/app-update.yml'" — a stack-trace
 * fragment in an interface that otherwise speaks in sentences, and one that
 * says "download" even when nothing was ever downloaded.
 *
 * So main.js maps the error to one sentence before it reaches the renderer, and
 * keeps the raw text in the debug log where it is actually useful. Pure and
 * unit-tested, mirroring update-idle-gate.js / update-os-gate.js.
 *
 * Three rules the copy follows:
 *  - Name the phase that actually failed. A check that never got off the ground
 *    is not a failed download, and a failed install is neither.
 *  - Say whether the user has to do anything. Most of these resolve themselves
 *    on the next scheduled check, and saying so is the difference between a
 *    warning and a chore.
 *  - Mark whether a later successful check DISPROVES the failure. A dropped
 *    connection does; a full disk, a missing update feed or a permission
 *    problem does not, and clearing those on an unrelated success would hide a
 *    condition that is still true (`sticky`).
 */

const PHASE_CHECK = 'check';
const PHASE_DOWNLOAD = 'download';
const PHASE_INSTALL = 'install';

// Permission failures on the install step — typically an app installed
// somewhere the user cannot write, or a locked bundle. FIRST, because an
// EACCES on app-update.yml is a permission problem, not a missing feed.
const PERMISSION_RE = /(EACCES|EPERM|permission denied|not permitted|read-?only file system|EROFS)/i;

// Integrity failures. Deliberately distinct from a transfer error: the bytes
// arrived, they just could not be trusted, and nothing was installed.
const INTEGRITY_RE = /(sha512|checksum|signature|not signed|integrity)/i;

const DISK_RE = /(ENOSPC|no space left|not enough space)/i;

// The bundle was built without an update feed (a `--dir` pack, or a build whose
// publish config was stripped). Users never see this; developers testing a local
// build do, and the honest answer is that this build cannot update at all.
// Requires the "missing" part too, so an unrelated error that merely names the
// file doesn't land here.
const NOT_CONFIGURED_RE =
  /(ENOENT|no such file|cannot find|not found)[^]*app-update\.yml|app-update\.yml[^]*(ENOENT|no such file|cannot find|not found)/i;

// The server answered, just not usefully. Checked BEFORE the transport branch:
// Chromium reports these as net::ERR_HTTP_RESPONSE_CODE_FAILURE, which would
// otherwise read as "check your connection" for what is a server-side problem.
const HTTP_STATUS_RE =
  /(ERR_HTTP_RESPONSE_CODE_FAILURE|HTTP (4\d\d|5\d\d)|status(?: code)?:? (4\d\d|5\d\d)|\b(403|404|500|502|503)\b)/i;

// Transport-level failures: no route to the update server, or the connection
// died mid-transfer. Node errno strings and Chromium net:: codes, since
// electron-updater surfaces both depending on which layer failed. Deliberately
// no bare "network" keyword — it matches file paths.
const NETWORK_RE =
  /(ENOTFOUND|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENETDOWN|ENETUNREACH|EHOSTUNREACH|net::ERR_|socket hang up|network (is )?(unreachable|error|timed out)|timed? ?out)/i;

/**
 * Which phase an updater error belongs to. main.js owns the live state; this
 * only decides, so the decision is unit-testable.
 *
 * `installing` wins over `downloadInFlight`: applying a staged update is the
 * later, more specific phase. Note that a staged update on its own means
 * NOTHING — a periodic check can fail long after a download succeeded, and
 * calling that a failed download is exactly the bug this module fixes.
 *
 * @param {Object} o
 * @param {boolean} [o.downloadInFlight] a transfer was actually running
 * @param {boolean} [o.installing]       quitAndInstall had been called
 * @returns {'check'|'download'|'install'}
 */
function updateErrorPhase({ downloadInFlight = false, installing = false } = {}) {
  if (installing) return PHASE_INSTALL;
  if (downloadInFlight) return PHASE_DOWNLOAD;
  return PHASE_CHECK;
}

/**
 * @param {unknown} rawMessage the electron-updater error message
 * @param {Object} [o]
 * @param {'check'|'download'|'install'} [o.phase]
 * @param {string} [o.platform] defaults to the running platform; injectable so
 *   the platform-specific copy is testable on either OS
 * @returns {{ message: string, sticky: boolean }} one sentence for the About
 *   tab, plus whether a later successful check leaves it standing
 */
function describeUpdateError(
  rawMessage,
  { phase = PHASE_CHECK, platform = process.platform } = {}
) {
  const msg = typeof rawMessage === 'string' ? rawMessage : String(rawMessage || '');

  if (PERMISSION_RE.test(msg)) {
    // Two things vary here, and getting either wrong makes the sentence a lie.
    //
    // The phase: a permission failure while fetching is about writing the
    // downloaded file into the cache, not about where the app lives, so the
    // Applications-folder hint would send the user somewhere that cannot help.
    // Reading the feed (check) and swapping the bundle (install) are both about
    // the app's own location, so there the hint is the actual fix.
    //
    // The platform: there is no Applications folder on Windows. CLAUDE.md's
    // cross-platform rule applies to copy as much as to code — a macOS-only
    // instruction must not reach a Windows user.
    // Naming the wrong phase is the exact failure this module exists to stop,
    // so all three get their own verb: nothing is installed when a check or a
    // download fails.
    const what =
      phase === PHASE_DOWNLOAD
        ? 'save the update'
        : phase === PHASE_CHECK
          ? 'check for updates'
          : 'install the update';
    // The hint is about where the app itself lives, which is what a check or an
    // install trips over. A download writes to the cache, so it would be advice
    // that cannot help.
    const hint =
      platform === 'darwin' && phase !== PHASE_DOWNLOAD
        ? ' Try moving Steno to your Applications folder.'
        : '';
    return {
      message: `Steno doesn't have permission to ${what}.${hint}`,
      sticky: true,
    };
  }
  if (INTEGRITY_RE.test(msg)) {
    return {
      message: "The update couldn't be verified, so it wasn't installed. Steno will try again later.",
      sticky: false,
    };
  }
  if (DISK_RE.test(msg)) {
    return {
      message: 'There is not enough disk space to download the update.',
      sticky: true,
    };
  }
  if (NOT_CONFIGURED_RE.test(msg)) {
    return { message: 'This build is not set up for automatic updates.', sticky: true };
  }
  if (HTTP_STATUS_RE.test(msg)) {
    return {
      message: "The update server didn't respond as expected. Steno will try again later.",
      sticky: false,
    };
  }
  if (NETWORK_RE.test(msg)) {
    return {
      message:
        phase === PHASE_CHECK
          ? "Steno couldn't reach the update server. Check your connection — it will try again later."
          : 'The update download was interrupted. Steno will try again later.',
      sticky: false,
    };
  }

  if (phase === PHASE_INSTALL) {
    return {
      message: "The update couldn't be installed. Restart Steno to try again.",
      sticky: true,
    };
  }
  return {
    message:
      phase === PHASE_DOWNLOAD
        ? "The update didn't finish downloading. Steno will try again later."
        : "Steno couldn't check for updates. It will try again later.",
    sticky: false,
  };
}

module.exports = {
  describeUpdateError,
  updateErrorPhase,
  PHASE_CHECK,
  PHASE_DOWNLOAD,
  PHASE_INSTALL,
};
