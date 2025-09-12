const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

let mainWindow;
let settingsWindow = null;
let pythonProcess;

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

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (pythonProcess) {
      pythonProcess.kill();
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'hiddenInset',
    show: false,
    backgroundColor: '#1a1a1a'
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}


// IPC handler for opening settings
ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

// Debug functionality handled by side panel now

// Python backend communication
function runPythonScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const pythonPath = path.join(__dirname, '..', 'venv', 'bin', 'python');
    const scriptPath = path.join(__dirname, '..', script);
    
    // Log the command being executed
    const command = `${pythonPath} ${scriptPath} ${args.join(' ')}`;
    console.log('Running:', command);
    sendDebugLog(`$ ${script} ${args.join(' ')}`);
    
    const process = spawn(pythonPath, [scriptPath, ...args], {
      cwd: path.join(__dirname, '..')
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('Python stdout:', output);
      // Stream stdout to debug panel in real-time
      output.split('\n').forEach(line => {
        if (line.trim()) sendDebugLog(line.trim());
      });
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('Python stderr:', output);
      // Stream stderr to debug panel in real-time
      output.split('\n').forEach(line => {
        if (line.trim()) sendDebugLog('STDERR: ' + line.trim());
      });
    });
    
    process.on('close', (code) => {
      sendDebugLog(`Command completed with exit code: ${code}`);
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
      return { success: true, message: result };
    } else {
      sendDebugLog(`Recording failed: ${result}`);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('Start recording error:', error.message);
    sendDebugLog(`Recording error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-recording', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['stop']);
    
    if (result.includes('SUCCESS') || result.includes('Recording saved')) {
      return { success: true, message: result };
    } else {
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('Stop recording error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-status', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['status']);
    return { success: true, status: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('process-recording', async (event, audioFile, sessionName) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['process', audioFile, '--name', sessionName]);
    return { success: true, result: result };
  } catch (error) {
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
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'm4a', 'aac'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, filePath: result.filePaths[0] };
  }
  
  return { success: false, error: 'No file selected' };
});

ipcMain.handle('list-meetings', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-meetings']);
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

ipcMain.handle('delete-meeting', async (event, meetingData) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // meetingData is the actual meeting object, not a file path
    const meeting = meetingData;
    
    // Build correct file paths from the meeting data - convert to absolute paths
    const projectRoot = path.join(__dirname, '..');
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
    // Delete all related files
    for (const file of absolutePaths) {
      try {
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
    hasRecording: currentRecordingProcess !== null
  };
});

// Global recording state management
let currentRecordingProcess = null;
let processingQueue = [];
let isProcessing = false;
let currentProcessingJob = null;

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
    
    // Notify frontend about completion with processed meeting data
    if (mainWindow) {
      try {
        // Get the specific processed meeting data
        const meetingsResult = await runPythonScript('simple_recorder.py', ['list-meetings']);
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
    const pythonPath = path.join(__dirname, '..', 'venv', 'bin', 'python');
    const scriptPath = path.join(__dirname, '..', 'simple_recorder.py');
    
    const actualSessionName = sessionName || 'Meeting';
    
    // Start background recording with 60-minute limit
    currentRecordingProcess = spawn(pythonPath, [scriptPath, 'record', '3600', actualSessionName], {
      cwd: path.join(__dirname, '..')
    });

    let hasStarted = false;
    
    currentRecordingProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Recording stdout:', output);
      
      // Background recording process handles complete pipeline - just notify when done
      if (output.includes('✅ Complete processing finished!')) {
        console.log(`🎉 Recording and processing completed for: ${actualSessionName}`);
        // Notify frontend that everything is done
        if (mainWindow) {
          // Get the processed meeting data to send to frontend
          runPythonScript('simple_recorder.py', ['list-meetings'])
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
      
      // Don't queue background recordings for additional processing - they handle it themselves!
      
      if (output.includes('Recording to:') && !hasStarted) {
        hasStarted = true;
      }
    });

    currentRecordingProcess.stderr.on('data', (data) => {
      console.log('Recording stderr:', data.toString());
    });

    currentRecordingProcess.on('close', (code) => {
      console.log(`Recording process closed with code ${code}`);
      currentRecordingProcess = null;
    });

    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (currentRecordingProcess) {
      return { success: true, message: 'Recording started successfully' };
    } else {
      return { success: false, error: 'Failed to start recording process' };
    }
  } catch (error) {
    console.error('Start recording UI error:', error.message);
    currentRecordingProcess = null;
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
    
    return { 
      success: true, 
      message: 'Recording stopped - processing will complete in background'
    };
  } catch (error) {
    console.error('Stop recording UI error:', error.message);
    currentRecordingProcess = null;
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
    
    return { success: true, message: 'System setup complete - Python and directories ready' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-ollama', async () => {
  try {
    // Check if Ollama is already installed
    const checkResult = await new Promise((resolve) => {
      exec('which ollama || /opt/homebrew/bin/ollama --version || /usr/local/bin/ollama --version', { timeout: 5000 }, (error, stdout, stderr) => {
        resolve(!error && stdout.trim());
      });
    });
    
    if (checkResult) {
      // Also start Ollama service if not running
      exec('ollama serve', { detached: true });
      return { success: true, message: 'Ollama ready and service started' };
    }
    
    // Install Ollama using Homebrew
    return new Promise((resolve) => {
      exec('brew install ollama', { timeout: 300000 }, (error, stdout, stderr) => {
        if (!error) {
          // Start Ollama service after installation
          exec('ollama serve', { detached: true });
          resolve({ success: true, message: 'Ollama installed and started' });
        } else {
          resolve({ success: false, error: 'Failed to install Ollama. Please install Homebrew and try again.' });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-ffmpeg', async () => {
  try {
    sendDebugLog('$ Checking for existing ffmpeg installation...');
    sendDebugLog('$ which ffmpeg || /opt/homebrew/bin/ffmpeg -version || /usr/local/bin/ffmpeg -version');
    
    // Check if ffmpeg is already installed and get its path
    const ffmpegPath = await new Promise((resolve) => {
      exec('which ffmpeg', { timeout: 5000 }, (error, stdout, stderr) => {
        if (!error && stdout.trim()) {
          const path = stdout.trim();
          sendDebugLog(`Found ffmpeg at: ${path}`);
          resolve(path);
        } else {
          // Try common Homebrew locations
          exec('/opt/homebrew/bin/ffmpeg -version', { timeout: 5000 }, (error2, stdout2) => {
            if (!error2) {
              sendDebugLog('Found ffmpeg at: /opt/homebrew/bin/ffmpeg');
              resolve('/opt/homebrew/bin/ffmpeg');
            } else {
              exec('/usr/local/bin/ffmpeg -version', { timeout: 5000 }, (error3, stdout3) => {
                if (!error3) {
                  sendDebugLog('Found ffmpeg at: /usr/local/bin/ffmpeg');
                  resolve('/usr/local/bin/ffmpeg');
                } else {
                  sendDebugLog('ffmpeg not found in any common locations');
                  resolve(null);
                }
              });
            }
          });
        }
      });
    });
    
    // Install ffmpeg if not present
    if (!ffmpegPath) {
      sendDebugLog('ffmpeg not found, checking for Homebrew...');
      sendDebugLog('$ which brew || /opt/homebrew/bin/brew --version || /usr/local/bin/brew --version');
      
      // First check if Homebrew is installed
      const brewCheck = await new Promise((resolve) => {
        exec('which brew || /opt/homebrew/bin/brew --version || /usr/local/bin/brew --version', { timeout: 5000 }, (error, stdout, stderr) => {
          if (stdout) sendDebugLog(stdout.trim());
          if (stderr) sendDebugLog('STDERR: ' + stderr.trim());
          if (error) sendDebugLog('ERROR: ' + error.message);
          resolve(!error && stdout.trim());
        });
      });
      
      // Install Homebrew if missing (same logic as ollama)
      if (!brewCheck) {
        sendDebugLog('Homebrew not found, installing...');
        sendDebugLog('$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
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
      } else {
        sendDebugLog('Homebrew found, proceeding with ffmpeg installation...');
      }
      
      // Now install ffmpeg via Homebrew
      sendDebugLog('$ brew install ffmpeg');
      await new Promise((resolve, reject) => {
        const process = exec('brew install ffmpeg', { timeout: 300000 });
        
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
          resolve({ success: true, message: 'Python dependencies and Whisper installed' });
        } else {
          sendDebugLog(`Python dependencies installation failed with exit code: ${code}`);
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
    sendDebugLog('$ Checking for existing Ollama installation...');
    sendDebugLog('$ which ollama || /opt/homebrew/bin/ollama --version || /usr/local/bin/ollama --version');
    
    // Check if Ollama is already installed and get its path
    const ollamaPath = await new Promise((resolve) => {
      exec('which ollama', { timeout: 5000 }, (error, stdout, stderr) => {
        if (!error && stdout.trim()) {
          const path = stdout.trim();
          sendDebugLog(`Found Ollama at: ${path}`);
          resolve(path);
        } else {
          // Try common Homebrew locations
          exec('/opt/homebrew/bin/ollama --version', { timeout: 5000 }, (error2, stdout2) => {
            if (!error2) {
              sendDebugLog('Found Ollama at: /opt/homebrew/bin/ollama');
              resolve('/opt/homebrew/bin/ollama');
            } else {
              exec('/usr/local/bin/ollama --version', { timeout: 5000 }, (error3, stdout3) => {
                if (!error3) {
                  sendDebugLog('Found Ollama at: /usr/local/bin/ollama');
                  resolve('/usr/local/bin/ollama');
                } else {
                  sendDebugLog('Ollama not found in any common locations');
                  resolve(null);
                }
              });
            }
          });
        }
      });
    });
    
    // Install Ollama if not present
    if (!ollamaPath) {
      sendDebugLog('Ollama not found, checking for Homebrew...');
      sendDebugLog('$ which brew || /opt/homebrew/bin/brew --version || /usr/local/bin/brew --version');
      
      // First check if Homebrew is installed
      const brewCheck = await new Promise((resolve) => {
        exec('which brew || /opt/homebrew/bin/brew --version || /usr/local/bin/brew --version', { timeout: 5000 }, (error, stdout, stderr) => {
          if (stdout) sendDebugLog(stdout.trim());
          if (stderr) sendDebugLog('STDERR: ' + stderr.trim());
          if (error) sendDebugLog('ERROR: ' + error.message);
          resolve(!error && stdout.trim());
        });
      });
      
      // Install Homebrew if missing
      if (!brewCheck) {
        sendDebugLog('Homebrew not found, installing...');
        sendDebugLog('$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
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
      } else {
        sendDebugLog('Homebrew found, proceeding with Ollama installation...');
      }
      
      // Now install Ollama via Homebrew
      sendDebugLog('$ brew install ollama');
      await new Promise((resolve, reject) => {
        const process = exec('brew install ollama', { timeout: 300000 });
        
        process.stdout.on('data', (data) => {
          sendDebugLog(data.toString().trim());
        });
        
        process.stderr.on('data', (data) => {
          sendDebugLog('STDERR: ' + data.toString().trim());
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            sendDebugLog('Ollama installation completed successfully');
            resolve();
          } else {
            sendDebugLog(`Ollama installation failed with exit code: ${code}`);
            reject(new Error('Failed to install Ollama via Homebrew'));
          }
        });
      });
    } else {
      sendDebugLog('Ollama already installed, skipping installation step');
    }
    
    // Determine final ollama path (either found or newly installed)
    const finalOllamaPath = ollamaPath || '/opt/homebrew/bin/ollama';
    
    // Start Ollama service
    sendDebugLog('Starting Ollama service...');
    sendDebugLog(`$ ${finalOllamaPath} serve &`);
    exec(`${finalOllamaPath} serve`, { detached: true });
    
    // Wait for service to start then pull model
    sendDebugLog('Waiting 3 seconds for Ollama service to start...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    sendDebugLog('Downloading AI model (this may take several minutes)...');
    sendDebugLog(`$ ${finalOllamaPath} pull llama3.2:3b`);
    
    return new Promise((resolve) => {
      const process = exec(`${finalOllamaPath} pull llama3.2:3b`, { timeout: 600000 });
      
      process.stdout.on('data', (data) => {
        sendDebugLog(data.toString().trim());
      });
      
      process.stderr.on('data', (data) => {
        sendDebugLog('STDERR: ' + data.toString().trim());
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          sendDebugLog('AI model download completed successfully');
          resolve({ success: true, message: 'Ollama and AI model ready' });
        } else {
          sendDebugLog(`AI model download failed with exit code: ${code}`);
          resolve({ 
            success: false, 
            error: 'Failed to download AI model', 
            details: `Exit code: ${code}` 
          });
        }
      });
      
      process.on('error', (error) => {
        sendDebugLog(`Process error: ${error.message}`);
        resolve({ 
          success: false, 
          error: 'Failed to download AI model', 
          details: error.message 
        });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-whisper', async () => {
  try {
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
      return { success: true, message: 'System test passed' };
    } else {
      // Extract specific error details from the output
      const errorLines = result.split('\n').filter(line => line.includes('ERROR:'));
      const specificError = errorLines.length > 0 ? errorLines[errorLines.length - 1].replace('ERROR: ', '') : 'Unknown error';
      sendDebugLog(`System test failed: ${specificError}`);
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

ipcMain.handle('get-ai-prompts', async () => {
  try {
    // Read the summarization prompt from the Python backend
    const summarizerPath = path.join(__dirname, '..', 'src', 'summarizer.py');
    
    if (fs.existsSync(summarizerPath)) {
      const content = fs.readFileSync(summarizerPath, 'utf8');
      
      // Extract the full prompt from the _create_prompt method
      const promptMatch = content.match(/def _create_prompt[\s\S]*?return f"""([\s\S]*?)"""/);
      
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