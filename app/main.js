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

// Python backend communication
function runPythonScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const pythonPath = path.join(__dirname, '..', 'venv', 'bin', 'python');
    const scriptPath = path.join(__dirname, '..', script);
    
    console.log('Running:', pythonPath, scriptPath, ...args);
    
    const process = spawn(pythonPath, [scriptPath, ...args], {
      cwd: path.join(__dirname, '..')
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Python stdout:', data.toString());
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('Python stderr:', data.toString());
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
}

// IPC Handlers - Separate start/stop with better error handling
ipcMain.handle('start-recording', async (event, sessionName) => {
  try {
    // Clear any stuck state first
    await runPythonScript('simple_recorder.py', ['clear-state']);
    
    // Start fresh recording
    const result = await runPythonScript('simple_recorder.py', ['start', sessionName || 'Meeting']);
    
    if (result.includes('SUCCESS')) {
      return { success: true, message: result };
    } else {
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('Start recording error:', error.message);
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

// Global recording state management
let currentRecordingProcess = null;
let processingQueue = [];
let isProcessing = false;

// Processing queue management
async function processNextInQueue() {
  if (isProcessing || processingQueue.length === 0) {
    return;
  }
  
  isProcessing = true;
  const job = processingQueue.shift();
  
  console.log(`🔄 Processing queued job: ${job.sessionName}`);
  
  try {
    const result = await runPythonScript('simple_recorder.py', ['process', job.audioFile, '--name', job.sessionName]);
    console.log(`✅ Completed processing: ${job.sessionName}`);
    
    // Notify frontend about completion and refresh meetings list
    if (mainWindow) {
      mainWindow.webContents.send('processing-complete', { 
        success: true, 
        sessionName: job.sessionName,
        message: 'Processing completed successfully'
      });
      
      // Refresh meetings list
      try {
        const meetingsResult = await runPythonScript('simple_recorder.py', ['list-meetings']);
        mainWindow.webContents.send('meetings-refreshed', JSON.parse(meetingsResult));
      } catch (error) {
        console.error('Error refreshing meetings after processing:', error);
      }
    }
    
  } catch (error) {
    console.error(`❌ Processing failed for ${job.sessionName}:`, error);
    
    // Notify frontend about failure
    if (mainWindow) {
      mainWindow.webContents.send('processing-complete', { 
        success: false, 
        sessionName: job.sessionName,
        error: error.message
      });
    }
  } finally {
    isProcessing = false;
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

    // Clear any stuck state first
    await runPythonScript('simple_recorder.py', ['clear-state']);
    
    console.log('Starting long recording process...');
    const pythonPath = path.join(__dirname, '..', 'venv', 'bin', 'python');
    const scriptPath = path.join(__dirname, '..', 'simple_recorder.py');
    
    const actualSessionName = sessionName || 'Meeting';
    
    // Start background recording with no time limit using 'record' command with very long duration
    currentRecordingProcess = spawn(pythonPath, [scriptPath, 'record', '999999', actualSessionName], {
      cwd: path.join(__dirname, '..')
    });

    let hasStarted = false;
    
    currentRecordingProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Recording stdout:', output);
      
      // Check for recording completion and extract audio file path
      if (output.includes('✅ Recording saved:')) {
        const match = output.match(/✅ Recording saved: (.+)/);
        if (match) {
          const audioFile = match[1].trim();
          console.log(`📋 Recording completed: ${audioFile} - adding to processing queue`);
          addToProcessingQueue(audioFile, actualSessionName);
        }
      }
      
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
    
    // Create required directories
    const projectRoot = path.join(__dirname, '..');
    const dirs = ['recordings', 'transcripts', 'output'];
    
    for (const dir of dirs) {
      const dirPath = path.join(projectRoot, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
    
    // Create venv directory if it doesn't exist
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

ipcMain.handle('setup-python', async () => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const venvPath = path.join(projectRoot, 'venv');
    
    // Create virtual environment if it doesn't exist
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
    
    // Install requirements including Whisper
    return new Promise((resolve) => {
      const pythonPath = path.join(venvPath, 'bin', 'python');
      const process = spawn(pythonPath, ['-m', 'pip', 'install', '-r', 'requirements.txt', 'openai-whisper'], {
        cwd: projectRoot,
        stdio: 'pipe'
      });
      
      let output = '';
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, message: 'Python dependencies and Whisper installed' });
        } else {
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

ipcMain.handle('setup-ollama-and-model', async () => {
  try {
    // Check if Ollama is already installed
    const checkResult = await new Promise((resolve) => {
      exec('which ollama || /opt/homebrew/bin/ollama --version || /usr/local/bin/ollama --version', { timeout: 5000 }, (error, stdout, stderr) => {
        resolve(!error && stdout.trim());
      });
    });
    
    // Install Ollama if not present
    if (!checkResult) {
      // First check if Homebrew is installed
      const brewCheck = await new Promise((resolve) => {
        exec('which brew || /opt/homebrew/bin/brew --version || /usr/local/bin/brew --version', { timeout: 5000 }, (error, stdout, stderr) => {
          resolve(!error && stdout.trim());
        });
      });
      
      // Install Homebrew if missing
      if (!brewCheck) {
        console.log('Installing Homebrew...');
        await new Promise((resolve, reject) => {
          exec('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', 
               { timeout: 600000 }, (error, stdout, stderr) => {
            if (!error) {
              resolve();
            } else {
              reject(new Error('Failed to install Homebrew automatically'));
            }
          });
        });
      }
      
      // Now install Ollama via Homebrew
      await new Promise((resolve, reject) => {
        exec('brew install ollama', { timeout: 300000 }, (error, stdout, stderr) => {
          if (!error) {
            resolve();
          } else {
            reject(new Error('Failed to install Ollama via Homebrew'));
          }
        });
      });
    }
    
    // Start Ollama service
    exec('ollama serve', { detached: true });
    
    // Wait for service to start then pull model
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return new Promise((resolve) => {
      exec('ollama pull llama3.2:3b', { timeout: 600000 }, (error, stdout, stderr) => {
        if (!error) {
          resolve({ success: true, message: 'Ollama and AI model ready' });
        } else {
          resolve({ success: false, error: 'Failed to download AI model' });
        }
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
    
    return new Promise((resolve) => {
      const process = spawn(pythonPath, ['-m', 'pip', 'install', 'openai-whisper'], {
        cwd: projectRoot,
        stdio: 'pipe'
      });
      
      let output = '';
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, message: 'Whisper installed successfully' });
        } else {
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
    // Test the complete system
    const result = await runPythonScript('simple_recorder.py', ['test']);
    
    if (result.includes('System check passed') || result.includes('SUCCESS')) {
      return { success: true, message: 'System test passed' };
    } else {
      return { success: false, error: 'System test failed' };
    }
  } catch (error) {
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