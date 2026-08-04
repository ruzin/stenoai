'use strict';

/**
 * Backend CLI seam — the spawn wrapper, process-tree kill, bundled-backend
 * path resolution, and the `runPythonScript` invoker that ~90 call sites in
 * main.js depend on. Carved out of app/main.js (RFC #327, Phase 0) with ZERO
 * behavior change: the code is a verbatim move; only the cross-cutting seams
 * (logging + diagnostics forwarding, and electron's `app`) are injected via
 * `createBackendCli(deps)` so main.js stays the one place that wires them.
 *
 * `spawn` and `killProcessTree` are pure (child_process + process only) and
 * exported directly for unit coverage. `getBackendPath`/`getBackendCwd`/
 * `runPythonScript` need electron's `app` and the logging seams, so they come
 * out of the factory. Importing this module does NOT require electron — `app`
 * is only touched when getBackendPath/getBackendCwd are actually called — so
 * the pure exports stay testable under `node --test`.
 */

const path = require('path');
const { spawn: _spawnRaw } = require('child_process');

// Wrap spawn so every backend / ollama launch defaults to windowsHide:true.
// The PyInstaller backend (stenoai.exe) and bundled ollama.exe are console
// subsystem binaries; without this Electron pops a visible console window on
// Windows for every recording, live-transcribe, query, and the long-lived
// `ollama serve` keeps one open for the whole session. No-op on macOS/Linux.
// Callers can still override by passing an explicit windowsHide.
function spawn(command, args, options) {
  if (Array.isArray(args) || args === undefined || args === null) {
    return _spawnRaw(command, args, { windowsHide: true, ...(options || {}) });
  }
  // 2-arg form: spawn(command, options)
  return _spawnRaw(command, { windowsHide: true, ...args });
}

// Terminate a process AND its child processes. On Windows `process.kill(pid)`
// only kills the named process, orphaning its children — `ollama serve` spawns
// per-model "runner" subprocesses that would leak after quit. `taskkill /T`
// walks the whole tree. On POSIX we keep the existing SIGTERM -> SIGKILL
// escalation (ollama tears its runners down on SIGTERM there). Synchronous on
// Windows (execFileSync) so it completes during the app's will-quit handler.
function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      require('child_process').execFileSync(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
    } catch (_) {}
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  setTimeout(() => {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }, 1000);
}

/**
 * @param {object} deps
 * @param {import('electron').App} deps.app            electron app (isPackaged / resourcesPath)
 * @param {(msg: string) => void} deps.sendDebugLog    renderer debug-panel logger
 * @param {(args: string[]) => string} deps.sanitizeArgsForLog  PII-scrub for the echoed argv
 * @param {(proc, label) => void} deps.attachProcessingStderr   persistent stderr capture (opt-in)
 * @param {(line: string, source: string) => void} deps.forwardDiagnosticStdout  structural stdout markers
 */
function createBackendCli({
  app,
  sendDebugLog,
  sanitizeArgsForLog,
  attachProcessingStderr,
  forwardDiagnosticStdout,
}) {
  // Backend executable path - always use bundled stenoai
  function getBackendPath() {
    const exe = process.platform === 'win32' ? 'stenoai.exe' : 'stenoai';
    if (app.isPackaged) {
      // Production: bundled in app resources
      return path.join(process.resourcesPath, 'stenoai', exe);
    } else {
      // Development: use local build
      return path.join(__dirname, '..', 'dist', 'stenoai', exe);
    }
  }

  function getBackendCwd() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'stenoai');
    } else {
      return path.join(__dirname, '..', 'dist', 'stenoai');
    }
  }

  function runPythonScript(script, args = [], silent = false, extraEnv = {}, logLabel = null) {
    return new Promise((resolve, reject) => {
      const backendPath = getBackendPath();

      // Log the command being executed (unless silent)
      console.log('Running:', `${backendPath} ${args.join(' ')}`);
      if (!silent) {
        // Sanitize the echoed argv: denylisted commands (query, save-template,
        // set-user-name/storage-path, folder + URL setters) carry content/PII in
        // their args. This rewrites the LOGGED string only; the spawned `args`
        // below are untouched.
        sendDebugLog(`$ stenoai ${sanitizeArgsForLog(args)}`);
      }

      const process = spawn(backendPath, args, {
        cwd: getBackendCwd(),
        env: Object.keys(extraEnv).length > 0 ? { ...require('process').env, ...extraEnv } : undefined
      });

      // Opt-in persistent capture for the legacy process-recording path only.
      // Default null → generic backend calls (config reads, chat query, …) are
      // NOT persisted, preserving the no-global-tee privacy boundary.
      if (logLabel) attachProcessingStderr(process, logLabel);

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('Python stdout:', output);
        // Stream stdout to debug panel in real-time (unless silent), but only the
        // structural diagnostic markers — query answers and other content are
        // dropped so they never reach the shareable buffer.
        if (!silent) {
          output.split('\n').forEach(line => {
            forwardDiagnosticStdout(line, 'backend');
          });
        }
      });

      process.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.log('Python stderr:', output);
        // Stream stderr to debug panel in real-time (unless silent)
        if (!silent) {
          output.split('\n').forEach(line => {
            if (line.trim()) sendDebugLog('STDERR: ' + line.trim());
          });
        }
      });

      process.on('close', (code) => {
        if (!silent) {
          sendDebugLog(`Command completed with exit code: ${code}`);
        }
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Python script failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        sendDebugLog(`Command error: ${error.message}`);
        reject(error);
      });
    });
  }

  return { getBackendPath, getBackendCwd, runPythonScript };
}

module.exports = { spawn, killProcessTree, createBackendCli };
