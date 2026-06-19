'use strict';

// Canonical IPC sentinel strings shared between the Electron main process
// (app/main.js) and the mock IPC layer (app/e2e-mock-ipc.js). These are matched
// by exact string by the renderer across the process boundary (see
// app/renderer/.../MeetingDetail.tsx) and documented in app/docs/ipc-contract.md,
// so every producer must agree on the literal — a typo here would silently break
// the corresponding handling. The renderer can't require this CJS module (it is
// bundled separately and only includes src/**), so it keeps its own named
// constant; ipc-contract.md is the cross-process source of truth. Keep all three
// in sync.

// export-transcript resolves with { success: false, error: EXPORT_CANCELED }
// when the user dismisses the save dialog. The renderer treats this as a silent
// no-op rather than a failure to surface.
const EXPORT_CANCELED = 'canceled';

module.exports = { EXPORT_CANCELED };
