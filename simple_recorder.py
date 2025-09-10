#!/usr/bin/env python3
"""
Simple Audio Recorder & Transcriber for Electron App

Backend script that handles:
1. Recording system/microphone audio
2. Transcribing with Whisper  
3. Summarizing with Ollama
4. Saving everything locally

Usage (called by Electron):
    python simple_recorder.py start "Meeting Name"
    python simple_recorder.py stop  
    python simple_recorder.py process recording.wav --name "Session"
    python simple_recorder.py status
"""

import click
import asyncio
import logging
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

# Import modules with graceful fallback for missing dependencies
try:
    from src.audio_recorder import AudioRecorder
except ImportError:
    AudioRecorder = None

try:
    from src.transcriber import WhisperTranscriber  
except ImportError:
    WhisperTranscriber = None
    
try:
    from src.summarizer import OllamaSummarizer
except ImportError:
    OllamaSummarizer = None

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class SimpleRecorder:
    """Simple audio recorder and transcriber."""
    
    def __init__(self):
        # Only initialize if dependencies are available
        self.audio_recorder = AudioRecorder() if AudioRecorder else None
        
        # Only initialize transcriber/summarizer when needed to save memory
        self.transcriber = None
        self.summarizer = None
        
        # Directories - use user data folder for DMG distribution
        import os
        
        # Detect if running from app bundle (DMG install) or development
        current_path = Path(__file__).parent
        if "StenoAI.app" in str(current_path) or "Applications" in str(current_path):
            # DMG/Production: Use Application Support folder
            app_support = Path.home() / "Library" / "Application Support" / "stenoai"
            self.recordings_dir = app_support / "recordings"
            self.transcripts_dir = app_support / "transcripts" 
            self.output_dir = app_support / "output"
        else:
            # Development: Use project relative paths
            self.recordings_dir = Path("recordings")
            self.transcripts_dir = Path("transcripts") 
            self.output_dir = Path("output")
        
        # Create directories (including parent directories)
        for dir_path in [self.recordings_dir, self.transcripts_dir, self.output_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)
        
        # State file
        self.state_file = Path("recorder_state.json")
        
        # Global AudioRecorder instance to maintain state across CLI calls
        self.persistent_recorder = None
        
    def get_state(self) -> dict:
        """Get current recorder state."""
        if self.state_file.exists():
            try:
                with open(self.state_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {"recording": False, "current_file": None, "session_name": None}
    
    def save_state(self, state: dict):
        """Save recorder state."""
        with open(self.state_file, 'w') as f:
            json.dump(state, f, indent=2)
    
    def start_recording(self, session_name: str = "Recording") -> str:
        """Start recording audio."""
        state = self.get_state()
        if state.get("recording"):
            raise Exception(f"Already recording: {state.get('current_file', 'unknown file')}")
        
        # Create filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = "".join(c for c in session_name if c.isalnum() or c in (' ', '-', '_')).strip()
        filename = f"{timestamp}_{safe_name}.wav"
        
        recording_path = self.recordings_dir / filename
        
        print(f"🎤 Starting recording: {session_name}")
        print(f"📁 File: {recording_path}")
        
        # Start recording
        self.audio_recorder.start_recording()
        
        # Update state
        new_state = {
            "recording": True,
            "current_file": str(recording_path), 
            "session_name": session_name,
            "start_time": datetime.now().isoformat()
        }
        self.save_state(new_state)
        
        return str(recording_path)
    
    def stop_recording(self) -> Optional[str]:
        """Stop current recording."""
        state = self.get_state()
        if not state.get("recording"):
            print("⚠️ No active recording to stop")
            return None
        
        print("🔴 Stopping recording")
        
        # Stop recording
        self.audio_recorder.stop_recording()
        
        # Wait a moment for recording to fully stop
        import time
        time.sleep(0.5)
        
        # Get the planned file path from state
        recording_path = state.get("current_file")
        if not recording_path:
            print("⚠️ No recording file path found in state")
            # Try to create a default path
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            recording_path = str(self.recordings_dir / f"{timestamp}_recording.wav")
        
        # Save the recording to the planned file
        from pathlib import Path
        if self.audio_recorder.save_recording(Path(recording_path)):
            print(f"✅ Recording saved: {recording_path}")
        else:
            print("❌ Failed to save recording")
            recording_path = None
        
        # Update state (always clear recording state)
        new_state = {
            "recording": False,
            "current_file": None,
            "session_name": None,
            "stop_time": datetime.now().isoformat()
        }
        if recording_path:
            new_state["last_recording"] = recording_path
        
        self.save_state(new_state)
        return recording_path
    
    async def transcribe_audio(self, audio_file: str, session_name: str = "Recording") -> dict:
        """Transcribe audio file."""
        audio_path = Path(audio_file)
        
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_file}")
        
        print(f"📝 Transcribing: {audio_path.name}")
        
        # Initialize transcriber only when needed
        if self.transcriber is None:
            self.transcriber = WhisperTranscriber()
        
        # Transcribe (pass Path object, not string)
        transcript_result = self.transcriber.transcribe_audio(audio_path)
        
        # Debug: Check what transcript_result actually is
        print(f"DEBUG: transcript_result type: {type(transcript_result)}")
        print(f"DEBUG: transcript_result: {transcript_result}")
        
        # Handle different return types
        if hasattr(transcript_result, 'text'):
            transcript_text = transcript_result.text
        elif isinstance(transcript_result, str):
            transcript_text = transcript_result
        else:
            transcript_text = str(transcript_result)
        
        # Save transcript
        transcript_path = self.transcripts_dir / f"{audio_path.stem}_transcript.txt"
        transcript_content = f"""Session: {session_name}
File: {audio_path.name}
Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

{'='*60}

{transcript_text}
"""
        
        with open(transcript_path, 'w') as f:
            f.write(transcript_content)
        
        print(f"📄 Transcript saved: {transcript_path}")
        
        return {
            "audio_file": str(audio_path),
            "transcript_file": str(transcript_path), 
            "transcript_text": transcript_text,
            "session_name": session_name
        }
    
    async def summarize_transcript(self, transcript_text: str, session_name: str = "Recording") -> dict:
        """Summarize transcript text."""
        print("🧠 Generating summary...")
        
        # Initialize summarizer only when needed
        if self.summarizer is None:
            self.summarizer = OllamaSummarizer()
        
        # Create summary prompt
        prompt = f"""
Please analyze and summarize this audio transcript from a recording session.

Session: {session_name}

Please provide:
1. Brief overview of the content
2. Key points discussed
3. Important decisions or conclusions
4. Action items (if any)
5. Notable quotes or insights

Transcript:
{transcript_text}
"""
        
        # Generate summary (using correct method name and parameters)
        summary_result = self.summarizer.summarize_transcript(transcript_text, 10)  # 10 minutes duration estimate
        
        if summary_result is None:
            return {
                "summary": "Failed to generate summary",
                "key_points": [],
                "action_items": []
            }
        
        return {
            "summary": summary_result.overview,  # MeetingTranscript uses 'overview'
            "participants": summary_result.participants,  # Extract participants list
            "key_points": [decision.decision for decision in summary_result.key_decisions],  # Extract key points from decisions
            "action_items": [action.description for action in summary_result.key_actions]  # Extract next steps from actions
        }
    
    async def process_recording(self, audio_file: str, session_name: str = "Recording") -> dict:
        """Complete processing: transcribe + summarize."""
        print(f"🔄 Processing recording: {audio_file}")
        
        # If no audio file provided, use the last recording
        if not audio_file:
            state = self.get_state()
            audio_file = state.get("last_recording")
            if not audio_file:
                raise Exception("No audio file specified and no recent recording found")
        
        # Ensure we have a proper path
        audio_file = str(audio_file)  # Convert to string if it's a Path object
        audio_path = Path(audio_file)
        
        # Calculate actual recording duration from file
        duration_minutes = 10  # Default fallback
        try:
            import wave
            with wave.open(str(audio_path), 'rb') as wav_file:
                frame_rate = wav_file.getframerate()
                num_frames = wav_file.getnframes()
                duration_seconds = num_frames / frame_rate
                if duration_seconds < 60:
                    duration_display = f"{int(duration_seconds)}s"
                    duration_minutes = 0  # Store as 0 for sub-minute recordings
                else:
                    duration_minutes = int(duration_seconds / 60)
                    duration_display = f"{duration_minutes}m"
                print(f"📏 Audio duration: {duration_seconds:.1f} seconds ({duration_display})")
        except Exception as e:
            print(f"⚠️ Could not determine audio duration: {e}")
            # Try to get duration from state file timestamps
            try:
                state = self.get_state()
                start_time = state.get("start_time")
                stop_time = state.get("stop_time")
                if start_time and stop_time:
                    from dateutil.parser import parse
                    start_dt = parse(start_time)
                    stop_dt = parse(stop_time)
                    duration_seconds = (stop_dt - start_dt).total_seconds()
                    duration_minutes = max(1, int(duration_seconds / 60))
                    print(f"📏 Duration from timestamps: {duration_seconds:.1f} seconds ({duration_minutes} minutes)")
            except Exception:
                pass
        
        # Step 1: Transcribe
        transcript_data = await self.transcribe_audio(audio_file, session_name)
        
        # Step 2: Summarize with actual duration
        summary_data = await self.summarize_transcript(
            transcript_data["transcript_text"], 
            session_name
        )
        
        # Step 3: Save complete summary
        summary_path = self.output_dir / f"{audio_path.stem}_summary.json"
        
        complete_data = {
            "session_info": {
                "name": session_name,
                "audio_file": str(audio_path),
                "transcript_file": transcript_data["transcript_file"],
                "summary_file": str(summary_path),
                "processed_at": datetime.now().isoformat(),
                "duration_seconds": int(duration_seconds) if 'duration_seconds' in locals() else None,
                "duration_minutes": duration_minutes
            },
            "summary": summary_data["summary"],
            "participants": summary_data["participants"],
            "key_points": summary_data["key_points"], 
            "action_items": summary_data["action_items"],
            "transcript": transcript_data["transcript_text"]
        }
        
        with open(summary_path, 'w') as f:
            json.dump(complete_data, f, indent=2)
        
        print(f"✅ Complete processing saved: {summary_path}")
        
        # Clean up WAV file after successful processing
        try:
            audio_path.unlink()
            print(f"🗑️ Cleaned up audio file: {audio_path}")
        except Exception as e:
            print(f"⚠️ Could not delete audio file: {e}")
        
        # Clear any recording state after successful processing
        state_file = Path("recorder_state.json")
        if state_file.exists():
            try:
                state_file.unlink()
                print(f"🧹 Cleared recording state")
            except Exception as e:
                print(f"⚠️ Could not clear state: {e}")
        
        print(f"📋 Processing complete - meeting available in list")
        
        return complete_data


