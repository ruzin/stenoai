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
import sys
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

        # Directories - centralised via get_data_dirs()
        from src.config import get_data_dirs
        dirs = get_data_dirs()
        self.recordings_dir = dirs["recordings"]
        self.transcripts_dir = dirs["transcripts"]
        self.output_dir = dirs["output"]
        
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

        # Get configured language
        from src.config import get_config
        language = get_config().get_language()

        # Transcribe (pass Path object, not string)
        transcript_result = self.transcriber.transcribe_audio(audio_path, language=language)
        
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
    
    async def summarize_transcript(self, transcript_text: str, session_name: str = "Recording", duration_minutes: int = 10) -> dict:
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
        
        # Get configured language
        from src.config import get_config
        language = get_config().get_language()

        # Generate summary (using correct method name and parameters)
        summary_result = self.summarizer.summarize_transcript(transcript_text, duration_minutes, language=language)
        
        if summary_result is None:
            return {
                "summary": "Failed to generate summary",
                "participants": [],
                "discussion_areas": [],
                "key_points": [],
                "action_items": []
            }
        
        # Defensive extraction from summary_result
        try:
            return {
                "summary": getattr(summary_result, 'overview', '') or '',
                "participants": getattr(summary_result, 'participants', []) or [],
                "discussion_areas": [
                    {
                        "title": getattr(area, 'title', ''),
                        "analysis": getattr(area, 'analysis', '')
                    } for area in getattr(summary_result, 'discussion_areas', [])
                ],
                "key_points": [getattr(decision, 'decision', '') for decision in getattr(summary_result, 'key_points', [])],
                "action_items": [getattr(action, 'description', '') for action in getattr(summary_result, 'next_steps', [])]
            }
        except Exception as e:
            print(f"⚠️ Error extracting summary data: {e}")
            return {
                "summary": "Summary extraction failed",
                "participants": [],
                "discussion_areas": [],
                "key_points": [],
                "action_items": []
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
            print(f"⚠️ Could not determine audio duration via wave: {e}")
            # Try ffmpeg for non-WAV files (M4A, WebM, etc.)
            # ffmpeg is bundled; ffprobe is not, so we parse ffmpeg -i stderr
            try:
                import subprocess
                import re
                import shutil

                # Find ffmpeg: bundled locations first, then PATH
                ffmpeg_cmd = None
                if getattr(sys, 'frozen', False):
                    exe_dir = Path(sys.executable).parent
                    for candidate in [
                        exe_dir / 'ffmpeg',
                        exe_dir / '_internal' / 'ffmpeg',
                    ]:
                        if candidate.exists():
                            ffmpeg_cmd = str(candidate)
                            break
                    if ffmpeg_cmd is None and hasattr(sys, '_MEIPASS'):
                        meipass = Path(sys._MEIPASS) / 'ffmpeg'
                        if meipass.exists():
                            ffmpeg_cmd = str(meipass)
                if ffmpeg_cmd is None:
                    ffmpeg_cmd = shutil.which("ffmpeg") or "ffmpeg"

                # Just read metadata (no decoding) -- exits immediately with code 1
                # but still prints "Duration: HH:MM:SS.xx" to stderr
                probe_result = subprocess.run(
                    [ffmpeg_cmd, "-i", str(audio_path)],
                    capture_output=True, text=True, timeout=10
                )
                duration_match = re.search(
                    r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)",
                    probe_result.stderr
                )
                if duration_match:
                    h, m, s, _ = duration_match.groups()
                    duration_seconds = int(h) * 3600 + int(m) * 60 + int(s)
                    if duration_seconds < 60:
                        duration_display = f"{int(duration_seconds)}s"
                        duration_minutes = 0
                    else:
                        duration_minutes = int(duration_seconds / 60)
                        duration_display = f"{duration_minutes}m"
                    print(f"📏 Audio duration (ffmpeg): {duration_seconds:.1f} seconds ({duration_display})")
            except Exception as e2:
                print(f"⚠️ ffmpeg duration fallback failed: {e2}")
            # Last resort: try to get duration from state file timestamps
            if 'duration_seconds' not in locals():
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
            session_name,
            duration_minutes
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
            "summary": summary_data.get("summary", "") or "",
            "participants": summary_data.get("participants", []) or [],
            "discussion_areas": summary_data.get("discussion_areas", []) or [],
            "key_points": summary_data.get("key_points", []) or [],
            "action_items": summary_data.get("action_items", []) or [],
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
            sys.exit(0)
            
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
                            
                            print("✅ Complete processing finished!", flush=True)
                            print(f"📄 Transcript: {result['session_info']['transcript_file']}")
                            print(f"📋 Summary: {result['session_info']['summary_file']}")
                            print(f"📊 Meeting: {result['session_info']['name']}")

                        except Exception as e:
                            print(f"❌ Processing pipeline failed: {e}", flush=True)
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
        sys.exit(0)

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
        sys.exit(1)


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
        sys.exit(1)


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
            sys.exit(1)
    
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
    import sys

    print(f"🎤 Recording {duration} seconds of audio for '{session_name}'...")

    recorder = SimpleRecorder()
    recording_path = None
    recording_started = False
    is_paused = False

    def pause_handler(signum, frame):
        """Handle SIGUSR1 to pause recording"""
        nonlocal is_paused
        print(f"📨 Received SIGUSR1 signal (pause request)")
        print(f"   recording_started={recording_started}, has_recorder={recorder is not None}, has_audio={recorder.audio_recorder is not None if recorder else False}")
        if recording_started and recorder and recorder.audio_recorder:
            if not is_paused:
                recorder.audio_recorder.pause_recording()
                is_paused = True
                print("⏸️ Recording paused successfully")
            else:
                print("⏸️ Already paused - ignoring")
        else:
            print("⚠️ Cannot pause - recording not active")

    def resume_handler(signum, frame):
        """Handle SIGUSR2 to resume recording"""
        nonlocal is_paused
        print(f"📨 Received SIGUSR2 signal (resume request)")
        print(f"   recording_started={recording_started}, is_paused={is_paused}")
        if recording_started and recorder and recorder.audio_recorder:
            if is_paused:
                recorder.audio_recorder.resume_recording()
                is_paused = False
                print("▶️ Recording resumed successfully")
            else:
                print("▶️ Not paused - ignoring")
        else:
            print("⚠️ Cannot resume - recording not active")

    # Register pause/resume signal handlers (Unix only)
    if sys.platform != 'win32':
        try:
            signal.signal(signal.SIGUSR1, pause_handler)
            signal.signal(signal.SIGUSR2, resume_handler)
        except (AttributeError, ValueError) as e:
            print(f"⚠️ Could not register pause/resume signals: {e}")

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
                            
                            print("✅ Complete processing finished!", flush=True)
                            print(f"📄 Transcript: {result['session_info']['transcript_file']}")
                            print(f"📋 Summary: {result['session_info']['summary_file']}")
                            print(f"📊 Meeting: {result['session_info']['name']}")

                        except Exception as e:
                            print(f"❌ Processing pipeline failed: {e}", flush=True)
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
        sys.exit(0)
    
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
            # Count down for normal durations (log every 10 minutes to reduce spam)
            for i in range(duration, 0, -1):
                if i % 600 == 0:  # Every 10 minutes
                    print(f"Recording... {i // 60} minutes remaining")
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
        sys.exit(1)


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
    from src.config import get_data_dirs, get_config
    dirs = get_data_dirs()
    output_dir = dirs["output"]

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect summary files from current output dir
    seen_files = set()
    summaries = []
    for f in output_dir.glob("*_summary.json"):
        summaries.append(f)
        seen_files.add(f.resolve())

    # Also scan the default location if a custom path is set,
    # so meetings stored before the path change remain visible
    custom = get_config().get_storage_path()
    if custom:
        if "StenoAI.app" in str(Path(__file__)) or "Applications" in str(Path(__file__)):
            default_output = Path.home() / "Library" / "Application Support" / "stenoai" / "output"
        else:
            default_output = Path(__file__).parent / "output"
        if default_output.exists():
            for f in default_output.glob("*_summary.json"):
                if f.resolve() not in seen_files:
                    summaries.append(f)
                    seen_files.add(f.resolve())

    meetings = []
    
    # Sort by actual meeting date, with fallback to modification time
    def get_meeting_date(summary_file):
        try:
            with open(summary_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('session_info', {}).get('processed_at', '')
        except:
            # Fallback to file modification time if JSON read fails
            return summary_file.stat().st_mtime
    
    summaries.sort(key=get_meeting_date, reverse=True)
    
    for summary_file in summaries:
        try:
            with open(summary_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Only include essential fields for faster loading
                essential_meeting = {
                    "session_info": data.get("session_info", {}),
                    "summary": data.get("summary", ""),
                    "participants": data.get("participants", []),
                    "discussion_areas": data.get("discussion_areas", []),
                    "key_points": data.get("key_points", []),
                    "action_items": data.get("action_items", []),
                    "transcript": data.get("transcript", ""),
                    "folders": data.get("folders", [])
                }
                meetings.append(essential_meeting)
        except Exception as e:
            # Log warning but continue processing other files
            logger.warning(f"Failed to load {summary_file}: {e}")
            continue
    
    # Output as compact JSON for Electron (no indentation for speed)
    print(json.dumps(meetings, separators=(',', ':')))


@cli.command()
@click.argument('summary_file', required=True)
def reprocess(summary_file):
    """Reprocess a failed summary by re-running Ollama analysis on existing transcript"""
    import json
    from pathlib import Path
    
    async def run_reprocess():
        recorder = SimpleRecorder()
        summary_path = Path(summary_file)
        
        if not summary_path.exists():
            print(f"ERROR: Summary file not found: {summary_file}")
            return
        
        try:
            # Load existing summary file
            with open(summary_path, 'r') as f:
                existing_data = json.load(f)
            
            # Get transcript from the data
            transcript = existing_data.get('transcript', '')
            if not transcript:
                print("ERROR: No transcript found in summary file")
                return
            
            session_name = existing_data.get('session_info', {}).get('name', 'Reprocessed')
            duration_minutes = existing_data.get('session_info', {}).get('duration_minutes', 10)
            
            print(f"🔄 Reprocessing summary for: {session_name}")
            print(f"📝 Transcript length: {len(transcript)} characters")
            
            # Re-run summarization
            summary_data = await recorder.summarize_transcript(transcript, session_name)
            
            # Update the existing data with new summary
            existing_data.update({
                "summary": summary_data.get("summary", "") or "",
                "participants": summary_data.get("participants", []) or [],
                "discussion_areas": summary_data.get("discussion_areas", []) or [],
                "key_points": summary_data.get("key_points", []) or [],
                "action_items": summary_data.get("action_items", []) or [],
            })
            
            # Add reprocess timestamp
            existing_data["session_info"]["reprocessed_at"] = datetime.now().isoformat()
            
            # Save updated summary
            with open(summary_path, 'w') as f:
                json.dump(existing_data, f, indent=2)
            
            print(f"✅ Summary reprocessed successfully: {summary_path}")
            print(f"📋 New summary: {existing_data['summary'][:100]}...")
            
        except Exception as e:
            print(f"ERROR: Failed to reprocess summary: {e}")
    
    asyncio.run(run_reprocess())


@cli.command()
@click.argument('transcript_file')
@click.option('--question', '-q', required=True, help='Question to ask about the transcript')
def query(transcript_file, question):
    """Query a transcript with AI."""
    from pathlib import Path

    transcript_path = Path(transcript_file)

    # Handle summary JSON files (extract transcript from them)
    if transcript_file.endswith('.json'):
        if not transcript_path.exists():
            print(json.dumps({"success": False, "error": f"File not found: {transcript_file}"}))
            return

        try:
            with open(transcript_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                transcript_text = data.get('transcript', '')
                if not transcript_text:
                    print(json.dumps({"success": False, "error": "No transcript found in summary file"}))
                    return
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to read summary file: {e}"}))
            return
    else:
        # Handle plain text transcript files
        if not transcript_path.exists():
            print(json.dumps({"success": False, "error": f"File not found: {transcript_file}"}))
            return

        try:
            with open(transcript_path, 'r', encoding='utf-8') as f:
                transcript_text = f.read()
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to read transcript: {e}"}))
            return

    if not transcript_text or transcript_text.strip() == "":
        print(json.dumps({"success": False, "error": "Transcript is empty"}))
        return

    # Always use llama3.2:3b for queries (fastest response times)
    try:
        from src.config import get_config
        language = get_config().get_language()
        summarizer = OllamaSummarizer(model_name="llama3.2:3b")
        answer = summarizer.query_transcript(transcript_text, question, language=language)

        if answer:
            print(json.dumps({"success": True, "answer": answer}))
        else:
            print(json.dumps({"success": False, "error": "Failed to get response from AI"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Query failed: {e}"}))


@cli.command()
def list_failed():
    """List summary files that failed processing (have fallback summaries)"""
    import json
    from src.config import get_data_dirs, get_config
    dirs = get_data_dirs()
    output_dir = dirs["output"]

    # Collect from current and default locations
    seen_files = set()
    summaries = []
    for f in output_dir.glob("*_summary.json"):
        summaries.append(f)
        seen_files.add(f.resolve())
    custom = get_config().get_storage_path()
    if custom:
        if "StenoAI.app" in str(Path(__file__)) or "Applications" in str(Path(__file__)):
            default_output = Path.home() / "Library" / "Application Support" / "stenoai" / "output"
        else:
            default_output = Path(__file__).parent / "output"
        if default_output.exists():
            for f in default_output.glob("*_summary.json"):
                if f.resolve() not in seen_files:
                    summaries.append(f)

    failed_summaries = []
    
    for summary_file in summaries:
        try:
            with open(summary_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
                # Check for signs of failed processing
                summary_text = data.get("summary", "")
                if (summary_text.startswith("Meeting transcript recorded but detailed analysis failed") or 
                    summary_text.startswith("No transcript was generated") or
                    len(data.get("participants", [])) == 0 and len(data.get("key_points", [])) == 0):
                    failed_summaries.append({
                        "file": str(summary_file),
                        "name": data.get("session_info", {}).get("name", "Unknown"),
                        "processed_at": data.get("session_info", {}).get("processed_at", "Unknown"),
                        "summary": summary_text[:100] + "..." if len(summary_text) > 100 else summary_text
                    })
        except Exception as e:
            continue
    
    if failed_summaries:
        print("🔍 Failed Summaries Found:")
        print("=" * 50)
        for failed in failed_summaries:
            print(f"📁 File: {failed['file']}")
            print(f"📊 Name: {failed['name']}")
            print(f"🕐 Processed: {failed['processed_at']}")
            print(f"📝 Summary: {failed['summary']}")
            print(f"🔄 Reprocess: python simple_recorder.py reprocess \"{failed['file']}\"")
            print("-" * 50)
        print(f"Total failed summaries: {len(failed_summaries)}")
    else:
        print("✅ No failed summaries found - all processing completed successfully!")


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
    
    # Check required directories - uses centralised get_data_dirs()
    from src.config import get_data_dirs
    base_dirs = get_data_dirs()
    
    for dir_name, dir_path in base_dirs.items():
        if dir_path.exists():
            checks.append((f"✅ {dir_name}/", f"exists at {dir_path}"))
        else:
            dir_path.mkdir(parents=True, exist_ok=True)
            checks.append((f"✅ {dir_name}/", f"created at {dir_path}"))
    
    # Check Ollama - use bundled or system Ollama
    try:
        from src.ollama_manager import get_ollama_binary
        ollama_path = get_ollama_binary()
        if ollama_path:
            if 'bin/ollama' in str(ollama_path) or '_internal/ollama' in str(ollama_path):
                checks.append(("✅ Ollama", "bundled"))
            else:
                checks.append(("✅ Ollama", f"found at {ollama_path}"))
        else:
            checks.append(("❌ Ollama", "not found"))
    except Exception as e:
        checks.append(("❌ Ollama", f"Error: {e}"))
    
    # Check ffmpeg (bundled locations first, then system)
    try:
        ffmpeg_found = False
        possible_ffmpeg_paths = []

        # Check bundled ffmpeg (PyInstaller bundle)
        if getattr(sys, 'frozen', False):
            exe_dir = Path(sys.executable).parent
            for candidate in [
                exe_dir / 'ffmpeg',                    # bundle root (stenoai.spec places it at '.')
                exe_dir / '_internal' / 'ffmpeg',      # _internal subdirectory
            ]:
                if candidate.exists():
                    possible_ffmpeg_paths.append(('bundled', str(candidate)))

        possible_ffmpeg_paths.extend([
            (None, 'ffmpeg'),                          # PATH
            (None, '/opt/homebrew/bin/ffmpeg'),         # Homebrew Apple Silicon
            (None, '/usr/local/bin/ffmpeg'),            # Homebrew Intel
            (None, '/usr/bin/ffmpeg'),                  # System
        ])

        for label, path in possible_ffmpeg_paths:
            try:
                result = subprocess.run([path, '-version'],
                                      capture_output=True, timeout=5)
                if result.returncode == 0:
                    checks.append(("✅ ffmpeg", label or f"found at {path}"))
                    ffmpeg_found = True
                    break
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue

        if not ffmpeg_found:
            checks.append(("❌ ffmpeg", "not found - run: brew install ffmpeg"))
    except Exception as e:
        checks.append(("❌ ffmpeg", f"Error: {e}"))
    
    # Skip Ollama model check during setup - service starts automatically when needed
    # Just verify Ollama binary is installed
    # The model will be downloaded during setup if needed
    
    # Check Python dependencies
    try:
        import sounddevice
        checks.append(("✅ sounddevice", "audio recording"))
    except ImportError:
        checks.append(("❌ sounddevice", "pip install sounddevice"))
    
    # Check for whisper backend (prefer pywhispercpp, fallback to openai-whisper)
    whisper_found = False
    try:
        import pywhispercpp
        checks.append(("✅ whisper", "pywhispercpp (fast)"))
        whisper_found = True
    except ImportError:
        pass

    if not whisper_found:
        try:
            import whisper
            checks.append(("✅ whisper", "openai-whisper"))
            whisper_found = True
        except ImportError:
            pass

    if not whisper_found:
        checks.append(("❌ whisper", "pip install pywhispercpp"))
    
    try:
        import ollama
        checks.append(("✅ ollama-python", "LLM client"))
    except ImportError:
        checks.append(("❌ ollama-python", "pip install ollama"))

    # Check if whisper model is downloaded (pywhispercpp stores in ~/Library/Application Support/pywhispercpp/models/)
    whisper_model_path = Path.home() / "Library" / "Application Support" / "pywhispercpp" / "models"
    whisper_models = list(whisper_model_path.glob("ggml-*.bin")) if whisper_model_path.exists() else []
    if whisper_models:
        model_name = whisper_models[0].stem.replace("ggml-", "")
        checks.append(("✅ whisper-model", f"{model_name} downloaded"))
    else:
        checks.append(("⚠️ whisper-model", "will download on first use (~500MB)"))

    # Check if LLM model is downloaded (check ~/.ollama/models/)
    ollama_models_path = Path.home() / ".ollama" / "models" / "manifests" / "registry.ollama.ai" / "library"
    if ollama_models_path.exists() and any(ollama_models_path.iterdir()):
        model_names = [d.name for d in ollama_models_path.iterdir() if d.is_dir()]
        checks.append(("✅ llm-model", ", ".join(model_names[:2])))
    else:
        checks.append(("❌ llm-model", "no model installed - needed for summaries"))

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


@cli.command()
def list_models():
    """List all supported models with metadata"""
    from src.config import get_config

    config = get_config()
    models = config.list_supported_models()
    current_model = config.get_model()

    result = {
        "current_model": current_model,
        "supported_models": models
    }

    print(json.dumps(result, indent=2))


@cli.command()
def get_model():
    """Get the currently configured model"""
    from src.config import get_config

    config = get_config()
    current_model = config.get_model()
    model_info = config.get_model_info(current_model)

    result = {
        "model": current_model,
        "info": model_info
    }

    print(json.dumps(result, indent=2))


@cli.command()
@click.argument('model_name')
def set_model(model_name):
    """Set the preferred model for summarization"""
    from src.config import get_config

    config = get_config()

    # Validate model
    if model_name not in config.SUPPORTED_MODELS:
        print(f"WARNING: Model '{model_name}' is not in the recommended list.")
        print(f"Supported models: {', '.join(config.SUPPORTED_MODELS.keys())}")
        print(f"Setting anyway (make sure it's installed with 'ollama pull {model_name}')")

    success = config.set_model(model_name)

    if success:
        print(f"SUCCESS: Model set to {model_name}")
        print(json.dumps({"success": True, "model": model_name}))
    else:
        print(f"ERROR: Failed to save model configuration")
        print(json.dumps({"success": False, "error": "Failed to save config"}))


@cli.command()
def get_notifications():
    """Get the current notification preference"""
    from src.config import get_config

    config = get_config()
    enabled = config.get_notifications_enabled()

    result = {
        "notifications_enabled": enabled
    }

    print(json.dumps(result, indent=2))


@cli.command()
@click.argument('enabled', type=bool)
def set_notifications(enabled):
    """Set notification preference (True/False)"""
    from src.config import get_config

    config = get_config()
    success = config.set_notifications_enabled(enabled)

    if success:
        print(f"SUCCESS: Notifications {'enabled' if enabled else 'disabled'}")
        print(json.dumps({"success": True, "notifications_enabled": enabled}))
    else:
        print(f"ERROR: Failed to save notification preference")
        print(json.dumps({"success": False, "error": "Failed to save config"}))


@cli.command()
def get_telemetry():
    """Get the current telemetry preference and anonymous ID"""
    from src.config import get_config

    config = get_config()
    enabled = config.get_telemetry_enabled()
    anonymous_id = config.get_anonymous_id()

    result = {
        "telemetry_enabled": enabled,
        "anonymous_id": anonymous_id
    }

    print(json.dumps(result, indent=2))


@cli.command()
@click.argument('enabled', type=bool)
def set_telemetry(enabled):
    """Set telemetry preference (True/False)"""
    from src.config import get_config

    config = get_config()
    success = config.set_telemetry_enabled(enabled)

    if success:
        print(f"SUCCESS: Telemetry {'enabled' if enabled else 'disabled'}")
        print(json.dumps({"success": True, "telemetry_enabled": enabled}))
    else:
        print(f"ERROR: Failed to save telemetry preference")
        print(json.dumps({"success": False, "error": "Failed to save config"}))


@cli.command()
def get_system_audio():
    """Get the current system audio capture preference"""
    from src.config import get_config

    config = get_config()
    enabled = config.get_system_audio_enabled()

    print(json.dumps({"system_audio_enabled": enabled}))


@cli.command()
@click.argument('enabled', callback=lambda ctx, param, v: v.lower() == 'true')
def set_system_audio(enabled):
    """Set system audio capture preference (True/False)"""
    from src.config import get_config

    config = get_config()
    success = config.set_system_audio_enabled(enabled)

    if success:
        print(f"SUCCESS: System audio capture {'enabled' if enabled else 'disabled'}")
        print(json.dumps({"success": True, "system_audio_enabled": enabled}))
    else:
        print(f"ERROR: Failed to save system audio preference")
        print(json.dumps({"success": False, "error": "Failed to save config"}))


@cli.command()
def get_language():
    """Get the current language setting"""
    from src.config import get_config

    config = get_config()
    language = config.get_language()
    language_name = config.get_language_name(language)

    print(json.dumps({"language": language, "language_name": language_name}))


@cli.command()
@click.argument('language_code')
def set_language(language_code):
    """Set the language for transcription and summarization"""
    from src.config import get_config

    config = get_config()

    if language_code not in config.SUPPORTED_LANGUAGES:
        print(json.dumps({
            "success": False,
            "error": f"Unsupported language: {language_code}. Supported: {', '.join(config.SUPPORTED_LANGUAGES.keys())}"
        }))
        return

    success = config.set_language(language_code)

    if success:
        print(json.dumps({
            "success": True,
            "language": language_code,
            "language_name": config.get_language_name(language_code)
        }))
    else:
        print(json.dumps({"success": False, "error": "Failed to save language setting"}))


@cli.command()
def get_storage_path():
    """Get the current custom storage path"""
    from src.config import get_config
    config = get_config()
    storage_path = config.get_storage_path()
    print(json.dumps({"storage_path": storage_path}))


@cli.command()
@click.argument('storage_path', default='')
def set_storage_path(storage_path):
    """Set custom storage path (empty to reset to default)"""
    from src.config import get_config
    config = get_config()
    success = config.set_storage_path(storage_path)
    if success:
        print(json.dumps({"success": True, "storage_path": storage_path}))
    else:
        print(json.dumps({"success": False, "error": "Failed to set storage path"}))


@cli.command()
def list_folders():
    """List all folders"""
    from src.folders import get_folders_manager
    mgr = get_folders_manager()
    print(json.dumps({"folders": mgr.list_folders()}))


@cli.command()
@click.argument('name')
@click.option('--color', default='#6366f1')
def create_folder(name, color):
    """Create a new folder"""
    from src.folders import get_folders_manager
    mgr = get_folders_manager()
    folder = mgr.create_folder(name, color)
    if folder:
        print(json.dumps({"success": True, "folder": folder}))
    else:
        print(json.dumps({"success": False, "error": "Failed to create folder"}))


@cli.command()
@click.argument('folder_id')
@click.argument('name')
def rename_folder(folder_id, name):
    """Rename a folder"""
    from src.folders import get_folders_manager
    mgr = get_folders_manager()
    success = mgr.rename_folder(folder_id, name)
    print(json.dumps({"success": success}))


@cli.command()
@click.argument('folder_ids', nargs=-1, required=True)
def reorder_folders(folder_ids):
    """Reorder folders by providing folder IDs in desired order"""
    from src.folders import get_folders_manager
    mgr = get_folders_manager()
    success = mgr.reorder_folders(list(folder_ids))
    print(json.dumps({"success": success}))


@cli.command()
@click.argument('folder_id')
def delete_folder(folder_id):
    """Delete a folder"""
    from src.folders import get_folders_manager
    mgr = get_folders_manager()
    success = mgr.delete_folder(folder_id)
    print(json.dumps({"success": success}))


@cli.command()
@click.argument('summary_file')
@click.argument('folder_id')
def add_meeting_to_folder(summary_file, folder_id):
    """Add a meeting to a folder"""
    from src.folders import get_folders_manager
    mgr = get_folders_manager()
    success = mgr.add_meeting_to_folder(Path(summary_file), folder_id)
    print(json.dumps({"success": success}))


@cli.command()
@click.argument('summary_file')
@click.argument('folder_id')
def remove_meeting_from_folder(summary_file, folder_id):
    """Remove a meeting from a folder"""
    from src.folders import get_folders_manager
    mgr = get_folders_manager()
    success = mgr.remove_meeting_from_folder(Path(summary_file), folder_id)
    print(json.dumps({"success": success}))


@cli.command()
def download_whisper_model():
    """Download the Whisper transcription model"""
    print("Downloading Whisper model...")

    try:
        from pywhispercpp.model import Model as WhisperCppModel

        # This will trigger the model download if not present
        print("Initializing Whisper model (will download if needed)...")
        model = WhisperCppModel("small")
        print("SUCCESS: Whisper model ready")

    except Exception as e:
        print(f"ERROR: Failed to download Whisper model: {e}")
        import sys
        sys.exit(1)


@cli.command()
@click.argument('model_name')
def check_model(model_name):
    """Check if a model is installed in Ollama (uses HTTP API)."""
    from src.ollama_manager import start_ollama_server
    start_ollama_server()
    try:
        import ollama
        response = ollama.list()
        models = getattr(response, 'models', []) or []
        model_names = [getattr(m, 'model', '') for m in models]
        installed = model_name in model_names
        print(json.dumps({"installed": installed, "model": model_name}))
    except Exception as e:
        print(json.dumps({"installed": False, "model": model_name, "error": str(e)}))


@cli.command()
@click.argument('model_name')
def pull_model(model_name):
    """Download an Ollama model (uses HTTP API)."""
    from src.ollama_manager import start_ollama_server
    start_ollama_server()
    try:
        import ollama
        for progress in ollama.pull(model_name, stream=True):
            status = getattr(progress, 'status', '') or ''
            total = getattr(progress, 'total', 0) or 0
            completed = getattr(progress, 'completed', 0) or 0
            if total > 0:
                pct = int(completed / total * 100)
                print(f"{status} {pct}%", flush=True)
            elif status:
                print(status, flush=True)
        print(json.dumps({"success": True, "model": model_name}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == '__main__':
    cli()