const { app, BrowserWindow, ipcMain, dialog, shell, systemPreferences, globalShortcut, safeStorage, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const { URL, URLSearchParams } = require('url');
const crypto = require('crypto');
const { PostHog } = require('posthog-node');
const { initMain } = require('electron-audio-loopback');

// Initialize electron-audio-loopback before app is ready
initMain();

let mainWindow;
let pythonProcess;
let tray = null;
let isQuitting = false;

// Backend executable path - always use bundled stenoai
function getBackendPath() {
  if (app.isPackaged) {
    // Production: bundled in app resources
    return path.join(process.resourcesPath, 'stenoai', 'stenoai');
  } else {
    // Development: use local build
    return path.join(__dirname, '..', 'dist', 'stenoai', 'stenoai');
  }
}

function getBackendCwd() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'stenoai');
  } else {
    return path.join(__dirname, '..', 'dist', 'stenoai');
  }
}

// Telemetry state
let posthogClient = null;
let telemetryEnabled = false;
let anonymousId = null;

const POSTHOG_API_KEY = 'phc_U2cnTyIyKGNSVaK18FyBMltd8nmN7uHxhhm21fAHwqb';
const POSTHOG_HOST = 'https://us.i.posthog.com';

// Google Calendar OAuth2 configuration
const GOOGLE_CLIENT_ID = '281073275073-20da4u5t9luk2366vd5ai0a2r55d5pf5.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Outlook Calendar OAuth2 configuration (PKCE public client — no client secret)
const OUTLOOK_CLIENT_ID = '53a8ba1f-3a2e-4fc9-afb1-b9b8ff13de19';
const OUTLOOK_SCOPES = 'Calendars.Read offline_access';
const OUTLOOK_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const OUTLOOK_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

/**
 * Return a privacy-safe duration bucket string.
 */
function durationBucket(seconds) {
  if (seconds < 60) return '<1m';
  if (seconds < 300) return '1-5m';
  if (seconds < 900) return '5-15m';
  if (seconds < 1800) return '15-30m';
  if (seconds < 3600) return '30-60m';
  return '60m+';
}

/**
 * Initialize PostHog telemetry by reading config from Python backend.
 */
async function initTelemetry() {
  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(getBackendPath(), ['get-telemetry'], {
        cwd: getBackendCwd()
      });
      let stdout = '';
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`get-telemetry exited with code ${code}`));
      });
      proc.on('error', reject);
    });

    const config = JSON.parse(result.trim());
    telemetryEnabled = config.telemetry_enabled;
    anonymousId = config.anonymous_id;

    if (telemetryEnabled) {
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
      // Identify user for DAU tracking
      posthogClient.identify({
        distinctId: anonymousId,
        properties: {
          platform: process.platform,
          arch: process.arch
        }
      });
      console.log('Telemetry initialized (anonymous analytics enabled)');
    } else {
      console.log('Telemetry disabled by user preference');
    }
  } catch (error) {
    console.error('Failed to initialize telemetry:', error.message);
    telemetryEnabled = false;
  }
}

/**
 * Track an analytics event. Silent fail -- never throws.
 */
function trackEvent(eventName, properties = {}) {
  try {
    if (!telemetryEnabled || !posthogClient || !anonymousId) return;

    const packagePath = path.join(__dirname, 'package.json');
    const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    posthogClient.capture({
      distinctId: anonymousId,
      event: eventName,
      properties: {
        app_version: packageContent.version,
        platform: process.platform,
        arch: process.arch,
        ...properties
      }
    });
  } catch (error) {
    // Silent fail -- telemetry must never break the app
  }
}

/**
 * Flush and shut down the PostHog client.
 */
async function shutdownTelemetry() {
  try {
    if (posthogClient) {
      await posthogClient.shutdown();
      posthogClient = null;
      console.log('Telemetry shut down');
    }
  } catch (error) {
    // Silent fail
  }
}

/**
 * Get the list of allowed base directories, including any custom storage path.
 */
let _cachedCustomStoragePath = null;
function getAllowedBaseDirs() {
  const projectRoot = path.join(__dirname, '..');
  const dirs = [
    projectRoot,
    path.join(os.homedir(), 'Library', 'Application Support', 'stenoai')
  ];
  if (_cachedCustomStoragePath) {
    dirs.push(_cachedCustomStoragePath);
  }
  return dirs;
}

/**
 * Validate that a file path is within allowed directories (security)
 * Prevents path traversal attacks by ensuring files are only accessed
 * within the app's designated data directories
 */
function validateSafeFilePath(filepath, allowedBaseDirs) {
  if (!filepath) return false;

  try {
    // Resolve to absolute path and normalize
    const resolvedPath = path.resolve(filepath);

    // Ensure it's within one of the allowed base directories
    for (const baseDir of allowedBaseDirs) {
      const resolvedBase = path.resolve(baseDir);
      if (resolvedPath.startsWith(resolvedBase + path.sep) || resolvedPath === resolvedBase) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error validating file path:', error);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'hiddenInset',
    show: false
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // On macOS, hide to tray instead of destroying (like Slack, Spotify)
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (pythonProcess) {
      pythonProcess.kill();
    }
  });
}

function getTrayIconPath(recording) {
  const iconName = recording ? 'trayIconRecordingTemplate' : 'trayIconTemplate';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', `${iconName}.png`);
  }
  return path.join(__dirname, 'assets', `${iconName}.png`);
}

function createTray() {
  const icon = nativeImage.createFromPath(getTrayIconPath(false));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('StenoAI');

  updateTrayMenu();
}

function updateTrayIcon(recording) {
  if (!tray) return;
  const icon = nativeImage.createFromPath(getTrayIconPath(recording));
  icon.setTemplateImage(true);
  tray.setImage(icon);
  tray.setToolTip(recording ? 'StenoAI - Recording' : 'StenoAI');
  updateTrayMenu();
}

function showAndFocusWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const isRecording = currentRecordingProcess !== null || systemAudioRecordingActive;

  const appVersion = require('./package.json').version;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open StenoAI',
      click: showAndFocusWindow
    },
    {
      label: isRecording ? 'Stop Recording' : 'Start Recording',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send(isRecording ? 'tray-stop-recording' : 'tray-start-recording');
        }
      }
    },
    {
      label: 'Settings',
      click: () => {
        showAndFocusWindow();
        if (mainWindow) {
          mainWindow.webContents.send('tray-open-settings');
        }
      }
    },
    {
      label: 'Hide StenoAI',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    {
      label: `StenoAI v${appVersion}`,
      enabled: false
    },
    {
      label: 'Report a Bug',
      click: () => {
        shell.openExternal('https://discord.gg/DZ6vcQnxxu');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit StenoAI',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

app.on('before-quit', async (event) => {
  if (isQuitting) return;

  // Use synchronous flag -- systemAudioRecordingActive is updated via IPC on each state change
  if (currentRecordingProcess || systemAudioRecordingActive) {
    event.preventDefault();
    const { response } = await dialog.showMessageBox(mainWindow || null, {
      type: 'warning',
      buttons: ['Cancel', 'Stop & Quit'],
      defaultId: 0,
      cancelId: 0,
      title: 'Recording in Progress',
      message: 'A recording is still in progress. Quitting will stop and save the recording.',
    });
    if (response === 1) {
      if (currentRecordingProcess) {
        currentRecordingProcess.kill('SIGTERM');
        currentRecordingProcess = null;
      }
      if (systemAudioRecordingActive && mainWindow && !mainWindow.isDestroyed()) {
        try {
          await mainWindow.webContents.executeJavaScript('stopSystemAudioRecording("quit")');
        } catch (e) {
          // Best effort -- file is saved even if processing doesn't start
        }
      }
      systemAudioRecordingActive = false;
      updateTrayIcon(false);
      isQuitting = true;
      app.quit();
    }
  } else if (isProcessing || processingQueue.length > 0) {
    event.preventDefault();
    const jobCount = processingQueue.length + (isProcessing ? 1 : 0);
    const { response } = await dialog.showMessageBox(mainWindow || null, {
      type: 'warning',
      buttons: ['Cancel', 'Quit Anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Processing in Progress',
      message: `${jobCount} recording${jobCount > 1 ? 's are' : ' is'} still being processed. Quitting will cancel processing.`,
    });
    if (response === 1) {
      isQuitting = true;
      app.quit();
    }
  } else {
    isQuitting = true;
  }
});

app.whenReady().then(async () => {
  // Set application menu with Help > Learn More
  const appMenu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: () => {
            shell.openExternal('https://github.com/ruzin/stenoai');
          }
        },
        {
          label: 'Report a Bug',
          click: () => {
            shell.openExternal('https://discord.gg/DZ6vcQnxxu');
          }
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(appMenu);

  createWindow();
  createTray();

  // Initialize telemetry and track app open
  await initTelemetry();
  trackEvent('app_opened');

  // Load custom storage path for file validation
  try {
    const spResult = await runPythonScript('simple_recorder.py', ['get-storage-path'], true);
    const spData = JSON.parse(spResult.trim());
    if (spData.storage_path) {
      _cachedCustomStoragePath = spData.storage_path;
      console.log('Custom storage path loaded:', _cachedCustomStoragePath);
    }
  } catch (e) {
    // Non-fatal - custom path just won't be cached
  }

  // Register global hotkey for toggle recording (Cmd+Shift+R on macOS, Ctrl+Shift+R on Windows/Linux)
  const hotkeyModifier = process.platform === 'darwin' ? 'Command+Shift+R' : 'Ctrl+Shift+R';
  const registered = globalShortcut.register(hotkeyModifier, () => {
    console.log('Global hotkey triggered: toggle recording');
    if (mainWindow) {
      mainWindow.webContents.send('toggle-recording-hotkey');
    }
  });

  if (registered) {
    console.log(`Global hotkey registered: ${hotkeyModifier}`);
  } else {
    console.error(`Failed to register global hotkey: ${hotkeyModifier}`);
  }
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  // Kill Ollama if we started it
  if (ollamaStartedByUs && ollamaProcess) {
    try {
      ollamaProcess.kill();
    } catch (e) {
      // Process may have already exited
    }
  }
  await shutdownTelemetry();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});

// Focus window handler (used by notification click to bring app to foreground)
ipcMain.on('focus-window', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

// Microphone permission handlers
ipcMain.handle('check-microphone-permission', async () => {
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    console.log('Microphone permission status:', status);
    return { success: true, status };
  } catch (error) {
    console.error('Error checking microphone permission:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('request-microphone-permission', async () => {
  try {
    console.log('Requesting microphone permission...');
    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log('Microphone permission granted:', granted);
    return { success: true, granted };
  } catch (error) {
    console.error('Error requesting microphone permission:', error);
    return { success: false, error: error.message };
  }
});

// Debug functionality handled by side panel now

// Backend communication - always uses bundled stenoai executable
function runPythonScript(script, args = [], silent = false) {
  return new Promise((resolve, reject) => {
    const backendPath = getBackendPath();
    const command = `${backendPath} ${args.join(' ')}`;

    // Log the command being executed (unless silent)
    console.log('Running:', command);
    if (!silent) {
      sendDebugLog(`$ stenoai ${args.join(' ')}`);
    }

    const process = spawn(backendPath, args, {
      cwd: getBackendCwd()
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('Python stdout:', output);
      // Stream stdout to debug panel in real-time (unless silent)
      if (!silent) {
        output.split('\n').forEach(line => {
          if (line.trim()) sendDebugLog(line.trim());
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

// IPC Handlers - Separate start/stop with better error handling
ipcMain.handle('start-recording', async (event, sessionName) => {
  try {
    sendDebugLog(`Starting recording session: ${sessionName || 'Meeting'}`);
    sendDebugLog('$ python simple_recorder.py start');

    // Start recording (removed clear-state to prevent race conditions)
    const result = await runPythonScript('simple_recorder.py', ['start', sessionName || 'Meeting']);

    if (result.includes('SUCCESS')) {
      sendDebugLog('Recording started successfully');
      trackEvent('recording_started');
      return { success: true, message: result };
    } else {
      sendDebugLog(`Recording failed: ${result}`);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('Start recording error:', error.message);
    sendDebugLog(`Recording error: ${error.message}`);
    trackEvent('error_occurred', { error_type: 'start_recording' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-recording', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['stop']);

    if (result.includes('SUCCESS') || result.includes('Recording saved')) {
      trackEvent('recording_stopped');
      return { success: true, message: result };
    } else {
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('Stop recording error:', error.message);
    trackEvent('error_occurred', { error_type: 'stop_recording' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-status', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['status'], true); // Silent mode
    return { success: true, status: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('process-recording', async (event, audioFile, sessionName) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['process', audioFile, '--name', sessionName]);
    trackEvent('transcription_completed', { success: true });
    trackEvent('summarization_completed', { success: true });
    return { success: true, result: result };
  } catch (error) {
    trackEvent('error_occurred', { error_type: 'process_recording' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-system', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['test']);
    return { success: true, result: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'm4a', 'aac', 'webm'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, filePath: result.filePaths[0] };
  }
  
  return { success: false, error: 'No file selected' };
});

ipcMain.handle('list-meetings', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-meetings'], true); // Silent mode
    return { success: true, meetings: JSON.parse(result) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-state', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['clear-state']);
    return { success: true, message: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reprocess-meeting', async (event, summaryFile) => {
  try {
    sendDebugLog(`🔄 Reprocessing meeting: ${summaryFile}`);
    sendDebugLog(`$ python simple_recorder.py reprocess "${summaryFile}"`);

    const result = await runPythonScript('simple_recorder.py', ['reprocess', summaryFile]);

    sendDebugLog('✅ Meeting reprocessed successfully');
    return { success: true, message: result };
  } catch (error) {
    sendDebugLog(`❌ Reprocessing failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('query-transcript', async (event, summaryFile, question) => {
  try {
    sendDebugLog(`🤖 Querying transcript: ${question.substring(0, 50)}...`);

    // Run the query command
    const result = await runPythonScript('simple_recorder.py', ['query', summaryFile, '-q', question]);

    // Parse the JSON response
    try {
      const jsonResponse = JSON.parse(result.trim());
      if (jsonResponse.success) {
        sendDebugLog('✅ Query answered successfully');
        trackEvent('ai_query_used', { success: true });
        return { success: true, answer: jsonResponse.answer };
      } else {
        sendDebugLog(`❌ Query failed: ${jsonResponse.error}`);
        trackEvent('ai_query_used', { success: false });
        return { success: false, error: jsonResponse.error };
      }
    } catch (parseError) {
      // If parsing fails, check if the result contains any JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonResponse = JSON.parse(jsonMatch[0]);
        if (jsonResponse.success) {
          trackEvent('ai_query_used', { success: true });
          return { success: true, answer: jsonResponse.answer };
        } else {
          trackEvent('ai_query_used', { success: false });
          return { success: false, error: jsonResponse.error };
        }
      }
      sendDebugLog(`❌ Failed to parse query response: ${parseError.message}`);
      trackEvent('ai_query_used', { success: false });
      return { success: false, error: 'Failed to parse AI response' };
    }
  } catch (error) {
    sendDebugLog(`❌ Query failed: ${error.message}`);
    trackEvent('error_occurred', { error_type: 'query_transcript' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-meeting', async (event, summaryFilePath, updates) => {
  try {
    const projectRoot = path.join(__dirname, '..');

    // Define allowed base directories for file operations (includes custom storage)
    const allowedBaseDirs = getAllowedBaseDirs();

    // Convert to absolute path if needed
    const absolutePath = path.isAbsolute(summaryFilePath)
      ? summaryFilePath
      : path.join(projectRoot, summaryFilePath);

    // Security: Validate file path is within allowed directories
    if (!validateSafeFilePath(absolutePath, allowedBaseDirs)) {
      console.error(`Security: Blocked attempt to update file outside allowed directories: ${absolutePath}`);
      return {
        success: false,
        error: 'Invalid file path'
      };
    }

    // Read existing data
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: 'Meeting file not found'
      };
    }

    const data = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));

    // Update fields - only update fields that are provided
    if (updates.name !== undefined) {
      data.session_info.name = updates.name;
    }
    if (updates.summary !== undefined) {
      data.summary = updates.summary;
    }
    if (updates.participants !== undefined) {
      data.participants = updates.participants;
    }
    if (updates.key_points !== undefined) {
      data.key_points = updates.key_points;
    }
    if (updates.action_items !== undefined) {
      data.action_items = updates.action_items;
    }

    // Add updated timestamp
    data.session_info.updated_at = new Date().toISOString();

    // Write back to file
    fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf8');

    console.log(`Updated meeting: ${absolutePath}`);

    return {
      success: true,
      message: 'Meeting updated successfully',
      updatedData: data
    };
  } catch (error) {
    console.error('Update meeting error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-meeting', async (event, meetingData) => {
  try {
    const fs = require('fs');
    const path = require('path');

    // meetingData is the actual meeting object, not a file path
    const meeting = meetingData;

    // Build correct file paths from the meeting data - convert to absolute paths
    const projectRoot = path.join(__dirname, '..');

    // Define allowed base directories for file operations (includes custom storage)
    const allowedBaseDirs = getAllowedBaseDirs();

    const summaryFile = meeting.session_info?.summary_file;
    const transcriptFile = meeting.session_info?.transcript_file;

    // Convert relative paths to absolute paths
    const absolutePaths = [];
    if (summaryFile) {
      absolutePaths.push(path.isAbsolute(summaryFile) ? summaryFile : path.join(projectRoot, summaryFile));
    }
    if (transcriptFile) {
      absolutePaths.push(path.isAbsolute(transcriptFile) ? transcriptFile : path.join(projectRoot, transcriptFile));
    }

    console.log('Attempting to delete files:', absolutePaths);

    let deletedCount = 0;
    let validationErrors = 0;

    // Delete all related files with path validation
    for (const file of absolutePaths) {
      try {
        // Security: Validate file path is within allowed directories
        if (!validateSafeFilePath(file, allowedBaseDirs)) {
          console.error(`Security: Blocked attempt to delete file outside allowed directories: ${file}`);
          validationErrors++;
          continue;
        }

        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          deletedCount++;
          console.log(`Deleted: ${file}`);
        } else {
          console.log(`File not found (already deleted?): ${file}`);
        }
      } catch (err) {
        console.warn(`Could not delete ${file}:`, err.message);
      }
    }

    if (validationErrors > 0) {
      return {
        success: false,
        error: `Blocked ${validationErrors} file deletion(s) due to security validation`
      };
    }
    
    return { 
      success: true, 
      message: `Deleted meeting and ${deletedCount} associated files` 
    };
  } catch (error) {
    console.error('Delete meeting error:', error);
    return { success: false, error: error.message };
  }
});

// Queue status handler
ipcMain.handle('get-queue-status', async () => {
  return {
    success: true,
    isProcessing,
    queueSize: processingQueue.length,
    currentJob: currentProcessingJob?.sessionName || null,
    hasRecording: currentRecordingProcess !== null || systemAudioRecordingActive
  };
});

// Global recording state management
let systemAudioRecordingActive = false;  // Track system audio recording for tray/quit
let currentRecordingProcess = null;
let processingQueue = [];
let isProcessing = false;
let currentProcessingJob = null;
let ollamaProcess = null;  // Track spawned Ollama process for cleanup on quit
let ollamaStartedByUs = false;

// Processing queue management
async function processNextInQueue() {
  if (isProcessing || processingQueue.length === 0) {
    return;
  }
  
  isProcessing = true;
  currentProcessingJob = processingQueue.shift();
  
  console.log(`🔄 Processing queued job: ${currentProcessingJob.sessionName}`);
  
  try {
    const result = await runPythonScript('simple_recorder.py', ['process', currentProcessingJob.audioFile, '--name', currentProcessingJob.sessionName]);
    console.log(`✅ Completed processing: ${currentProcessingJob.sessionName}`);
    trackEvent('transcription_completed', { success: true });
    trackEvent('summarization_completed', { success: true });
    
    // Notify frontend about completion with processed meeting data
    if (mainWindow) {
      try {
        // Get the specific processed meeting data
        const meetingsResult = await runPythonScript('simple_recorder.py', ['list-meetings'], true);
        const allMeetings = JSON.parse(meetingsResult);
        const processedMeeting = allMeetings.find(m => m.session_info?.name === currentProcessingJob.sessionName);
        
        mainWindow.webContents.send('processing-complete', { 
          success: true, 
          sessionName: currentProcessingJob.sessionName,
          message: 'Processing completed successfully',
          meetingData: processedMeeting
        });
      } catch (error) {
        console.error('Error getting processed meeting data:', error);
        mainWindow.webContents.send('processing-complete', { 
          success: true, 
          sessionName: currentProcessingJob.sessionName,
          message: 'Processing completed successfully'
        });
      }
    }
    
  } catch (error) {
    console.error(`❌ Processing failed for ${currentProcessingJob.sessionName}:`, error);
    trackEvent('error_occurred', { error_type: 'processing_queue' });

    // Notify frontend about failure
    if (mainWindow) {
      mainWindow.webContents.send('processing-complete', { 
        success: false, 
        sessionName: currentProcessingJob.sessionName,
        error: error.message
      });
    }
  } finally {
    isProcessing = false;
    currentProcessingJob = null;
    // Process next job in queue
    setTimeout(processNextInQueue, 1000);
  }
}

function addToProcessingQueue(audioFile, sessionName) {
  processingQueue.push({ audioFile, sessionName });
  console.log(`📋 Added to processing queue: ${sessionName} (Queue size: ${processingQueue.length})`);
  processNextInQueue();
}

ipcMain.handle('start-recording-ui', async (_, sessionName) => {
  try {
    if (currentRecordingProcess) {
      return { success: false, error: 'Recording already in progress' };
    }

    // Start recording (removed clear-state to prevent race conditions)

    console.log('Starting long recording process...');
    sendDebugLog(`Starting recording process: ${sessionName || 'Meeting'}`);
    sendDebugLog('$ stenoai record 7200');

    const actualSessionName = sessionName || 'Meeting';

    // Start background recording with 2-hour limit
    currentRecordingProcess = spawn(getBackendPath(), ['record', '7200', actualSessionName], {
      cwd: getBackendCwd()
    });

    let hasStarted = false;
    let processingSucceeded = false;

    currentRecordingProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Recording stdout:', output);

      // Send real-time output to debug panel (same as runPythonScript)
      output.split('\n').forEach(line => {
        if (line.trim()) sendDebugLog(line.trim());
      });

      // Background recording process handles complete pipeline - just notify when done
      if (output.includes('✅ Complete processing finished!')) {
        processingSucceeded = true;
        console.log(`🎉 Recording and processing completed for: ${actualSessionName}`);
        // Notify frontend that everything is done
        if (mainWindow) {
          // Get the processed meeting data to send to frontend
          runPythonScript('simple_recorder.py', ['list-meetings'], true)
            .then(meetingsResult => {
              const allMeetings = JSON.parse(meetingsResult);
              const processedMeeting = allMeetings.find(m => m.session_info?.name === actualSessionName);

              mainWindow.webContents.send('processing-complete', {
                success: true,
                sessionName: actualSessionName,
                message: 'Recording and processing completed successfully',
                meetingData: processedMeeting
              });
            })
            .catch(error => {
              console.error('Error getting processed meeting data:', error);
              // Fallback - send without meetingData, frontend will refresh
              mainWindow.webContents.send('processing-complete', {
                success: true,
                sessionName: actualSessionName,
                message: 'Recording and processing completed successfully'
              });
            });
        }
      }

      // Detect explicit processing failure from backend
      if (output.includes('❌ Processing pipeline failed')) {
        processingSucceeded = true; // Prevent duplicate notification from close handler
        console.error(`Processing failed for: ${actualSessionName}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('processing-complete', {
            success: false,
            sessionName: actualSessionName,
            message: 'Processing failed: summarization error (check that Ollama and a model are available)'
          });
        }
      }

      // Don't queue background recordings for additional processing - they handle it themselves!

      if (output.includes('Recording to:') && !hasStarted) {
        hasStarted = true;
      }
    });

    currentRecordingProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('Recording stderr:', output);

      // Send real-time stderr to debug panel (same as runPythonScript)
      output.split('\n').forEach(line => {
        if (line.trim()) sendDebugLog('STDERR: ' + line.trim());
      });
    });

    currentRecordingProcess.on('close', (code) => {
      console.log(`Recording process closed with code ${code}`);
      sendDebugLog(`Recording process completed with exit code: ${code}`);
      currentRecordingProcess = null;
      updateTrayIcon(false);

      // If process exited without a success or failure message, notify the user
      if (!processingSucceeded && hasStarted && mainWindow && !mainWindow.isDestroyed()) {
        console.error(`Recording process exited (code ${code}) without completing processing`);
        mainWindow.webContents.send('processing-complete', {
          success: false,
          sessionName: actualSessionName,
          message: `Processing failed unexpectedly (exit code ${code})`
        });
      }
    });

    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (currentRecordingProcess) {
      trackEvent('recording_started');
      updateTrayIcon(true);
      return { success: true, message: 'Recording started successfully' };
    } else {
      return { success: false, error: 'Failed to start recording process' };
    }
  } catch (error) {
    console.error('Start recording UI error:', error.message);
    currentRecordingProcess = null;
    updateTrayIcon(false);
    trackEvent('error_occurred', { error_type: 'start_recording_ui' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pause-recording-ui', async () => {
  try {
    if (!currentRecordingProcess) {
      sendDebugLog('Pause failed: No recording process found');
      return { success: false, error: 'No recording in progress' };
    }

    console.log('Pausing recording process...');
    sendDebugLog('Sending SIGUSR1 to pause recording...');

    // Send SIGUSR1 to pause recording (Unix only)
    if (process.platform !== 'win32') {
      currentRecordingProcess.kill('SIGUSR1');
      sendDebugLog('SIGUSR1 sent successfully');
      return { success: true, message: 'Recording paused' };
    } else {
      return { success: false, error: 'Pause not supported on Windows' };
    }
  } catch (error) {
    console.error('Pause recording UI error:', error.message);
    sendDebugLog(`Pause error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('resume-recording-ui', async () => {
  try {
    if (!currentRecordingProcess) {
      sendDebugLog('Resume failed: No recording process found');
      return { success: false, error: 'No recording in progress' };
    }

    console.log('Resuming recording process...');
    sendDebugLog('Sending SIGUSR2 to resume recording...');

    // Send SIGUSR2 to resume recording (Unix only)
    if (process.platform !== 'win32') {
      currentRecordingProcess.kill('SIGUSR2');
      sendDebugLog('SIGUSR2 sent successfully');
      return { success: true, message: 'Recording resumed' };
    } else {
      return { success: false, error: 'Resume not supported on Windows' };
    }
  } catch (error) {
    console.error('Resume recording UI error:', error.message);
    sendDebugLog(`Resume error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-recording-ui', async () => {
  try {
    if (!currentRecordingProcess) {
      return { success: false, error: 'No recording in progress' };
    }

    console.log('Stopping recording process...');

    // Send SIGTERM to trigger graceful stop and processing
    currentRecordingProcess.kill('SIGTERM');

    // Don't wait - let the process complete independently
    // The process will handle: stop recording → transcribe → summarize → exit
    currentRecordingProcess = null;
    updateTrayIcon(false);

    trackEvent('recording_stopped');
    return {
      success: true,
      message: 'Recording stopped - processing will complete in background'
    };
  } catch (error) {
    console.error('Stop recording UI error:', error.message);
    currentRecordingProcess = null;
    updateTrayIcon(false);
    trackEvent('error_occurred', { error_type: 'stop_recording_ui' });
    return { success: false, error: error.message };
  }
});

// Setup IPC handlers

ipcMain.handle('startup-setup-check', async () => {
  try {
    console.log('Running startup setup check...');
    
    // Use Python backend to check setup
    const result = await runPythonScript('simple_recorder.py', ['setup-check']);
    console.log('Setup check result:', result);
    
    // Parse the output to determine if setup is complete
    const allGood = result.includes('🎉 System check passed!');
    
    // Extract check results for UI display
    const lines = result.split('\n');
    const checks = [];
    
    lines.forEach(line => {
      if (line.includes('✅') || line.includes('❌') || line.includes('⚠️')) {
        const parts = line.split(/\s{2,}/); // Split on multiple spaces
        if (parts.length >= 2) {
          checks.push([parts[0].trim(), parts[1].trim()]);
        }
      }
    });
    
    console.log('Parsed checks:', checks);
    console.log('All good:', allGood);
    
    return { 
      success: true, 
      allGood,
      checks
    };
  } catch (error) {
    console.error('Setup check error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-system-check', async () => {
  try {
    // Check Python installation
    const pythonResult = await new Promise((resolve) => {
      exec('python3 --version', (error, stdout, stderr) => {
        if (error) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
    
    if (!pythonResult) {
      return { success: false, error: 'Python 3 not found. Please install Python 3.8+' };
    }
    
    // Create required directories - match Python logic for DMG vs development
    const os = require('os');
    const currentPath = __dirname;
    let baseDir;
    
    // Detect if running from app bundle (DMG install) or development
    if (currentPath.includes('StenoAI.app') || currentPath.includes('Applications')) {
      // DMG/Production: Use Application Support folder
      baseDir = path.join(os.homedir(), 'Library', 'Application Support', 'stenoai');
    } else {
      // Development: Use project relative paths  
      baseDir = path.join(__dirname, '..');
    }
    
    const dirs = ['recordings', 'transcripts', 'output'];
    
    for (const dir of dirs) {
      const dirPath = path.join(baseDir, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
    
    // Create venv directory if it doesn't exist  
    const projectRoot = path.join(__dirname, '..');
    const venvPath = path.join(projectRoot, 'venv');
    if (!fs.existsSync(venvPath)) {
      await new Promise((resolve, reject) => {
        const process = spawn('python3', ['-m', 'venv', 'venv'], {
          cwd: projectRoot
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('Failed to create virtual environment'));
          }
        });
        
        process.on('error', reject);
      });
    }
    
    trackEvent('setup_completed', { step: 'system_check' });
    return { success: true, message: 'System setup complete - Python and directories ready' };
  } catch (error) {
    trackEvent('setup_failed', { step: 'system_check' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-ffmpeg', async () => {
  try {
    sendDebugLog('$ Checking for existing ffmpeg installation...');
    sendDebugLog('$ Checking: ffmpeg -version, /opt/homebrew/bin/ffmpeg, /usr/local/bin/ffmpeg');

    // Check if ffmpeg is already installed - try multiple common paths
    const ffmpegPaths = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
    let ffmpegPath = null;

    for (const testPath of ffmpegPaths) {
      try {
        const found = await new Promise((resolve) => {
          const proc = spawn(testPath, ['-version'], { timeout: 5000 });
          proc.on('error', () => resolve(false));
          proc.on('close', (code) => resolve(code === 0));
        });

        if (found) {
          ffmpegPath = testPath;
          sendDebugLog(`Found ffmpeg at: ${testPath}`);
          break;
        }
      } catch (error) {
        // Try next path
        continue;
      }
    }

    if (!ffmpegPath) {
      sendDebugLog('ffmpeg not found in any common locations');
    }
    
    // Install ffmpeg if not present
    if (!ffmpegPath) {
      sendDebugLog('ffmpeg not found, checking for Homebrew...');
      sendDebugLog('$ Checking: brew, /opt/homebrew/bin/brew, /usr/local/bin/brew');

      // First check if Homebrew is installed and get its path
      const brewPaths = ['brew', '/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
      let brewPath = null;

      for (const testPath of brewPaths) {
        try {
          const found = await new Promise((resolve) => {
            const proc = spawn(testPath, ['--version'], { timeout: 5000 });
            proc.on('error', () => resolve(false));
            proc.on('close', (code) => resolve(code === 0));
          });

          if (found) {
            brewPath = testPath;
            sendDebugLog(`Found Homebrew at: ${testPath}`);
            break;
          }
        } catch (error) {
          // Try next path
          continue;
        }
      }

      if (!brewPath) {
        sendDebugLog('Homebrew not found in any common locations');
      }
      
      // Install Homebrew if missing
      if (!brewPath) {
        sendDebugLog('Homebrew not found, installing...');
        sendDebugLog('$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');

        // Note: This uses the official Homebrew installation script
        // Using exec here is intentional as this is the documented installation method
        // The URL is hardcoded and not user-controlled
        await new Promise((resolve, reject) => {
          const process = exec('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
               { timeout: 600000 });

          process.stdout.on('data', (data) => {
            sendDebugLog(data.toString().trim());
          });

          process.stderr.on('data', (data) => {
            sendDebugLog('STDERR: ' + data.toString().trim());
          });

          process.on('close', (code) => {
            if (code === 0) {
              sendDebugLog('Homebrew installation completed successfully');
              resolve();
            } else {
              sendDebugLog(`Homebrew installation failed with exit code: ${code}`);
              reject(new Error('Failed to install Homebrew automatically'));
            }
          });
        });

        // After installing, set brewPath to the default location
        brewPath = '/opt/homebrew/bin/brew';
      } else {
        sendDebugLog('Homebrew found, proceeding with ffmpeg installation...');
      }

      // Now install ffmpeg via Homebrew using spawn for security
      sendDebugLog(`$ ${brewPath} install ffmpeg`);
      await new Promise((resolve, reject) => {
        const process = spawn(brewPath, ['install', 'ffmpeg'], { timeout: 300000 });

        process.stdout.on('data', (data) => {
          sendDebugLog(data.toString().trim());
        });

        process.stderr.on('data', (data) => {
          sendDebugLog('STDERR: ' + data.toString().trim());
        });

        process.on('close', (code) => {
          if (code === 0) {
            sendDebugLog('ffmpeg installation completed successfully');
            resolve();
          } else {
            sendDebugLog(`ffmpeg installation failed with exit code: ${code}`);
            reject(new Error('Failed to install ffmpeg via Homebrew'));
          }
        });

        process.on('error', (error) => {
          sendDebugLog(`ffmpeg installation error: ${error.message}`);
          reject(error);
        });
      });
    } else {
      sendDebugLog('ffmpeg already installed, skipping installation');
    }
    
    return { success: true, message: 'ffmpeg ready' };
  } catch (error) {
    sendDebugLog(`ffmpeg setup failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-python', async () => {
  try {
    // Python backend is bundled via PyInstaller - no setup needed
    sendDebugLog('Python backend is bundled, skipping setup');
    return { success: true, message: 'Python backend bundled' };

    // Legacy code below - kept for reference but never runs
    const projectRoot = path.join(__dirname, '..');
    const venvPath = path.join(projectRoot, 'venv');

    sendDebugLog(`Working directory: ${projectRoot}`);
    
    // Create virtual environment if it doesn't exist
    if (!fs.existsSync(venvPath)) {
      sendDebugLog('Python virtual environment not found, creating...');
      sendDebugLog('$ python3 -m venv venv');
      
      await new Promise((resolve, reject) => {
        const process = spawn('python3', ['-m', 'venv', 'venv'], {
          cwd: projectRoot,
          stdio: 'pipe'
        });
        
        process.stdout.on('data', (data) => {
          sendDebugLog(data.toString().trim());
        });
        
        process.stderr.on('data', (data) => {
          sendDebugLog('STDERR: ' + data.toString().trim());
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            sendDebugLog('Virtual environment created successfully');
            resolve();
          } else {
            sendDebugLog(`Virtual environment creation failed with exit code: ${code}`);
            reject(new Error('Failed to create virtual environment'));
          }
        });
        
        process.on('error', (error) => {
          sendDebugLog(`Process error: ${error.message}`);
          reject(error);
        });
      });
    } else {
      sendDebugLog('Python virtual environment already exists');
    }
    
    // Install requirements including Whisper
    sendDebugLog('Installing Python dependencies...');
    sendDebugLog('$ pip install -r requirements.txt openai-whisper');
    
    return new Promise((resolve) => {
      const pythonPath = path.join(venvPath, 'bin', 'python');
      const process = spawn(pythonPath, ['-m', 'pip', 'install', '-r', 'requirements.txt', 'openai-whisper'], {
        cwd: projectRoot,
        stdio: 'pipe'
      });
      
      let output = '';
      
      process.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          sendDebugLog(text);
          output += text;
        }
      });
      
      process.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          sendDebugLog('STDERR: ' + text);
          output += text;
        }
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          sendDebugLog('Python dependencies installation completed successfully');
          trackEvent('setup_completed', { step: 'python_dependencies' });
          resolve({ success: true, message: 'Python dependencies and Whisper installed' });
        } else {
          sendDebugLog(`Python dependencies installation failed with exit code: ${code}`);
          trackEvent('setup_failed', { step: 'python_dependencies' });
          resolve({ success: false, error: `Installation failed: ${output}` });
        }
      });
      
      process.on('error', (error) => {
        resolve({ success: false, error: `Process error: ${error.message}` });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Add IPC handler for sending debug logs to frontend
function sendDebugLog(message) {
  // Send to main window (both setup console and debug panel)
  if (mainWindow) {
    mainWindow.webContents.send('debug-log', message);
  }
}

ipcMain.handle('setup-ollama-and-model', async () => {
  try {
    sendDebugLog('Locating bundled Ollama...');
    const finalOllamaPath = await findOllamaExecutable();
    if (!finalOllamaPath) {
      sendDebugLog('Error: Bundled Ollama not found');
      return { success: false, error: 'Bundled Ollama not found. Please reinstall StenoAI.' };
    }
    sendDebugLog(`Found bundled Ollama at: ${finalOllamaPath}`);

    // Start Ollama service with proper env vars for bundled dylibs
    sendDebugLog('Starting Ollama service...');
    sendDebugLog(`$ ${finalOllamaPath} serve`);
    ollamaProcess = spawn(finalOllamaPath, ['serve'], { detached: true, stdio: 'ignore', env: getOllamaEnv() });
    ollamaProcess.unref();
    ollamaStartedByUs = true;

    // Wait for Ollama to be ready (poll instead of fixed wait)
    sendDebugLog('Waiting for Ollama service to be ready...');
    const maxAttempts = 15;
    let ready = false;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const http = require('http');
        ready = await new Promise((resolve) => {
          const req = http.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 }, (res) => {
            resolve(res.statusCode === 200);
          });
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
        });
        if (ready) {
          sendDebugLog(`Ollama ready after ${i + 1} seconds`);
          break;
        }
      } catch (e) {
        // Continue polling
      }
    }

    if (!ready) {
      sendDebugLog('Warning: Ollama may not be fully ready, attempting pull anyway...');
    }
    
    sendDebugLog('Downloading AI model (this may take several minutes)...');
    sendDebugLog('POST http://127.0.0.1:11434/api/pull {name: "llama3.2:3b"}');

    const http = require('http');
    return new Promise((resolve) => {
      const postData = JSON.stringify({ name: 'llama3.2:3b' });
      const req = http.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/pull',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 600000
      }, (res) => {
        let lastStatus = '';
        res.on('data', (chunk) => {
          // Ollama streams newline-delimited JSON
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.error) {
                sendDebugLog(`Pull error: ${json.error}`);
                return;
              }
              // Log progress without spamming duplicate status
              const status = json.status || '';
              if (json.total && json.completed) {
                const pct = Math.round((json.completed / json.total) * 100);
                const msg = `${status} ${pct}%`;
                if (msg !== lastStatus) {
                  sendDebugLog(msg);
                  lastStatus = msg;
                }
              } else if (status !== lastStatus) {
                sendDebugLog(status);
                lastStatus = status;
              }
            } catch (e) {
              // Non-JSON line, log as-is
              sendDebugLog(chunk.toString().trim());
            }
          }
        });

        res.on('end', async () => {
          if (res.statusCode === 200) {
            sendDebugLog('AI model download completed successfully');
            try {
              await runPythonScript('simple_recorder.py', ['set-model', 'llama3.2:3b'], true);
            } catch (e) {
              // Non-fatal -- config reset is best-effort
            }
            trackEvent('setup_completed', { step: 'ollama_and_model' });
            resolve({ success: true, message: 'Ollama and AI model ready' });
          } else {
            sendDebugLog(`AI model download failed with status: ${res.statusCode}`);
            trackEvent('setup_failed', { step: 'ollama_and_model' });
            resolve({ success: false, error: 'Failed to download AI model', details: `HTTP ${res.statusCode}` });
          }
        });
      });

      req.on('error', (error) => {
        sendDebugLog(`Pull request error: ${error.message}`);
        resolve({ success: false, error: 'Failed to download AI model', details: error.message });
      });

      req.on('timeout', () => {
        req.destroy();
        sendDebugLog('Model pull timed out after 10 minutes');
        resolve({ success: false, error: 'Model download timed out' });
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-whisper', async () => {
  try {
    // Download whisper model using the bundled backend
    const backendPath = getBackendPath();
    sendDebugLog('Downloading Whisper transcription model (~500MB)...');
    sendDebugLog(`$ ${backendPath} download-whisper-model`);

    return new Promise((resolve) => {
      const process = spawn(backendPath, ['download-whisper-model'], {
        stdio: 'pipe'
      });

      process.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) sendDebugLog(text);
      });

      process.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) sendDebugLog('STDERR: ' + text);
      });

      process.on('close', (code) => {
        if (code === 0) {
          sendDebugLog('Whisper model downloaded successfully');
          resolve({ success: true, message: 'Whisper model ready' });
        } else {
          sendDebugLog(`Whisper model download failed with exit code: ${code}`);
          resolve({ success: false, error: 'Failed to download Whisper model' });
        }
      });

      process.on('error', (error) => {
        sendDebugLog(`Process error: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });

    // Legacy code below - kept for reference but never runs
    const projectRoot = path.join(__dirname, '..');
    const pythonPath = path.join(projectRoot, 'venv', 'bin', 'python');

    sendDebugLog('Installing Whisper speech recognition...');
    sendDebugLog(`$ ${pythonPath} -m pip install openai-whisper`);
    
    return new Promise((resolve) => {
      const process = spawn(pythonPath, ['-m', 'pip', 'install', 'openai-whisper'], {
        cwd: projectRoot,
        stdio: 'pipe'
      });
      
      let output = '';
      
      process.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          sendDebugLog(text);
          output += text;
        }
      });
      
      process.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          sendDebugLog('STDERR: ' + text);
          output += text;
        }
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          sendDebugLog('Whisper installation completed successfully');
          resolve({ success: true, message: 'Whisper installed successfully' });
        } else {
          sendDebugLog(`Whisper installation failed with exit code: ${code}`);
          resolve({ success: false, error: `Whisper installation failed: ${output}` });
        }
      });
      
      process.on('error', (error) => {
        resolve({ success: false, error: `Process error: ${error.message}` });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-test', async () => {
  try {
    sendDebugLog('Running system test...');
    sendDebugLog('$ python simple_recorder.py test');
    
    // Test the complete system
    const result = await runPythonScript('simple_recorder.py', ['test']);
    
    // Log the full result to debug console
    result.split('\n').forEach(line => {
      if (line.trim()) sendDebugLog(line.trim());
    });
    
    if (result.includes('System check passed') || result.includes('SUCCESS')) {
      sendDebugLog('System test completed successfully');
      trackEvent('setup_completed', { step: 'system_test' });
      return { success: true, message: 'System test passed' };
    } else {
      // Extract specific error details from the output
      const errorLines = result.split('\n').filter(line => line.includes('ERROR:'));
      const specificError = errorLines.length > 0 ? errorLines[errorLines.length - 1].replace('ERROR: ', '') : 'Unknown error';
      sendDebugLog(`System test failed: ${specificError}`);
      trackEvent('setup_failed', { step: 'system_test' });
      return { success: false, error: `System test failed: ${specificError}`, details: result };
    }
  } catch (error) {
    sendDebugLog(`System test error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Settings window IPC handlers  
ipcMain.handle('trigger-setup-wizard', async () => {
  try {
    console.log('🔧 Starting setup wizard from settings...');
    
    // Trigger the main window's setup flow
    if (mainWindow) {
      mainWindow.webContents.send('trigger-setup-flow');
    }
    
    return { success: true, message: 'Setup wizard triggered in main window' };
  } catch (error) {
    console.error('Setup wizard failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-app-version', async () => {
  try {
    const packagePath = path.join(__dirname, 'package.json');
    const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return {
      success: true,
      version: packageContent.version,
      name: packageContent.productName || packageContent.name
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Storage path handlers
ipcMain.handle('get-storage-path', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-storage-path'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-storage-path', async (event, storagePath) => {
  try {
    const args = ['set-storage-path'];
    if (storagePath) {
      args.push(storagePath);
    }
    const result = await runPythonScript('simple_recorder.py', args);
    // Update cached custom path for file validation
    _cachedCustomStoragePath = storagePath || null;
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { success: true, storage_path: storagePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-storage-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose storage location for StenoAI data',
      buttonLabel: 'Select Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, folderPath: result.filePaths[0] };
    }
    return { success: false, error: 'No folder selected' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Folder management handlers
ipcMain.handle('list-folders', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-folders'], true);
    return { success: true, ...JSON.parse(result.trim()) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-folder', async (event, name, color) => {
  try {
    const args = ['create-folder', name];
    if (color) args.push('--color', color);
    const result = await runPythonScript('simple_recorder.py', args);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-folder', async (event, folderId, name) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['rename-folder', folderId, name]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-folder', async (event, folderId) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['delete-folder', folderId]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reorder-folders', async (event, folderIds) => {
  try {
    const args = ['reorder-folders', ...folderIds];
    const result = await runPythonScript('simple_recorder.py', args);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-meeting-to-folder', async (event, summaryFile, folderId) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['add-meeting-to-folder', summaryFile, folderId]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-meeting-from-folder', async (event, summaryFile, folderId) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['remove-meeting-from-folder', summaryFile, folderId]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-ai-prompts', async () => {
  try {
    // Read the summarization prompt from the Python backend
    const summarizerPath = path.join(__dirname, '..', 'src', 'summarizer.py');
    
    if (fs.existsSync(summarizerPath)) {
      const content = fs.readFileSync(summarizerPath, 'utf8');
      
      // Extract the full prompt from the _create_permissive_prompt method
      const promptMatch = content.match(/def _create_permissive_prompt[\s\S]*?return f"""([\s\S]*?)"""/);
      
      if (promptMatch) {
        return {
          success: true,
          summarization: promptMatch[1].trim()
        };
      }
    }
    
    return {
      success: true,
      summarization: 'Prompt not found in summarizer.py'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Helper function to ensure Ollama service is running
async function ensureOllamaRunning() {
  try {
    // Check if Ollama service is responding
    const http = require('http');
    const response = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:11434/api/version', { timeout: 3000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    if (response) {
      return true; // Service is running
    }

    // Service not running, try to start it
    const ollamaPath = await findOllamaExecutable();
    if (!ollamaPath) {
      return false;
    }

    // Start Ollama service in background with proper env vars for dylibs
    ollamaProcess = spawn(ollamaPath, ['serve'], { detached: true, stdio: 'ignore', env: getOllamaEnv() });
    ollamaProcess.unref();
    ollamaStartedByUs = true;

    // Wait for service to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } catch (error) {
    console.error('Error ensuring Ollama is running:', error);
    return false;
  }
}

// Check if Ollama is installed (for setup wizard)
ipcMain.handle('check-ollama-installed', async () => {
  try {
    const ollamaPath = await findOllamaExecutable();
    if (!ollamaPath) {
      return { success: true, installed: false };
    }
    return { success: true, installed: true, path: ollamaPath };
  } catch (error) {
    return { success: false, installed: false, error: error.message };
  }
});

// Model management handlers
ipcMain.handle('check-model-installed', async (event, modelName) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['check-model', modelName]);
    // Parse the last JSON line from output (skip any log lines)
    const lines = result.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const data = JSON.parse(lines[i]);
        return { success: true, installed: data.installed };
      } catch (e) {
        continue;
      }
    }
    return { success: false, installed: false, error: 'Could not parse backend response' };
  } catch (error) {
    return { success: false, installed: false, error: error.message };
  }
});

ipcMain.handle('list-models', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-models']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error listing models: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-current-model', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-model']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error getting current model: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-model', async (event, modelName) => {
  try {
    sendDebugLog(`Setting model to: ${modelName}`);
    const result = await runPythonScript('simple_recorder.py', ['set-model', modelName]);

    // Extract JSON from output (might have other text before it)
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      trackEvent('model_changed', { model: modelName });
      return jsonData;
    }

    trackEvent('model_changed', { model: modelName });
    return { success: true, model: modelName };
  } catch (error) {
    sendDebugLog(`Error setting model: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-notifications', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-notifications']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error getting notification settings: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-notifications', async (event, enabled) => {
  try {
    sendDebugLog(`Setting notifications to: ${enabled}`);
    const result = await runPythonScript('simple_recorder.py', ['set-notifications', enabled ? 'True' : 'False']);

    // Extract JSON from output
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      return jsonData;
    }

    return { success: true, notifications_enabled: enabled };
  } catch (error) {
    sendDebugLog(`Error setting notifications: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-telemetry', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-telemetry']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error getting telemetry settings: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-telemetry', async (event, enabled) => {
  try {
    sendDebugLog(`Setting telemetry to: ${enabled}`);
    const result = await runPythonScript('simple_recorder.py', ['set-telemetry', enabled ? 'True' : 'False']);

    // Update in-memory state
    telemetryEnabled = enabled;

    if (enabled && !posthogClient) {
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
      console.log('Telemetry re-enabled');
    } else if (!enabled && posthogClient) {
      await shutdownTelemetry();
      console.log('Telemetry disabled');
    }

    // Extract JSON from output
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      return jsonData;
    }

    return { success: true, telemetry_enabled: enabled };
  } catch (error) {
    sendDebugLog(`Error setting telemetry: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// System audio capture IPC handlers
ipcMain.handle('get-system-audio', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-system-audio'], true);
    const jsonData = JSON.parse(result);
    return { success: true, ...jsonData };
  } catch (error) {
    sendDebugLog(`Error getting system audio setting: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-system-audio', async (event, enabled) => {
  try {
    sendDebugLog(`Setting system audio to: ${enabled}`);
    const result = await runPythonScript('simple_recorder.py', ['set-system-audio', enabled ? 'True' : 'False']);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { success: true, system_audio_enabled: enabled };
  } catch (error) {
    sendDebugLog(`Error setting system audio: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Language IPC handlers
ipcMain.handle('get-language', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-language'], true);
    const jsonData = JSON.parse(result);
    return { success: true, ...jsonData };
  } catch (error) {
    sendDebugLog(`Error getting language setting: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-language', async (event, languageCode) => {
  try {
    sendDebugLog(`Setting language to: ${languageCode}`);
    const result = await runPythonScript('simple_recorder.py', ['set-language', languageCode]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { success: true, language: languageCode };
  } catch (error) {
    sendDebugLog(`Error setting language: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-recordings-dir', async () => {
  try {
    // Get recordings directory from Python config
    const result = await runPythonScript('simple_recorder.py', ['get-storage-path'], true);
    const jsonData = JSON.parse(result.trim());

    let recordingsDir;
    if (jsonData.storage_path) {
      recordingsDir = path.join(jsonData.storage_path, 'recordings');
    } else if (app.isPackaged) {
      recordingsDir = path.join(os.homedir(), 'Library', 'Application Support', 'stenoai', 'recordings');
    } else {
      recordingsDir = path.join(__dirname, '..', 'recordings');
    }

    // Ensure directory exists
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    return { success: true, path: recordingsDir };
  } catch (error) {
    sendDebugLog(`Error getting recordings dir: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('process-system-audio-recording', async (event, audioFilePath, sessionName) => {
  try {
    sendDebugLog(`Queuing system audio recording for processing: ${audioFilePath}`);

    // Validate file path
    const allowedBaseDirs = getAllowedBaseDirs();
    if (!validateSafeFilePath(audioFilePath, allowedBaseDirs)) {
      return { success: false, error: 'Invalid file path' };
    }

    if (!fs.existsSync(audioFilePath)) {
      return { success: false, error: 'Audio file not found' };
    }

    const actualSessionName = sessionName || 'Meeting';

    // Use the existing processing queue to avoid concurrent Ollama/Whisper runs
    addToProcessingQueue(audioFilePath, actualSessionName);

    trackEvent('recording_stopped', { recording_mode: 'system_audio' });
    return { success: true, message: 'Added to processing queue' };
  } catch (error) {
    sendDebugLog(`Error queuing system audio: ${error.message}`);
    trackEvent('error_occurred', { error_type: 'process_system_audio' });
    return { success: false, error: error.message };
  }
});

// Track system audio recording state for tray icon
ipcMain.on('system-audio-recording-state', (event, isRecording) => {
  systemAudioRecordingActive = isRecording;
  updateTrayIcon(isRecording);
  updateTrayMenu();
});

ipcMain.handle('pull-model', async (event, modelName) => {
  try {
    sendDebugLog(`Pulling model: ${modelName}`);
    sendDebugLog('This may take several minutes...');

    return new Promise((resolve) => {
      const proc = spawn(getBackendPath(), ['pull-model', modelName], {
        cwd: getBackendCwd()
      });

      proc.stdout.on('data', (data) => {
        const output = data.toString().trim();
        sendDebugLog(output);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model-pull-progress', {
            model: modelName,
            progress: output
          });
        }
      });

      proc.stderr.on('data', (data) => {
        const output = data.toString().trim();
        sendDebugLog(output);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model-pull-progress', {
            model: modelName,
            progress: output
          });
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          sendDebugLog(`Successfully pulled model: ${modelName}`);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model-pull-complete', {
              model: modelName,
              success: true
            });
          }

          resolve({ success: true, model: modelName });
        } else {
          sendDebugLog(`Failed to pull model: ${modelName}`);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model-pull-complete', {
              model: modelName,
              success: false,
              error: `Process exited with code ${code}`
            });
          }

          resolve({ success: false, error: `Process exited with code ${code}` });
        }
      });

      proc.on('error', (error) => {
        sendDebugLog(`Error pulling model: ${error.message}`);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model-pull-complete', {
            model: modelName,
            success: false,
            error: error.message
          });
        }

        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    sendDebugLog(`Error in pull-model handler: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Helper to build env vars for running the bundled Ollama binary directly
function getOllamaEnv() {
  let ollamaDir;
  if (app.isPackaged) {
    ollamaDir = path.join(process.resourcesPath, 'stenoai', '_internal', 'ollama');
  } else {
    ollamaDir = path.join(__dirname, '..', 'bin');
  }
  const env = { ...process.env };
  const existing = env.DYLD_LIBRARY_PATH || '';
  env.DYLD_LIBRARY_PATH = existing ? `${ollamaDir}:${existing}` : ollamaDir;
  env.MLX_METAL_PATH = path.join(ollamaDir, 'mlx.metallib');
  return env;
}

// Helper function to find Ollama executable (bundled only)
async function findOllamaExecutable() {
  let bundledOllamaPath;
  if (app.isPackaged) {
    // Production: bundled inside PyInstaller _internal directory
    bundledOllamaPath = path.join(process.resourcesPath, 'stenoai', '_internal', 'ollama', 'ollama');
  } else {
    // Development: in project bin/ directory
    bundledOllamaPath = path.join(__dirname, '..', 'bin', 'ollama');
  }

  if (fs.existsSync(bundledOllamaPath)) {
    console.log(`Using bundled Ollama: ${bundledOllamaPath}`);
    return bundledOllamaPath;
  }

  console.error(`Bundled Ollama not found at: ${bundledOllamaPath}`);
  return null;
}

// Update checking functionality
async function checkForUpdates() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/ruzin/stenoai/releases/latest',
      method: 'GET',
      headers: {
        'User-Agent': 'StenoAI-Updater'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
          
          // Get current version from package.json
          const packagePath = path.join(__dirname, 'package.json');
          const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
          const currentVersion = packageContent.version;
          
          console.log(`Current version: ${currentVersion}, Latest version: ${latestVersion}`);
          
          // Simple version comparison (works for semantic versioning)
          const isUpdateAvailable = compareVersions(currentVersion, latestVersion) < 0;
          
          resolve({
            success: true,
            updateAvailable: isUpdateAvailable,
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            releaseUrl: release.html_url,
            releaseName: release.name || `Version ${latestVersion}`,
            downloadUrl: getDownloadUrl(release.assets)
          });
        } catch (error) {
          console.error('Error parsing GitHub API response:', error);
          resolve({ success: false, error: 'Failed to parse update data' });
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Error checking for updates:', error);
      resolve({ success: false, error: error.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Update check timeout' });
    });
    
    req.end();
  });
}

function compareVersions(current, latest) {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);
  
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;
    
    if (currentPart < latestPart) return -1;
    if (currentPart > latestPart) return 1;
  }
  
  return 0;
}

function getDownloadUrl(assets) {
  // Find the appropriate download URL based on platform/architecture
  const platform = process.platform;
  const arch = process.arch;
  
  if (platform === 'darwin') {
    // Look for macOS DMG files
    const armAsset = assets.find(asset => 
      asset.name.includes('arm64') && asset.name.includes('dmg')
    );
    const intelAsset = assets.find(asset => 
      asset.name.includes('x64') && asset.name.includes('dmg')
    );
    
    // Prefer ARM64 for Apple Silicon, fallback to Intel
    if (arch === 'arm64' && armAsset) return armAsset.browser_download_url;
    if (intelAsset) return intelAsset.browser_download_url;
    if (armAsset) return armAsset.browser_download_url;
  }
  
  // Fallback to first asset or releases page
  return assets.length > 0 ? assets[0].browser_download_url : null;
}

ipcMain.handle('check-for-updates', async () => {
  return await checkForUpdates();
});

ipcMain.handle('check-announcements', async () => {
  const packagePath = path.join(__dirname, 'package.json');
  const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const currentVersion = packageContent.version;

  // Try local file first (for development/testing)
  const localPath = path.join(__dirname, '..', 'announcements.json');
  if (fs.existsSync(localPath)) {
    try {
      const localData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      console.log('Loaded announcements from local file');
      return {
        success: true,
        announcements: localData.announcements || [],
        currentVersion
      };
    } catch (error) {
      console.error('Error reading local announcements.json:', error);
    }
  }

  // Fall back to remote
  return new Promise((resolve) => {
    const options = {
      hostname: 'raw.githubusercontent.com',
      path: '/ruzin/stenoai/main/announcements.json',
      method: 'GET',
      headers: {
        'User-Agent': 'StenoAI-App'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            success: true,
            announcements: parsed.announcements || [],
            currentVersion
          });
        } catch (error) {
          console.error('Error parsing announcements:', error);
          resolve({ success: false, error: 'Failed to parse announcements' });
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error fetching announcements:', error);
      resolve({ success: false, error: error.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Announcements fetch timeout' });
    });

    req.end();
  });
});

ipcMain.handle('open-release-page', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ── Google Calendar: Token Storage ──────────────────────────────────────

function getTokenFilePath() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'stenoai', '.google-tokens');
}

function saveGoogleTokens(tokens) {
  try {
    const tokenDir = path.dirname(getTokenFilePath());
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    fs.writeFileSync(getTokenFilePath(), encrypted);
    console.log('Google tokens saved');
  } catch (error) {
    console.error('Failed to save Google tokens:', error.message);
  }
}

function loadGoogleTokens() {
  try {
    const tokenPath = getTokenFilePath();
    if (!fs.existsSync(tokenPath)) return null;
    const encrypted = fs.readFileSync(tokenPath);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Failed to load Google tokens:', error.message);
    return null;
  }
}

function deleteGoogleTokens() {
  try {
    const tokenPath = getTokenFilePath();
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      console.log('Google tokens deleted');
    }
  } catch (error) {
    console.error('Failed to delete Google tokens:', error.message);
  }
}

// ── Outlook Calendar: Token Storage ─────────────────────────────────────

function getOutlookTokenFilePath() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'stenoai', '.outlook-tokens');
}

function saveOutlookTokens(tokens) {
  try {
    const tokenDir = path.dirname(getOutlookTokenFilePath());
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    fs.writeFileSync(getOutlookTokenFilePath(), encrypted);
    console.log('Outlook tokens saved');
  } catch (error) {
    console.error('Failed to save Outlook tokens:', error.message);
  }
}

function loadOutlookTokens() {
  try {
    const tokenPath = getOutlookTokenFilePath();
    if (!fs.existsSync(tokenPath)) return null;
    const encrypted = fs.readFileSync(tokenPath);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Failed to load Outlook tokens:', error.message);
    return null;
  }
}

function deleteOutlookTokens() {
  try {
    const tokenPath = getOutlookTokenFilePath();
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      console.log('Outlook tokens deleted');
    }
  } catch (error) {
    console.error('Failed to delete Outlook tokens:', error.message);
  }
}

// ── Google Calendar: OAuth2 Flow with PKCE ──────────────────────────────

function startGoogleAuth() {
  return new Promise((resolve, reject) => {
    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    let timeoutId = null;

    // Start temporary HTTP server on loopback for OAuth redirect
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://127.0.0.1`);
        if (!reqUrl.pathname.startsWith('/callback')) {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        const returnedState = reqUrl.searchParams.get('state');

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Invalid state parameter</h2><p>Possible CSRF attack. Please try again.</p></body></html>');
          return;
        }

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authorization denied</h2><p>You can close this tab.</p></body></html>');
          server.close();
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error(`Auth denied: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Missing authorization code</h2></body></html>');
          return;
        }

        // Exchange code for tokens
        const port = server.address().port;
        const tokens = await exchangeCodeForTokens(code, codeVerifier, port);
        saveGoogleTokens(tokens);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family: -apple-system, sans-serif; text-align: center; padding: 60px;"><h2>Connected to Google Calendar</h2><p>You can close this tab and return to StenoAI.</p></body></html>');

        server.close();
        if (timeoutId) clearTimeout(timeoutId);

        // Notify renderer and bring app to foreground
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('google-auth-changed');
          mainWindow.show();
          mainWindow.focus();
        }

        resolve({ success: true });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication failed</h2><p>Please try again.</p></body></html>');
        server.close();
        if (timeoutId) clearTimeout(timeoutId);
        reject(err);
      }
    });

    // Listen on loopback only (security: not 0.0.0.0)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const authParams = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      const authUrl = `${GOOGLE_AUTH_URL}?${authParams.toString()}`;
      shell.openExternal(authUrl);
    });

    timeoutId = setTimeout(() => {
      if (server.listening) {
        server.close();
        reject(new Error('OAuth timeout: no response within 5 minutes'));
      }
    }, 5 * 60 * 1000);
  });
}

function exchangeCodeForTokens(code, codeVerifier, port) {
  return new Promise((resolve, reject) => {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const postData = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Token exchange failed: ${parsed.error_description || parsed.error}`));
            return;
          }
          // Store expiry as absolute timestamp
          parsed.expires_at = Date.now() + (parsed.expires_in * 1000);
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse token response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Google Calendar: Token Refresh ──────────────────────────────────────

async function getValidAccessToken() {
  const tokens = loadGoogleTokens();
  if (!tokens) return null;

  // Check if token is expired or about to expire (5-min buffer)
  const bufferMs = 5 * 60 * 1000;
  if (tokens.expires_at && Date.now() < tokens.expires_at - bufferMs) {
    return tokens.access_token;
  }

  // Token expired, try to refresh
  if (!tokens.refresh_token) {
    deleteGoogleTokens();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('google-auth-changed');
    }
    return null;
  }

  try {
    const newTokens = await refreshAccessToken(tokens.refresh_token);
    // Preserve the refresh token (Google may not return it again)
    newTokens.refresh_token = newTokens.refresh_token || tokens.refresh_token;
    newTokens.expires_at = Date.now() + (newTokens.expires_in * 1000);
    saveGoogleTokens(newTokens);
    return newTokens.access_token;
  } catch (error) {
    console.error('Token refresh failed:', error.message);
    if (error.message && (error.message.includes('invalid_grant') || error.message.includes('Token has been expired or revoked'))) {
      deleteGoogleTokens();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('google-auth-changed');
      }
    }
    return null;
  }
}

function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Refresh failed: ${parsed.error_description || parsed.error}`));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse refresh response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Google Calendar: Fetch Events ───────────────────────────────────────

function fetchCalendarEvents(accessToken, maxResults = 7) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: weekAhead.toISOString(),
      maxResults: String(maxResults),
      singleEvents: 'true',
      orderBy: 'startTime',
      fields: 'items(id,summary,description,start,end,attendees,htmlLink,conferenceData)'
    });

    const options = {
      hostname: 'www.googleapis.com',
      path: `/calendar/v3/calendars/primary/events?${params.toString()}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Calendar API error: ${parsed.error.message || parsed.error}`));
            return;
          }
          resolve(parsed.items || []);
        } catch (err) {
          reject(new Error('Failed to parse calendar response'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ── Outlook Calendar: OAuth2 Flow with PKCE ─────────────────────────────

function startOutlookAuth() {
  return new Promise((resolve, reject) => {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    let timeoutId = null;

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://localhost`);
        // Ignore favicon and other noise — only handle the root path
        if (reqUrl.pathname !== '/') {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        const returnedState = reqUrl.searchParams.get('state');

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Invalid state parameter</h2><p>Possible CSRF attack. Please try again.</p></body></html>');
          return;
        }

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authorization denied</h2><p>You can close this tab.</p></body></html>');
          server.close();
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error(`Auth denied: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Missing authorization code</h2></body></html>');
          return;
        }

        const port = server.address().port;
        const tokens = await exchangeOutlookCodeForTokens(code, codeVerifier, port);
        saveOutlookTokens(tokens);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family: -apple-system, sans-serif; text-align: center; padding: 60px;"><h2>Connected to Outlook Calendar</h2><p>You can close this tab and return to StenoAI.</p></body></html>');

        server.close();
        if (timeoutId) clearTimeout(timeoutId);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('outlook-auth-changed');
          mainWindow.show();
          mainWindow.focus();
        }

        resolve({ success: true });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication failed</h2><p>Please try again.</p></body></html>');
        server.close();
        if (timeoutId) clearTimeout(timeoutId);
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://localhost:${port}`;

      const authParams = new URLSearchParams({
        client_id: OUTLOOK_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OUTLOOK_SCOPES,
        response_mode: 'query',
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      const authUrl = `${OUTLOOK_AUTH_URL}?${authParams.toString()}`;
      shell.openExternal(authUrl);
    });

    timeoutId = setTimeout(() => {
      if (server.listening) {
        server.close();
        reject(new Error('OAuth timeout: no response within 5 minutes'));
      }
    }, 5 * 60 * 1000);
  });
}

function exchangeOutlookCodeForTokens(code, codeVerifier, port) {
  return new Promise((resolve, reject) => {
    const redirectUri = `http://localhost:${port}`;
    const postData = new URLSearchParams({
      code,
      client_id: OUTLOOK_CLIENT_ID,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    }).toString();

    const tokenUrl = new URL(OUTLOOK_TOKEN_URL);
    const options = {
      hostname: tokenUrl.hostname,
      path: tokenUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Token exchange failed: ${parsed.error_description || parsed.error}`));
            return;
          }
          parsed.expires_at = Date.now() + (parsed.expires_in * 1000);
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse token response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Outlook Calendar: Token Refresh ─────────────────────────────────────

async function getValidOutlookAccessToken() {
  const tokens = loadOutlookTokens();
  if (!tokens) return null;

  const bufferMs = 5 * 60 * 1000;
  if (tokens.expires_at && Date.now() < tokens.expires_at - bufferMs) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    deleteOutlookTokens();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('outlook-auth-changed');
    }
    return null;
  }

  try {
    const newTokens = await refreshOutlookAccessToken(tokens.refresh_token);
    newTokens.refresh_token = newTokens.refresh_token || tokens.refresh_token;
    newTokens.expires_at = Date.now() + (newTokens.expires_in * 1000);
    saveOutlookTokens(newTokens);
    return newTokens.access_token;
  } catch (error) {
    console.error('Outlook token refresh failed:', error.message);
    // Only delete tokens for irrecoverable errors (revoked/expired grant)
    // Transient network errors should not force re-authentication
    if (error.message && (error.message.includes('invalid_grant') || error.message.includes('interaction_required'))) {
      deleteOutlookTokens();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('outlook-auth-changed');
      }
    }
    return null;
  }
}

function refreshOutlookAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: OUTLOOK_CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: OUTLOOK_SCOPES
    }).toString();

    const tokenUrl = new URL(OUTLOOK_TOKEN_URL);
    const options = {
      hostname: tokenUrl.hostname,
      path: tokenUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Refresh failed: ${parsed.error_description || parsed.error}`));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse refresh response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Outlook Calendar: Fetch Events ──────────────────────────────────────

function fetchOutlookCalendarEvents(accessToken, maxResults = 7) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);

    const params = new URLSearchParams({
      startDateTime: now.toISOString(),
      endDateTime: weekAhead.toISOString(),
      $top: String(maxResults),
      $orderby: 'start/dateTime',
      $select: 'id,subject,body,start,end,attendees,webLink,onlineMeeting,isOnlineMeeting'
    });

    const options = {
      hostname: 'graph.microsoft.com',
      path: `/v1.0/me/calendarView?${params.toString()}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'outlook.timezone="UTC"'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Outlook Calendar API error: ${parsed.error.message || parsed.error}`));
            return;
          }
          const events = (parsed.value || []).map(normalizeOutlookEvent);
          resolve(events);
        } catch (err) {
          reject(new Error('Failed to parse Outlook calendar response'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function normalizeOutlookEvent(event) {
  // Map Microsoft Graph event shape to Google Calendar shape for renderer compatibility
  const stripHtml = (html) => {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|p|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/(\s*\n){3,}/g, '\n\n')
      .trim();
  };

  const ensureUtcSuffix = (dt) => {
    if (!dt) return undefined;
    return dt.endsWith('Z') ? dt : dt + 'Z';
  };

  return {
    id: event.id,
    summary: event.subject || 'No title',
    description: stripHtml(event.body?.content),
    start: {
      dateTime: ensureUtcSuffix(event.start?.dateTime),
      timeZone: 'UTC'
    },
    end: {
      dateTime: ensureUtcSuffix(event.end?.dateTime),
      timeZone: 'UTC'
    },
    attendees: (event.attendees || []).map(a => ({
      email: a.emailAddress?.address || '',
      displayName: a.emailAddress?.name || '',
      responseStatus: a.status?.response || ''
    })),
    htmlLink: event.webLink,
    conferenceData: event.isOnlineMeeting && event.onlineMeeting ? {
      entryPoints: [{ uri: event.onlineMeeting.joinUrl, entryPointType: 'video' }]
    } : undefined
  };
}

// ── Google Calendar: IPC Handlers ───────────────────────────────────────

ipcMain.handle('google-auth-start', async () => {
  try {
    await startGoogleAuth();
    // Only disconnect Outlook after Google auth succeeds
    deleteOutlookTokens();
    return { success: true };
  } catch (error) {
    console.error('Google auth failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-auth-status', async () => {
  try {
    const tokens = loadGoogleTokens();
    return { success: true, connected: !!tokens };
  } catch (error) {
    return { success: false, connected: false };
  }
});

ipcMain.handle('google-auth-disconnect', async () => {
  try {
    // Best-effort token revocation
    const tokens = loadGoogleTokens();
    if (tokens && tokens.access_token) {
      try {
        await new Promise((resolve) => {
          const revokeParams = new URLSearchParams({ token: tokens.access_token });
          const req = https.request({
            hostname: 'oauth2.googleapis.com',
            path: `/revoke?${revokeParams.toString()}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }, () => resolve());
          req.on('error', () => resolve()); // Best-effort
          req.end();
        });
      } catch (e) {
        // Best-effort revocation -- ignore errors
      }
    }

    deleteGoogleTokens();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('google-auth-changed');
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-calendar-events', async () => {
  try {
    // Check which provider is connected (only one at a time)
    const googleToken = await getValidAccessToken();
    if (googleToken) {
      const events = await fetchCalendarEvents(googleToken);
      return { success: true, events };
    }

    const outlookToken = await getValidOutlookAccessToken();
    if (outlookToken) {
      const events = await fetchOutlookCalendarEvents(outlookToken);
      return { success: true, events };
    }

    return { success: false, needsAuth: true };
  } catch (error) {
    console.error('Failed to fetch calendar events:', error.message);
    return { success: false, error: error.message };
  }
});

// ── Outlook Calendar: IPC Handlers ──────────────────────────────────────

ipcMain.handle('outlook-auth-start', async () => {
  try {
    await startOutlookAuth();
    // Only disconnect Google after Outlook auth succeeds
    deleteGoogleTokens();
    return { success: true };
  } catch (error) {
    console.error('Outlook auth failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('outlook-auth-status', async () => {
  try {
    const tokens = loadOutlookTokens();
    return { success: true, connected: !!tokens };
  } catch (error) {
    return { success: false, connected: false };
  }
});

ipcMain.handle('outlook-auth-disconnect', async () => {
  try {
    deleteOutlookTokens();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('outlook-auth-changed');
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});