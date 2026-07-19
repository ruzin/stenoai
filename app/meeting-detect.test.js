const { test } = require('node:test');
const assert = require('node:assert');

const { isMeetingApp, allowsDeviceLevelFallback } = require('./meeting-detect');

test('isMeetingApp accepts a known meeting app bundle id', () => {
  assert.strictEqual(isMeetingApp({ app_id: 'us.zoom.xos' }), true);
  assert.strictEqual(isMeetingApp({ app_id: 'com.microsoft.teams2' }), true);
});

test('isMeetingApp accepts browser helper-process bundle ids', () => {
  // Chromium browsers capture the mic in a helper process, whose bundle id
  // may differ in case from the main app (Arc: company.thebrowser.Browser
  // vs company.thebrowser.browser.helper).
  assert.strictEqual(isMeetingApp({ app_id: 'company.thebrowser.browser.helper' }), true);
  assert.strictEqual(isMeetingApp({ app_id: 'company.thebrowser.Browser' }), true);
  assert.strictEqual(isMeetingApp({ app_id: 'com.google.Chrome.helper' }), true);
});

test('isMeetingApp rejects a non-allowlisted app bundle id', () => {
  assert.strictEqual(isMeetingApp({ app_id: 'com.example.Conductor' }), false);
});

test('isMeetingApp ignores an app_id-less (device-level) event by default', () => {
  // The macOS 14+ regression: AEC/notification-ping events arrive with no
  // app_id and must NOT be treated as a meeting.
  assert.strictEqual(isMeetingApp({ event: 'start' }), false);
  assert.strictEqual(isMeetingApp({ app_id: '' }), false);
});

test('isMeetingApp rejects a null/undefined event even with the fallback allowed', () => {
  // A missing event is not a meeting, regardless of the device-level fallback —
  // the fallback only applies to an event that exists but carries no app_id.
  assert.strictEqual(isMeetingApp(null, { allowDeviceLevelFallback: true }), false);
  assert.strictEqual(isMeetingApp(undefined, { allowDeviceLevelFallback: true }), false);
  assert.strictEqual(isMeetingApp(null), false);
});

test('isMeetingApp honors the device-level fallback when explicitly allowed', () => {
  // Legacy macOS 12/13 path: device-level events have no app_id and we still
  // want to notify there.
  assert.strictEqual(
    isMeetingApp({ event: 'start' }, { allowDeviceLevelFallback: true }),
    true,
  );
});

test('allowsDeviceLevelFallback is false on macOS 14+ (app_id always present)', () => {
  assert.strictEqual(allowsDeviceLevelFallback('darwin', '14.5'), false);
  assert.strictEqual(allowsDeviceLevelFallback('darwin', '15.0'), false);
});

test('allowsDeviceLevelFallback is true on legacy macOS 12/13', () => {
  assert.strictEqual(allowsDeviceLevelFallback('darwin', '13.6.1'), true);
  assert.strictEqual(allowsDeviceLevelFallback('darwin', '12.0'), true);
});

test('allowsDeviceLevelFallback is false off macOS', () => {
  assert.strictEqual(allowsDeviceLevelFallback('win32', '10.0.22631'), false);
  assert.strictEqual(allowsDeviceLevelFallback('linux', '6.1'), false);
});

test('allowsDeviceLevelFallback is false for an unparseable version (fail safe)', () => {
  assert.strictEqual(allowsDeviceLevelFallback('darwin', ''), false);
  assert.strictEqual(allowsDeviceLevelFallback('darwin', undefined), false);
});