# CLI Commands for Electron
@click.group()
def cli():
    """Simple Audio Recorder & Transcriber Backend"""
    pass


@cli.command()
@click.argument('session_name', default='Recording')
def start(session_name):
    """Start recording audio (stop with Ctrl+C to auto-process)"""
    import signal
    import time
    
    recorder = SimpleRecorder()
    recording_path = None
    recording_started = False
    processing_started = False
    
    def signal_handler(signum, frame):
        """Handle SIGTERM/SIGINT gracefully by stopping recording and processing"""
        nonlocal processing_started
        
        # Different handling for different signals
        signal_name = "SIGINT" if signum == 2 else f"SIGTERM" if signum == 15 else f"Signal {signum}"
        print(f"\n🛑 Received {signal_name} - stopping recording and processing...")
        
        # Prevent double processing if multiple signals received
        if processing_started:
            print("⚠️ Processing already started - please wait for completion...")
            if signum == 15:  # SIGTERM - ignore it during processing
                print("🔄 Ignoring SIGTERM during transcription/summarization")
                return
            exit(0)
            
        if recording_started and recorder:
            processing_started = True
            try:
                final_path = recorder.stop_recording()
                if final_path:
                    print(f"✅ Recording saved: {final_path}")
                    
                    # Check file size
                    from pathlib import Path
                    file_size = Path(final_path).stat().st_size
                    print(f"📏 File size: {file_size / 1024:.1f} KB")
                    
                    if file_size >= 1000:  # At least 1KB of audio data
                        print("🔄 Starting transcription and summarization pipeline...")
                        
                        # Process recording with proper async handling
                        try:
                            import asyncio
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            
                            print("📝 Transcribing...")
                            result = loop.run_until_complete(recorder.process_recording(final_path, session_name))
                            
                            print("✅ Complete processing finished!")
                            print(f"📄 Transcript: {result['session_info']['transcript_file']}")  
                            print(f"📋 Summary: {result['session_info']['summary_file']}")
                            print(f"📊 Meeting: {result['session_info']['name']}")
                            
                        except Exception as e:
                            print(f"❌ Processing pipeline failed: {e}")
                            import traceback
                            traceback.print_exc()
                    else:
                        print("⚠️ Recording too short - skipping processing")
                else:
                    print("❌ No recording data to save")
            except Exception as e:
                print(f"❌ Error during signal handling: {e}")
                import traceback
                traceback.print_exc()
        
        print("🏁 Recording session ended")
        exit(0)
    
    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        recording_path = recorder.start_recording(session_name)
        recording_started = True
        print(f"🎤 Recording '{session_name}' - Press Ctrl+C to stop and process")
        print(f"📁 File: {recording_path}")
        print("📢 Speak now...")
        
        # Wait indefinitely until interrupted
        while True:
            time.sleep(1)
            
    except Exception as e:
        print(f"ERROR: {e}")
        exit(1)


