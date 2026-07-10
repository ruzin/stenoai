'use strict';

const path = require('path');

// Sanitize a session name into the stem used for its sidecar files. MUST stay
// in sync with the Python backend, which derives the same stem via
//   re.sub(r'[^a-zA-Z0-9_-]', '_', session_name)
// (see simple_recorder.py _load_user_notes). If these two drift, the note file
// Electron writes won't be the one the pipeline reads.
function safeSessionStem(sessionName) {
  return String(sessionName == null ? '' : sessionName).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Resolve the user-notes sidecar path for a session, given the resolved output
// dir. The writer ('save-meeting-notes') and the reader (stop-recording, which
// decides whether to pass --notes to the pipeline) MUST both go through this so
// they can never point at different directories again.
//
// Regression context: the note was written to the user-data output dir
// but read back from the read-only bundle dir (getBackendCwd()/_internal/output).
// That path doesn't exist for packaged users, so the lookup always missed,
// --notes was never passed, and in-meeting notes were silently dropped from the
// summary — the LLM never saw them.
function userNotesFilePath(outputDir, sessionName) {
  return path.join(outputDir, `${safeSessionStem(sessionName)}_notes.txt`);
}

module.exports = { safeSessionStem, userNotesFilePath };
