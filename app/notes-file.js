'use strict';

const path = require('path');

// Stem used for a session's sidecar files. The `u` flag mirrors Python's
// re.sub(r'[^a-zA-Z0-9_-]', '_', name), which folds an astral char to one '_'.
function safeSessionStem(sessionName) {
  return String(sessionName == null ? '' : sessionName).replace(/[^a-zA-Z0-9_-]/gu, '_');
}

// Single source of truth for the notes sidecar path — writer and reader MUST
// share it, or they drift (the reader once read the read-only bundle dir and
// silently dropped every note).
function userNotesFilePath(outputDir, sessionName) {
  return path.join(outputDir, `${safeSessionStem(sessionName)}_notes.txt`);
}

module.exports = { safeSessionStem, userNotesFilePath };