@cli.command()
def stop():
    """Stop current recording and trigger processing"""
    import subprocess
    import signal
    import os
    import time
    
    # First check if there's a recording process running
    try:
        # Find running start processes
        result = subprocess.run(
            ['pgrep', '-f', 'simple_recorder.py start'],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0 and result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            print(f"🔍 Found {len(pids)} recording process(es)")
            
            for pid in pids:
                if pid.strip():
                    try:
                        pid_int = int(pid.strip())
                        print(f"🛑 Sending SIGINT to recording process (PID: {pid_int})")
                        os.kill(pid_int, signal.SIGINT)
                        
                        print(f"✅ Stop signal sent to process {pid_int}")
                        print(f"🔄 Recording will stop and processing will begin automatically")
                        print(f"💡 Processing may take a few minutes - check output files when complete")
                            
                    except (ValueError, ProcessLookupError) as e:
                        print(f"⚠️ Could not signal process {pid}: {e}")
            
            print("✅ Stop signal sent - recording will be processed automatically")
            
        else:
            # Fallback to old method if no start process found
            print("🔍 No start process found, checking recording state...")
            recorder = SimpleRecorder()
            state = recorder.get_state()
            
            if state.get("recording"):
                print("⚠️ Recording state shows active but no process found")
                print("🔧 Clearing stuck state...")
                recorder.save_state({
                    "recording": False,
                    "current_file": None,
                    "session_name": None
                })
                print("✅ State cleared")
            else:
                print("ℹ️ No active recording found")
                
    except Exception as e:
        print(f"ERROR: {e}")
        exit(1)


@cli.command()
@click.argument('audio_file', default='')
@click.option('--name', '-n', default='Recording', help='Session name for the recording')
def process(audio_file, name):
    """Process audio file: transcribe + summarize"""
    
    async def run_process():
        recorder = SimpleRecorder()
        
        try:
            result = await recorder.process_recording(audio_file, name)
            
            print("SUCCESS: Processing complete!")
            print(f"Transcript: {result['session_info']['transcript_file']}")
            print(f"Summary: {result['session_info']['summary_file']}")
            
        except Exception as e:
            print(f"ERROR: {e}")
            exit(1)
    
    asyncio.run(run_process())


@cli.command()
def status():
    """Show recorder status"""
    recorder = SimpleRecorder()
    state = recorder.get_state()
    
    print("🎙️ Steno Recorder Status")
    print("=" * 25)
    
    if state.get("recording"):
        print("STATUS: RECORDING")
        print(f"Session: {state.get('session_name')}")
        print(f"File: {state.get('current_file')}")
        print(f"Started: {state.get('start_time')}")
    else:
        print("STATUS: READY")
    
    # Show recent recordings
    recordings = list(recorder.recordings_dir.glob("*.wav"))
    if recordings:
        recent = sorted(recordings, key=lambda x: x.stat().st_mtime, reverse=True)[:3]
        print(f"\nRecent recordings ({len(recordings)} total):")
        for recording in recent:
            size_mb = recording.stat().st_size / (1024 * 1024)
            print(f"  • {recording.name} ({size_mb:.1f}MB)")


@cli.command()
@click.argument('duration', type=int, default=10)
@click.argument('session_name', default='Recording')
def record(duration, session_name):
    """Record audio for specified duration and process it"""
    import signal
    
    print(f"🎤 Recording {duration} seconds of audio for '{session_name}'...")
    
    recorder = SimpleRecorder()
    recording_path = None
    recording_started = False
    
    def signal_handler(signum, frame):
        """Handle SIGTERM gracefully by stopping recording and processing"""
        print(f"\n🛑 Received termination signal ({signum})")
        if recording_started and recorder:
            print("⏹️ Stopping recording and starting processing pipeline...")
            try:
                final_path = recorder.stop_recording()
                if final_path:
                    print(f"✅ Recording saved: {final_path}")
                    
                    # Check file size
                    from pathlib import Path
                    file_size = Path(final_path).stat().st_size
                    print(f"📏 File size: {file_size / 1024:.1f} KB")
                    
                    if file_size >= 1000:  # At least 1KB of audio data
                        print("🔄 Starting transcription and summarization pipeline...")
                        
                        # Create new event loop for signal handler
                        try:
                            # Process recording synchronously in signal handler
                            import asyncio
                            if hasattr(asyncio, '_get_running_loop') and asyncio._get_running_loop():
                                loop = asyncio._get_running_loop()
                            else:
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                            
                            print("📝 Starting transcription...")
                            result = loop.run_until_complete(recorder.process_recording(final_path, session_name))
                            
                            print("✅ Complete processing finished!")
                            print(f"📄 Transcript: {result['session_info']['transcript_file']}")  
                            print(f"📋 Summary: {result['session_info']['summary_file']}")
                            print(f"📊 Meeting: {result['session_info']['name']}")
                            
                        except Exception as e:
                            print(f"❌ Processing pipeline failed: {e}")
                            import traceback
                            traceback.print_exc()
                    else:
                        print("⚠️ Recording too short - skipping processing")
                else:
                    print("❌ No recording data to save")
            except Exception as e:
                print(f"❌ Error during signal handling: {e}")
                import traceback
                traceback.print_exc()
        
        print("🏁 Recording session ended - process complete")
        exit(0)
    
    # Register signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        # Start recording
        recording_path = recorder.start_recording(session_name)
        recording_started = True
        print(f"📁 Recording to: {recording_path}")
        print("📢 Speak into your microphone now!")
        
        # For very long durations (like 999999), just wait indefinitely until signal
        if duration > 86400:  # More than a day
            print("🔄 Recording indefinitely (until stopped)...")
            try:
                while True:
                    time.sleep(5)  # Check every 5 seconds
            except KeyboardInterrupt:
                signal_handler(signal.SIGINT, None)
        else:
            # Count down for normal durations
            for i in range(duration, 0, -1):
                print(f"   {i}...")
                time.sleep(1)
        
        # Normal completion (if not interrupted)
        final_path = recorder.stop_recording()
        if not final_path:
            print("❌ Recording failed - no audio data collected")
            return
            
        print(f"✅ Recording saved: {final_path}")
        
        # Check file size
        from pathlib import Path
        file_size = Path(final_path).stat().st_size
        print(f"📏 File size: {file_size / 1024:.1f} KB")
        
        if file_size < 1000:  # Less than 1KB indicates empty recording
            print("⚠️ Recording appears to be empty - check microphone")
            return
        
        # Process recording
        print("🔄 Processing recording (transcribe + summarize)...")
        
        async def process_recording():
            result = await recorder.process_recording(final_path, session_name)
            print("✅ Processing complete!")
            print(f"📄 Transcript: {result['session_info']['transcript_file']}")  
            print(f"📋 Summary: {result['session_info']['summary_file']}")
            
            # Show quick preview
            if result.get('transcript'):
                preview = result['transcript'][:200] + "..." if len(result['transcript']) > 200 else result['transcript']
                print(f"📝 Preview: {preview}")
        
        asyncio.run(process_recording())
        
    except Exception as e:
        print(f"❌ Recording failed: {e}")
        import traceback
        traceback.print_exc()
        exit(1)


@cli.command()
def test():
    """Quick system test - check components can initialize"""
    print("🧪 Quick system test...")
    
    try:
        # Test audio recording capability
        print("🎤 Testing audio recording...")
        recorder = SimpleRecorder()
        if not recorder.audio_recorder:
            print("❌ Audio recording not available")
            print("ERROR: Audio dependencies missing")
            return
        print("✅ Audio recording ready")
        
        # Test transcriber availability
        print("🗣️ Testing Whisper transcriber...")
        if not WhisperTranscriber:
            print("❌ Whisper transcriber not available")
            print("ERROR: Whisper not installed")
            return
            
        try:
            transcriber = WhisperTranscriber()
            print("✅ Whisper transcriber ready")
        except Exception as e:
            print(f"❌ Whisper initialization failed: {e}")
            print(f"ERROR: {e}")
            return
        
        # Test Ollama availability (lightweight check)
        print("🧠 Testing Ollama availability...")
        if not OllamaSummarizer:
            print("❌ Ollama summarizer not available")
            print("ERROR: Ollama dependencies missing")
            return
            
        try:
            # Just check if we can initialize without making API calls
            summarizer = OllamaSummarizer()
            print("✅ Ollama summarizer ready")
        except Exception as e:
            print(f"❌ Ollama initialization failed: {e}")
            print(f"ERROR: {e}")
            return
        
        print("🎉 System check passed!")
        print("SUCCESS: All components are working correctly")
        
    except Exception as e:
        print(f"❌ System test failed: {e}")
        print(f"ERROR: {e}")
        return


@cli.command()
def list_meetings():
    """List all processed meetings - optimized for fast loading"""
    # Don't initialize SimpleRecorder to avoid Ollama checks - just get the output directory
    current_path = Path(__file__).parent
    if "StenoAI.app" in str(current_path) or "Applications" in str(current_path):
        # DMG/Production: Use Application Support folder
        app_support = Path.home() / "Library" / "Application Support" / "stenoai"
        output_dir = app_support / "output"
    else:
        # Development: Use project relative paths
        output_dir = Path("output")
    
    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Get all summary files - use glob pattern for speed
    summaries = list(output_dir.glob("*_summary.json"))
    meetings = []
    
    # Sort by modification time first, then process (faster than reading all files first)
    summaries.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    
    for summary_file in summaries:
        try:
            with open(summary_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Only include essential fields for faster loading
                essential_meeting = {
                    "session_info": data.get("session_info", {}),
                    "summary": data.get("summary", ""),
                    "participants": data.get("participants", []),
                    "key_points": data.get("key_points", []),
                    "action_items": data.get("action_items", []),
                    "transcript": data.get("transcript", "")
                }
                meetings.append(essential_meeting)
        except Exception as e:
            # Log warning but continue processing other files
            logger.warning(f"Failed to load {summary_file}: {e}")
            continue
    
    # Output as compact JSON for Electron (no indentation for speed)
    print(json.dumps(meetings, separators=(',', ':')))


@cli.command()
def clear_state():
    """Clear recording state (useful for resetting stuck recordings)"""
    recorder = SimpleRecorder()
    
    if recorder.state_file.exists():
        recorder.state_file.unlink()
        print("SUCCESS: Recording state cleared")
    else:
        print("SUCCESS: No state file found - already clear")


@cli.command()
def setup_check():
    """Check system setup and dependencies"""
    import subprocess
    import sys
    import os
    
    print("🔧 StenoAI Setup Check")
    print("=" * 25)
    
    checks = []
    
    # Check Python version
    try:
        version = sys.version_info
        if version.major >= 3 and version.minor >= 8:
            checks.append(("✅ Python", f"{version.major}.{version.minor}.{version.micro}"))
        else:
            checks.append(("❌ Python", f"{version.major}.{version.minor}.{version.micro} (need 3.8+)"))
    except Exception as e:
        checks.append(("❌ Python", f"Error: {e}"))
    
    # Check required directories - use same logic as SimpleRecorder.__init__
    current_path = Path(__file__).parent
    if "StenoAI.app" in str(current_path) or "Applications" in str(current_path):
        # DMG/Production: Use Application Support folder
        app_support = Path.home() / "Library" / "Application Support" / "stenoai"
        base_dirs = {
            "recordings": app_support / "recordings",
            "transcripts": app_support / "transcripts", 
            "output": app_support / "output"
        }
    else:
        # Development: Use project relative paths
        base_dirs = {
            "recordings": Path("recordings"),
            "transcripts": Path("transcripts"), 
            "output": Path("output")
        }
    
    for dir_name, dir_path in base_dirs.items():
        if dir_path.exists():
            checks.append((f"✅ {dir_name}/", f"exists at {dir_path}"))
        else:
            dir_path.mkdir(parents=True, exist_ok=True)
            checks.append((f"✅ {dir_name}/", f"created at {dir_path}"))
    
    # Check Ollama - use same path resolution as summarizer
    try:
        ollama_found = False
        ollama_path = None
        possible_paths = [
            'ollama',  # Try PATH first
            '/opt/homebrew/bin/ollama',  # Homebrew on Apple Silicon
            '/usr/local/bin/ollama',     # Homebrew on Intel
            '/usr/bin/ollama',           # System installation
        ]
        
        for path in possible_paths:
            try:
                result = subprocess.run([path, '--version'], 
                                      capture_output=True, timeout=5)
                if result.returncode == 0:
                    checks.append(("✅ Ollama", f"found at {path}"))
                    ollama_found = True
                    ollama_path = path
                    break
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue
        
        if not ollama_found:
            checks.append(("❌ Ollama", "not found - run: brew install ollama"))
    except Exception as e:
        checks.append(("❌ Ollama", f"Error: {e}"))
    
    # Skip Ollama model check during setup - service starts automatically when needed
    # Just verify Ollama binary is installed
    # The model will be downloaded during setup if needed
    
    # Check Python dependencies
    try:
        import sounddevice
        checks.append(("✅ sounddevice", "audio recording"))
    except ImportError:
        checks.append(("❌ sounddevice", "pip install sounddevice"))
    
    try:
        import whisper
        checks.append(("✅ whisper", "speech transcription"))
    except ImportError:
        checks.append(("❌ whisper", "pip install openai-whisper"))
    
    try:
        import ollama
        checks.append(("✅ ollama-python", "LLM client"))
    except ImportError:
        checks.append(("❌ ollama-python", "pip install ollama"))
    
    # Print results
    all_good = True
    for status, detail in checks:
        print(f"{status:<20} {detail}")
        if status.startswith("❌"):
            all_good = False
    
    print("\n" + "=" * 25)
    if all_good:
        print("🎉 System check passed! Ready to record meetings.")
    else:
        print("⚠️ Setup incomplete. Please install missing dependencies.")
    
    return {"success": all_good, "checks": checks}


if __name__ == '__main__':
    cli()