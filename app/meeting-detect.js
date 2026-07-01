'use strict';

// Bundle-id allowlist for auto-detect "Meeting detected" notifications.
// Prefix match catches helper sub-processes.
const MEETING_APP_ALLOWLIST = [
  // Native videoconf / meeting apps
  /^us\.zoom\.xos/,                    // Zoom
  /^com\.microsoft\.teams/,            // Microsoft Teams (classic + new "teams2")
  /^com\.cisco\.webexmeetingsapp/,     // Cisco Webex
  /^com\.webex\.meetingmanager/,       // Cisco Webex (alt id)
  /^com\.apple\.FaceTime/,             // FaceTime
  /^com\.hnc\.Discord/,                // Discord
  /^com\.tinyspeck\.slackmacgap/,      // Slack (huddles)
  /^com\.logmein\.GoToMeeting/,        // GoToMeeting
  /^com\.bluejeansnet\.BlueJeans/,     // BlueJeans
  /^co\.pop\.desktop/,                 // Pop
  /^com\.google\.meetings/,            // Google Meet (standalone PWA)
  /^com\.apple\.VoiceMemos/,           // Apple Voice Memos
  // Browsers — most web meetings route mic capture through here
  /^com\.apple\.WebKit/,               // Safari (helper)
  /^com\.apple\.Safari/,               // Safari (main)
  /^com\.google\.Chrome/,              // Chrome (+ helpers)
  /^org\.chromium\./,                  // Chromium
  /^com\.microsoft\.edgemac/,          // Edge
  /^company\.thebrowser\.Browser/,     // Arc
  /^com\.brave\.Browser/,              // Brave
  /^org\.mozilla\./,                   // Firefox
];

// Decide whether an app_id-less ("device-level") mic event should still be
// treated as a meeting. macOS 12/13 emit device-level signals with no app_id,
// so the legacy fallback notifies regardless. macOS 14+ always provides an
// app_id, so an app_id-less event there is an AEC / system-audio artifact
// (e.g. a notification ping briefly opening the mic), NOT a meeting — see #262.
function allowsDeviceLevelFallback(platform, systemVersion) {
  if (platform !== 'darwin') return false;
  const major = parseInt(String(systemVersion).split('.')[0], 10);
  if (!Number.isFinite(major)) return false;
  return major < 14;
}

function isMeetingApp(evt, { allowDeviceLevelFallback = false } = {}) {
  if (!evt) return false;
  if (!evt.app_id) return allowDeviceLevelFallback;
  return MEETING_APP_ALLOWLIST.some((re) => re.test(evt.app_id));
}

module.exports = { MEETING_APP_ALLOWLIST, isMeetingApp, allowsDeviceLevelFallback };
