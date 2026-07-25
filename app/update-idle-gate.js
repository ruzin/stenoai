'use strict';

/**
 * Idle auto-install safety gate (feat/idle-auto-install).
 *
 * A downloaded update should install itself and relaunch ONLY when it's safe:
 * the user has opted in, an update is actually staged, and nothing is in
 * flight — no recording, no processing, no queued jobs, no live transcription,
 * no in-flight AI stream, no reprocess/report/title job — and the machine has
 * been idle long enough that a relaunch won't interrupt the user mid-task.
 *
 * This is the one piece of logic where a wrong answer is expensive (installing
 * during a recording would lose data), so it lives here as a pure function with
 * no Electron / config / timer dependencies and is unit-tested exhaustively.
 * main.js is responsible only for gathering the live state and acting on the
 * boolean this returns.
 *
 * FAIL CLOSED: every activity blocker must be *explicitly* boolean `false` to
 * pass. A garbled / undefined / non-boolean value (e.g. a failed state read)
 * is NOT treated as "inactive" — it blocks the install. Only a positive,
 * unambiguous "nothing is happening" signal green-lights the relaunch. The
 * enabling conditions (`enabled`, `updateReady`) likewise require `true`, and
 * the numeric idle inputs must be real numbers.
 *
 * Cross-platform: pure boolean/number logic, no platform branches. The caller
 * feeds it `idleSeconds` from `powerMonitor.getSystemIdleTime()`, which is
 * supported on macOS and Windows alike.
 *
 * @param {Object} state
 * @param {boolean} state.enabled              user opted in (auto_install_when_idle)
 * @param {boolean} state.updateReady          an update has finished downloading
 * @param {boolean} state.isRecording          a recording is active
 * @param {boolean} state.isProcessing         the pipeline is processing a job
 * @param {number}  state.queueLength          jobs waiting in the processing queue
 * @param {boolean} state.liveActive           the live-transcribe sidecar is running
 * @param {boolean} state.streaming            an AI query/summary stream is in flight
 * @param {boolean} state.otherJobsActive      a reprocess/report/regen-title job is running
 * @param {number}  state.idleSeconds          seconds since the last user input
 * @param {number}  state.idleThresholdSeconds required idle time before installing
 * @returns {boolean} true only when it is safe to auto-install + relaunch
 */
function isSafeToAutoInstall({
  enabled,
  updateReady,
  isRecording,
  isProcessing,
  queueLength,
  liveActive,
  streaming,
  otherJobsActive,
  idleSeconds,
  idleThresholdSeconds,
} = {}) {
  return (
    enabled === true &&
    updateReady === true &&
    // Fail closed: each activity flag must be an explicit `false`. Anything
    // else (undefined/null/truthy/garbled) blocks the install.
    isRecording === false &&
    isProcessing === false &&
    liveActive === false &&
    streaming === false &&
    otherJobsActive === false &&
    queueLength === 0 &&
    typeof idleSeconds === 'number' &&
    typeof idleThresholdSeconds === 'number' &&
    idleSeconds >= idleThresholdSeconds
  );
}

module.exports = { isSafeToAutoInstall };
