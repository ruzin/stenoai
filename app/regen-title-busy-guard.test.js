'use strict';

/**
 * Source-level guard for the #234 delete-while-busy safety net.
 *
 * `regen-meeting-title` reads a note's summary, waits on the model, then REWRITES
 * the original summary path. If that job isn't registered in `activeReprocessJobs`,
 * `isSummaryBusy()` misses it, so a delete during the model wait can commit
 * (unlinking the hidden summary + the audio) while the finishing regen recreates
 * the visible summary — a resurrected note with lost audio.
 *
 * Driving a real title-regen needs a model (out of scope for the model-free T2
 * lane), so we assert the invariant at the source level instead — matching the
 * text-scan pragmatism of ipc-contract.test.js:
 *
 *   1. the regen-meeting-title handler REGISTERS its summaryFile in
 *      activeReprocessJobs and CLEARS it in a finally, exactly like
 *      reprocess-meeting / generate-report-meeting.
 *   2. isSummaryBusy() consults activeReprocessJobs, so (1) makes it return true
 *      for a note with an in-flight title regen.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

// Slice one ipcMain.handle('<channel>', ...) body: from its registration to the
// start of the NEXT ipcMain.handle registration (good enough for a text scan —
// the goal is drift detection, not a full parse).
function handlerBody(channel) {
  const start = MAIN.indexOf(`ipcMain.handle('${channel}'`);
  assert.notStrictEqual(start, -1, `no ipcMain.handle('${channel}') found in main.js`);
  const next = MAIN.indexOf('ipcMain.handle(', start + 1);
  return MAIN.slice(start, next === -1 ? MAIN.length : next);
}

test('isSummaryBusy consults activeReprocessJobs (the map delete registers into)', () => {
  const busy = MAIN.slice(MAIN.indexOf('function isSummaryBusy('));
  const body = busy.slice(0, busy.indexOf('\n}\n'));
  assert.ok(
    /activeReprocessJobs\.keys\(\)/.test(body),
    'isSummaryBusy() must iterate activeReprocessJobs.keys() so a registered regen-title job is seen as busy',
  );
});

test('regen-meeting-title registers + clears activeReprocessJobs (delete-while-busy guard covers title regen)', () => {
  const body = handlerBody('regen-meeting-title');
  assert.ok(
    /activeReprocessJobs\.set\(summaryFile\b/.test(body),
    'regen-meeting-title must register its summaryFile in activeReprocessJobs so isSummaryBusy() blocks a delete during the model wait',
  );
  assert.ok(
    /finally\s*{[^}]*activeReprocessJobs\.delete\(summaryFile\)/s.test(body),
    'regen-meeting-title must clear activeReprocessJobs in a finally so a crash/error never leaves the note stuck-busy',
  );
});

test('reprocess-meeting + generate-report-meeting stay registered too (no regression)', () => {
  for (const channel of ['reprocess-meeting', 'generate-report-meeting']) {
    const body = handlerBody(channel);
    assert.ok(
      /activeReprocessJobs\.set\(summaryFile\b/.test(body),
      `${channel} must register its summaryFile in activeReprocessJobs`,
    );
    assert.ok(
      /activeReprocessJobs\.delete\(summaryFile\)/.test(body),
      `${channel} must clear its activeReprocessJobs entry`,
    );
  }
});
