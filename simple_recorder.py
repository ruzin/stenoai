#!/usr/bin/env python3
"""
Simple Audio Recorder & Transcriber for Electron App

Backend script that handles:
1. Transcribing captured audio with Whisper/Parakeet
2. Summarizing with Ollama
3. Saving everything locally

Audio capture is done in the Electron renderer (Web Audio); this backend
transcribes/summarizes the resulting file. Usage (called by Electron):
    python simple_recorder.py process-streaming recording.webm --name "Session"
    python simple_recorder.py transcribe-stream   # live partials over stdin
    python simple_recorder.py process recording.wav --name "Session"
    python simple_recorder.py status
"""

import click
import asyncio
import logging
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

# Force UTF-8 on stdout/stderr so emoji and non-ASCII prints don't crash under
# Windows' default cp1252 codepage. Must run before any print() in this module.
# newline="\n" disables Windows' \n -> \r\n translation: the Electron host parses
# our streaming protocol line-by-line and matches exact sentinels (e.g.
# STREAM_COMPLETE); a translated trailing \r would make those exact matches fail
# and strand the UI "in analysis". (main.js also splits CRLF-tolerantly as a
# belt-and-suspenders, but fixing it at the source covers every sentinel.)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="\n")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", newline="\n")
    except (AttributeError, OSError):
        pass

# Wire stdlib SSL up to certifi's CA bundle before anything tries to make
# an HTTPS call. PyInstaller's compiled-in cert paths don't exist on a
# customer's Mac, so without this the adapter request in summarizer.py
# fails with CERTIFICATE_VERIFY_FAILED.
from src import tls_bootstrap  # noqa: F401

# Import modules with graceful fallback for missing dependencies
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

# Session names that should trigger AI title regeneration after summarization.
# Covers manual placeholders (Meeting / Note / Meeting-ABC123 / Note-ABC123) and
# the auto-detect-meetings shape "<AppName> — YYYY-MM-DD HH:MM" produced by
# requestAutoRecord in app/main.js. Keep in sync if the auto-detect format changes.
_AUTO_NAMED_PATTERN = re.compile(
    r'^(?:(?:Meeting|Note)(?:-[A-Z0-9]{6})?'
    r'|.+ — \d{4}-\d{2}-\d{2} \d{2}:\d{2})$'
)

# Shared atomic JSON writer (tempfile + os.replace + Windows PermissionError
# retry). One implementation for recorder_state.json, the summary JSON, and
# config.json — re-exported here so existing imports keep working. The
# canonical copy lives in src.config because this module already imports
# from src (the reverse import would be circular).
from src.config import _atomic_write_json  # noqa: E402


def _start_summary_heartbeat(label: str = "summarize", interval_s: int = 60, max_beats: int = 30):
    """Print ``HEARTBEAT:<label>:<n>`` lines from a daemon thread.

    Covers the silent window between "Generating summary" and the model's
    first streamed token — prompt eval of a context-capped transcript on a
    CPU-only machine can exceed the Electron inactivity watchdog's window
    with zero stdout. Capped at ``max_beats`` so a genuinely hung Ollama
    can't keep the watchdog alive forever (30 beats ≈ the old fixed 30-min
    budget). Returns a ``threading.Event``; set it to stop the beats — the
    caller stops it on the first streamed chunk, after which real output is
    the liveness signal.

    Single ``sys.stdout.write`` per line (TextIOWrapper writes are locked)
    so a beat can never tear a concurrently streamed CHUNK: line.
    """
    import threading

    stop = threading.Event()

    def _beat():
        beats = 0
        while beats < max_beats and not stop.wait(interval_s):
            beats += 1
            sys.stdout.write(f"HEARTBEAT:{label}:{beats}\n")
            sys.stdout.flush()

    threading.Thread(target=_beat, daemon=True, name="summary-heartbeat").start()
    return stop


def _render_frontmatter(meta: dict) -> list[str]:
    """Render a meeting .md YAML frontmatter block (including the enclosing
    ``---`` fences) from a flat dict, with the type-specific scalar
    formatting the streaming save paths use.

    Shared by ``process_recording_streaming``, ``process_streaming`` and the
    transcription-failure writer so the frontmatter format stays in one place.
    ``bool`` is checked before ``int`` because ``bool`` is an ``int`` subclass.
    """
    lines = ['---']
    for k, v in meta.items():
        if v is None:
            lines.append(f'{k}: null')
        elif isinstance(v, bool):
            lines.append(f'{k}: {"true" if v else "false"}')
        elif isinstance(v, int):
            lines.append(f'{k}: {v}')
        else:
            escaped = str(v).replace('\\', '\\\\').replace('"', '\\"')
            lines.append(f'{k}: "{escaped}"')
    lines.append('---')
    return lines


class MeetingPipeline:
    """Simple audio recorder and transcriber."""
    
    def __init__(self):
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

    def _resolve_output_language(self, configured_language: str, detected_language: Optional[str] = None) -> str:
        """Resolve which language should be used for summary/title/query output."""
        from src.config import get_config

        if configured_language != "auto":
            return configured_language

        if detected_language:
            return detected_language

        return "en"

    def _transcript_file_path(self, audio_path: Path) -> Path:
        """Canonical on-disk path for a meeting's transcript text file.

        Single source of truth so the normal path and the live-transcript /
        crash fallback always agree on the filename (#207).
        """
        return self.transcripts_dir / f"{audio_path.stem}_transcript.txt"

    def _write_transcript_file(
        self,
        audio_path: Path,
        transcript_body: str,
        session_name: str,
        configured_language: str,
        detected_language: Optional[str] = None,
        output_language: Optional[str] = None,
    ) -> Path:
        """Format + write the transcript .txt with the standard header.

        Used by both the normal transcription path and the fallback paths so
        the file format and name stay identical (#207). Returns the path.
        """
        from src.config import get_config
        config = get_config()

        if output_language is None:
            output_language = self._resolve_output_language(configured_language, detected_language)
        detected_language_name = (
            config.get_language_name(detected_language) if detected_language else "Unknown"
        )

        transcript_path = self._transcript_file_path(audio_path)
        transcript_content = f"""Session: {session_name}
File: {audio_path.name}
Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
Language setting: {config.get_language_name(configured_language)}
Detected language: {detected_language_name}
Summary output language: {config.get_language_name(output_language)}

{'='*60}

{transcript_body}
"""
        with open(transcript_path, 'w') as f:
            f.write(transcript_content)
        return transcript_path

    @staticmethod
    def _load_user_notes(session_name: str, output_dir) -> Optional[str]:
        """Load user notes file saved by Electron during recording."""
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', session_name)
        for candidate in [
            Path(output_dir) / f"{safe_name}_notes.txt",
            Path(output_dir) / f"{session_name}_notes.txt",
        ]:
            if candidate.exists():
                try:
                    text = candidate.read_text(encoding='utf-8').strip()
                    if text:
                        logger.info(f"Loaded user notes ({len(text)} chars)")
                        return text
                except Exception:
                    pass
                break
        return None

    @staticmethod
    def _parse_streamed_markdown(md_text: str) -> dict:
        """Parse streamed markdown summary into structured fields."""
        summary_parts = []
        participants = []
        discussion_areas = []
        key_points = []
        action_items = []
        current_section = None
        current_topic_title = None
        current_topic_lines = []

        for line in md_text.split('\n'):
            stripped = line.strip()
            if stripped.startswith('## Summary'):
                current_section = 'summary'
            elif stripped.startswith('## Participants'):
                current_section = 'participants'
            elif stripped.startswith('## Key Topics'):
                current_section = 'topics'
            elif stripped.startswith('## Key Points'):
                current_section = 'keypoints'
            elif stripped.startswith('## Action Items'):
                current_section = 'actions'
            elif stripped.startswith('### ') and current_section == 'topics':
                if current_topic_title:
                    discussion_areas.append({"title": current_topic_title, "analysis": '\n'.join(current_topic_lines).strip()})
                current_topic_title = stripped[4:]
                current_topic_lines = []
            elif current_section == 'summary' and stripped:
                summary_parts.append(stripped)
            elif current_section == 'participants' and stripped:
                participants.extend([p.strip() for p in stripped.split(',') if p.strip()])
            elif current_section == 'topics' and current_topic_title:
                current_topic_lines.append(stripped)
            elif current_section == 'keypoints' and stripped.startswith('- '):
                key_points.append(stripped[2:])
            elif current_section == 'actions' and stripped.startswith('- '):
                action_items.append(stripped[2:].replace('[ ] ', '').replace('[x] ', ''))

        if current_topic_title:
            discussion_areas.append({"title": current_topic_title, "analysis": '\n'.join(current_topic_lines).strip()})

        return {
            "summary": ' '.join(summary_parts),
            "participants": participants,
            "discussion_areas": discussion_areas,
            "key_points": key_points,
            "action_items": action_items,
        }

    async def transcribe_audio(self, audio_file: str, session_name: str = "Recording") -> dict:
        """Transcribe audio file."""
        audio_path = Path(audio_file)

        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_file}")

        print(f"📝 Transcribing: {audio_path.name}")

        from src.config import get_config
        config = get_config()

        # Initialize transcriber only when needed
        if self.transcriber is None:
            self.transcriber = WhisperTranscriber(model_size=config.get_whisper_model())

        # Get configured language
        configured_language = config.get_language()

        # Transcribe with diarisation support (stereo → [You]/[Others])
        transcript_result = self.transcriber.transcribe_diarised(audio_path, language=configured_language)

        # A transcription crash (e.g. an OOM on a long file) is not silence:
        # propagate the flag and skip writing a normal transcript file so the
        # caller preserves the audio and saves a marked, reprocessable meeting
        # instead of a fake-empty one.
        if isinstance(transcript_result, dict) and transcript_result.get("transcription_failed"):
            return {
                "audio_file": str(audio_path),
                "session_name": session_name,
                "duration_seconds": transcript_result.get("duration_seconds"),
                "configured_language": configured_language,
                "transcription_failed": True,
                "error": transcript_result.get("error") or "transcription failed",
            }

        # Handle different return types
        duration_seconds = None
        detected_language = None
        if isinstance(transcript_result, dict):
            transcript_text = transcript_result.get("text") or ""
            duration_seconds = transcript_result.get("duration_seconds")
            detected_language = transcript_result.get("detected_language")
        elif hasattr(transcript_result, 'text'):
            transcript_text = transcript_result.text
        elif isinstance(transcript_result, str):
            transcript_text = transcript_result
        else:
            transcript_text = str(transcript_result)

        # Extract diarisation fields
        is_diarised = False
        diarised_text = None
        if isinstance(transcript_result, dict):
            is_diarised = transcript_result.get("is_diarised", False)
            diarised_text = transcript_result.get("diarised_text")

        output_language = self._resolve_output_language(configured_language, detected_language)

        # Save transcript (use diarised text if available for the saved file)
        saved_transcript = diarised_text if diarised_text else transcript_text
        transcript_path = self._write_transcript_file(
            audio_path,
            saved_transcript,
            session_name,
            configured_language,
            detected_language=detected_language,
            output_language=output_language,
        )

        print(f"📄 Transcript saved: {transcript_path}")

        return {
            "audio_file": str(audio_path),
            "transcript_file": str(transcript_path),
            "transcript_text": transcript_text,
            "session_name": session_name,
            "duration_seconds": duration_seconds,
            "configured_language": configured_language,
            "detected_language": detected_language,
            "is_diarised": is_diarised,
            "diarised_text": diarised_text,
            "output_language": output_language,
        }

    async def summarize_transcript(
        self,
        transcript_text: str,
        session_name: str = "Recording",
        duration_minutes: int = 10,
        language: Optional[str] = None,
        notes_text: Optional[str] = None
    ) -> dict:
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
        
        # Resolve output language
        from src.config import get_config
        if language is None:
            configured_language = get_config().get_language()
            language = self._resolve_output_language(configured_language)

        # Generate summary (using correct method name and parameters)
        summary_result = self.summarizer.summarize_transcript(transcript_text, duration_minutes, language=language, notes=notes_text)
        
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
    
    def _handle_transcription_failure(
        self,
        audio_path: Path,
        session_name: str,
        transcript_data: dict,
        notes_text: Optional[str] = None,
    ) -> dict:
        """Save a marked, reprocessable meeting when transcription crashed.

        A crash (e.g. an MLX OOM on a long file) is not silence. Rather than
        summarise a fake-empty transcript and delete the recording, we:

        * **preserve** the source audio regardless of ``keep_recordings`` —
          it's the only copy and the retry material;
        * **skip** Ollama summarisation entirely;
        * write a clearly-marked ``<stem>_summary.md`` with
          ``transcription_failed`` / ``reprocessable`` / ``audio_file`` so the
          meeting surfaces honestly and can be retried later;
        * emit ``TRANSCRIPTION_FAILED:`` (for an honest error toast) alongside
          ``SAVED:`` (so the renderer still navigates to the marked meeting).
        """
        error = str(transcript_data.get("error") or "transcription failed")
        # Collapse whitespace/newlines: the error becomes a single-line YAML
        # frontmatter scalar, and a literal newline would break the round-trip
        # through _parse_meeting_markdown.
        short_error = " ".join(error.split())[:200]
        summary_path = self.output_dir / f"{audio_path.stem}_summary.md"
        processed_at = datetime.now().isoformat()
        duration_seconds = transcript_data.get("duration_seconds")
        md_meta = {
            'title': session_name,
            'date': processed_at,
            'duration_seconds': int(duration_seconds) if duration_seconds else None,
            'language': transcript_data.get("configured_language"),
            'is_diarised': False,
            'transcription_failed': True,
            'reprocessable': True,
            'audio_file': str(audio_path),
            'error': short_error,
        }
        md_lines = _render_frontmatter(md_meta)
        md_lines.append('')
        # Write the message under a `## Summary` heading so it survives
        # _parse_meeting_markdown (which only captures text under `## `
        # sections) and renders as the meeting's summary instead of a blank
        # note. Copy is honest about current capability: the audio is
        # preserved, but there is no in-app retry yet (tracked follow-up).
        md_lines.append('## Summary')
        md_lines.append('')
        md_lines.append(
            'Transcription failed, so no notes were generated for this recording. '
            'Your audio was preserved (not deleted), so nothing was lost.'
        )
        if notes_text:
            md_lines.append('')
            md_lines.append('## User Notes')
            md_lines.append('')
            md_lines.append(notes_text)
        summary_path.write_text('\n'.join(md_lines), encoding='utf-8')

        print(f"⚠️ Transcription failed; preserved audio: {audio_path}")
        print(f"TRANSCRIPTION_FAILED:{short_error}", flush=True)
        print(f"SAVED:{summary_path}", flush=True)

        # Clear recording state (the recording itself is done; only its
        # transcription failed) so a stale state file doesn't linger.
        state_file = Path("recorder_state.json")
        if state_file.exists():
            try:
                state_file.unlink()
            except Exception:
                pass

        return {
            "session_info": {
                "name": session_name,
                "audio_file": str(audio_path),
                # No transcript was produced, but the process CLI handlers read
                # this key unconditionally — keep it present
                # and empty so a failure doesn't KeyError and turn a graceful
                # exit into a non-zero crash.
                "transcript_file": "",
                "summary_file": str(summary_path),
                "transcription_failed": True,
                "error": short_error,
            }
        }

    async def process_recording(self, audio_file: str, session_name: str = "Recording", notes_text: Optional[str] = None) -> dict:
        """Complete processing: transcribe + summarize."""
        print(f"🔄 Processing recording: {audio_file}")
        
        if not audio_file:
            raise Exception("No audio file specified")
        
        # Ensure we have a proper path
        audio_file = str(audio_file)  # Convert to string if it's a Path object
        audio_path = Path(audio_file)
        
        # Step 1: Transcribe (also returns duration from the converted WAV)
        transcript_data = await self.transcribe_audio(audio_file, session_name)

        # A transcription crash is not silence — preserve the audio and save a
        # marked, reprocessable meeting instead of summarising a fake-empty one.
        if transcript_data.get("transcription_failed"):
            return self._handle_transcription_failure(audio_path, session_name, transcript_data, notes_text)

        # Determine duration: use transcriber's value (works for all formats)
        duration_seconds = transcript_data.get("duration_seconds")
        if duration_seconds is not None:
            if duration_seconds < 60:
                duration_minutes = 0
                print(f"📏 Audio duration: {duration_seconds:.1f} seconds ({int(duration_seconds)}s)")
            else:
                duration_minutes = int(duration_seconds / 60)
                print(f"📏 Audio duration: {duration_seconds:.1f} seconds ({duration_minutes}m)")
        else:
            duration_minutes = 0
            print("⚠️ Could not determine audio duration")

        # Step 2: Summarize — prefer diarised text so LLM sees speaker labels
        text_for_summary = transcript_data.get("diarised_text") or transcript_data["transcript_text"]
        summary_data = await self.summarize_transcript(
            text_for_summary,
            session_name,
            duration_minutes,
            language=transcript_data.get("output_language"),
            notes_text=notes_text
        )

        # Step 2b: Auto-generate title for auto-named meetings
        if _AUTO_NAMED_PATTERN.match(session_name):
            try:
                language = transcript_data.get("output_language")
                generated_title = self.summarizer.generate_title(
                    summary_data.get("summary", ""),
                    transcript_data["transcript_text"],
                    language=language
                )
                if generated_title:
                    print(f"Auto-generated title: {generated_title}")
                    session_name = generated_title
            except Exception as e:
                print(f"Title generation skipped: {e}")

        # Step 3: Save complete summary
        summary_path = self.output_dir / f"{audio_path.stem}_summary.json"

        complete_data = {
            "session_info": {
                "name": session_name,
                "audio_file": str(audio_path),
                "transcript_file": transcript_data["transcript_file"],
                "summary_file": str(summary_path),
                "processed_at": datetime.now().isoformat(),
                "duration_seconds": int(duration_seconds) if duration_seconds is not None else None,
                "duration_minutes": duration_minutes,
                "configured_language": transcript_data.get("configured_language"),
                "detected_language": transcript_data.get("detected_language"),
                "output_language": transcript_data.get("output_language"),
            },
            "summary": summary_data.get("summary", "") or "",
            "participants": summary_data.get("participants", []) or [],
            "discussion_areas": summary_data.get("discussion_areas", []) or [],
            "key_points": summary_data.get("key_points", []) or [],
            "action_items": summary_data.get("action_items", []) or [],
            "transcript": transcript_data["transcript_text"],
            "is_diarised": transcript_data.get("is_diarised", False),
            "diarised_text": transcript_data.get("diarised_text"),
            "user_notes": notes_text,
        }
        
        # Atomic write: a crash here previously left a half-written
        # multi-MB summary JSON and the source WAV gets deleted below,
        # so the meeting was unrecoverable. Now the prior file (if any)
        # stays intact unless the new one writes fully.
        _atomic_write_json(summary_path, complete_data)

        print(f"✅ Complete processing saved: {summary_path}")
        
        # Clean up WAV file after successful processing
        from src.config import get_config
        if not get_config().get_keep_recordings():
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

    async def process_recording_streaming(self, audio_file: str, session_name: str = "Recording", notes_text: Optional[str] = None) -> dict:
        """Process recording with streaming summary output via CHUNK: protocol."""
        import base64
        print(f"🔄 Processing recording: {audio_file}")

        if not audio_file:
            raise Exception("No audio file specified")

        audio_path = Path(audio_file)
        if not audio_path.exists():
            raise Exception(f"Audio file not found: {audio_file}")

        # Step 1: Transcribe
        transcript_data = await self.transcribe_audio(audio_file, session_name)

        # A transcription crash is not silence — preserve the audio and save a
        # marked, reprocessable meeting instead of summarising a fake-empty one.
        if transcript_data.get("transcription_failed"):
            return self._handle_transcription_failure(audio_path, session_name, transcript_data, notes_text)

        transcript_text = transcript_data.get("transcript_text", "")
        diarised_text = transcript_data.get("diarised_text")
        text_for_summary = diarised_text or transcript_text

        duration_seconds = transcript_data.get("duration_seconds")
        duration_minutes = int(duration_seconds / 60) if duration_seconds else 0

        if duration_seconds:
            print(f"📏 Audio duration: {duration_seconds} seconds ({int(duration_seconds)}s)")

        print(f"TRANSCRIPTION_COMPLETE:{len(transcript_text)}", flush=True)

        # Step 2: Streaming summary
        if self.summarizer is None:
            self.summarizer = OllamaSummarizer()

        from src.config import get_config
        config = get_config()
        configured_language = config.get_language()
        output_language = self._resolve_output_language(
            configured_language, transcript_data.get("detected_language")
        )

        print("🧠 Generating summary...", flush=True)
        streamed_chunks = []
        for chunk in self.summarizer.summarize_transcript_streaming(
            text_for_summary, duration_minutes, output_language, notes_text
        ):
            encoded = base64.b64encode(chunk.encode('utf-8')).decode('ascii')
            sys.stdout.write(f"CHUNK:{encoded}\n")
            sys.stdout.flush()
            streamed_chunks.append(chunk)
        streamed_md = ''.join(streamed_chunks)

        print("STREAM_COMPLETE", flush=True)

        # Step 3: Generate title
        if _AUTO_NAMED_PATTERN.match(session_name):
            try:
                generated_title = self.summarizer.generate_title(
                    streamed_md, transcript_text, language=output_language
                )
                if generated_title:
                    session_name = generated_title
                    print(f"TITLE:{session_name}", flush=True)
                    print(f"Auto-generated title: {session_name}")
            except Exception as e:
                logger.warning(f"Title generation failed: {e}")

        # Step 4: Parse streamed markdown into structured JSON
        parsed = self._parse_streamed_markdown(streamed_md)

        # Step 5: Save as .md (primary format for new meetings)
        summary_path = self.output_dir / f"{audio_path.stem}_summary.md"
        processed_at = datetime.now().isoformat()
        md_meta = {
            'title': session_name,
            'date': processed_at,
            'duration_seconds': int(duration_seconds) if duration_seconds else None,
            'language': output_language,
            'is_diarised': transcript_data.get('is_diarised', False),
        }
        md_lines = _render_frontmatter(md_meta)
        md_lines.append('')
        md_lines.append(streamed_md)
        md_lines.append('')
        md_lines.append('## Transcript')
        md_lines.append('')
        md_lines.append(diarised_text or transcript_text)
        if notes_text:
            md_lines.append('')
            md_lines.append('## User Notes')
            md_lines.append('')
            md_lines.append(notes_text)
        summary_path.write_text('\n'.join(md_lines), encoding='utf-8')

        # Clean up
        from src.config import get_config
        if not get_config().get_keep_recordings():
            try:
                audio_path.unlink()
                print(f"🗑️ Cleaned up audio file: {audio_path}")
            except Exception:
                pass

        state_file = Path("recorder_state.json")
        if state_file.exists():
            try:
                state_file.unlink()
            except Exception:
                pass

        print(f"✅ Complete processing saved: {summary_path}")
        print(f"SAVED:{summary_path}", flush=True)
        return {
            "session_info": {
                "name": session_name,
                "transcript_file": str(transcript_data.get("transcript_file", "")),
                "summary_file": str(summary_path),
            }
        }


# CLI Commands for Electron
@click.group()
def cli():
    """Simple Audio Recorder & Transcriber Backend"""
    pass


@cli.command()
@click.argument('audio_file', default='')
@click.option('--name', '-n', default='Recording', help='Session name for the recording')
@click.option('--notes', default=None, help='Path to user notes file')
def process(audio_file, name, notes):
    """Process audio file: transcribe + summarize"""

    async def run_process():
        recorder = MeetingPipeline()

        # Read user notes if provided
        notes_text = None
        if notes:
            try:
                notes_text = Path(notes).read_text(encoding='utf-8').strip()
                if notes_text:
                    logger.info(f"Loaded user notes ({len(notes_text)} chars)")
            except Exception as e:
                logger.warning(f"Failed to read notes file: {e}")

        try:
            result = await recorder.process_recording(audio_file, name, notes_text=notes_text)
            
            print("SUCCESS: Processing complete!")
            print(f"Transcript: {result['session_info']['transcript_file']}")
            print(f"Summary: {result['session_info']['summary_file']}")
            
        except Exception as e:
            print(f"ERROR: {e}")
            sys.exit(1)
    
    asyncio.run(run_process())


# Minimum length for the LIVE transcript to be worth swapping in as a fallback
# (#207). This is a quality floor on the *fallback source* only — it does NOT
# decide whether the batch result is bad (that's batch_failed / the silence
# sentinel). A correct-but-short batch transcript is never replaced.
_LIVE_TRANSCRIPT_MIN_CHARS = 100

# Detect a silence-only batch result exactly, kept in sync with the
# transcriber that produces the sentinel. Mirrors the graceful-import pattern
# above so a missing transcriber dependency doesn't break the CLI.
try:
    from src.transcriber import SILENCE_SENTINEL as _SILENCE_SENTINEL
except ImportError:
    _SILENCE_SENTINEL = "No speech detected in audio"


@cli.command(name='process-streaming')
@click.argument('audio_file', default='')
@click.option('--name', '-n', default='Recording', help='Session name')
@click.option('--notes', default=None, help='Path to user notes file')
@click.option('--live-transcript', 'live_transcript', default=None,
              help='Path to the live transcript captured during recording, '
                   'used as a fallback if batch transcription returns empty (#207)')
def process_streaming(audio_file, name, notes, live_transcript):
    """Process audio with streaming summary output.

    Transcribes audio, then streams the summary as CHUNK: prefixed lines
    to stdout for Electron to relay to the renderer in real time.
    """
    import sys

    async def run():
        recorder = MeetingPipeline()

        # Read user notes
        notes_text = None
        if notes:
            try:
                notes_text = Path(notes).read_text(encoding='utf-8').strip()
                if notes_text:
                    logger.info(f"Loaded user notes ({len(notes_text)} chars)")
            except Exception as e:
                logger.warning(f"Failed to read notes file: {e}")

        # Read the live transcript fallback (#207). The renderer accumulates
        # live segments during recording; Electron writes them to this file so
        # we can rescue a meeting whose batch transcription came back empty.
        live_transcript_text = None
        if live_transcript:
            try:
                live_transcript_text = Path(live_transcript).read_text(encoding='utf-8').strip()
                if live_transcript_text:
                    logger.info(f"Loaded live transcript fallback ({len(live_transcript_text)} chars)")
            except Exception as e:
                logger.warning(f"Failed to read live transcript file: {e}")

        # Step 1: Transcribe. HEARTBEAT: lines are a liveness signal for the
        # Electron inactivity watchdog — without them a long transcription is
        # silent on stdout until TRANSCRIPTION_COMPLETE and indistinguishable
        # from a hung process. Electron routes them to the debug log.
        # A heartbeat must never break transcription — if the registry can't
        # even import, transcribe without one.
        try:
            from src.parakeet import set_chunk_heartbeat
        except Exception:
            def set_chunk_heartbeat(_cb):
                pass

        def _heartbeat_sink(done, total):
            sys.stdout.write(f"HEARTBEAT:transcribe:{done}/{total}\n")
            sys.stdout.flush()

        print("HEARTBEAT:transcribe:start", flush=True)
        set_chunk_heartbeat(_heartbeat_sink)
        try:
            transcript_data = await recorder.transcribe_audio(audio_file, name)
        finally:
            set_chunk_heartbeat(None)

        # Live-transcript fallback (#207): rescue the meeting with the live
        # transcript the user watched stream in, instead of discarding it as
        # "No speech detected", but ONLY when the batch result is genuinely
        # unusable:
        #   - the batch transcription crashed (transcription_failed), or
        #   - it came back as exactly the silence sentinel.
        # A correct-but-short meeting (e.g. a 5-minute stand-up under 100 chars)
        # is a real batch transcript and must NOT be replaced — the old length
        # threshold did exactly that (Fix 4). The 100-char floor is kept only as
        # a MINIMUM-QUALITY gate on the live fallback itself: we won't swap in a
        # live transcript that's too short to be worth it.
        batch_text = transcript_data.get("transcript_text", "") or ""
        batch_failed = bool(transcript_data.get("transcription_failed"))
        batch_is_silence = batch_text.strip() == _SILENCE_SENTINEL
        is_live_transcript = False
        if (batch_failed or batch_is_silence) and live_transcript_text \
                and len(live_transcript_text) >= _LIVE_TRANSCRIPT_MIN_CHARS:
            logger.warning(
                "Batch transcription %s; falling back to the live transcript "
                "captured during recording (%d chars)",
                "failed" if batch_failed else "returned only silence",
                len(live_transcript_text),
            )
            is_live_transcript = True
            # Always (re)write _transcript.txt with the live text via the shared
            # formatter so the on-disk file matches the markdown/summary the user
            # sees and uses the canonical filename/header (#207, review-2
            # Finding 3). The silence path may already have written the sentinel
            # (Fix 6); the crash path (transcription_failed) wrote NO transcript
            # file at all and exposes no "transcript_file" key — the old code
            # only overwrote a pre-existing file, so the crash fallback left the
            # .txt missing entirely. Writing unconditionally fixes both.
            fallback_audio_path = Path(audio_file)
            existing_transcript_file = None
            try:
                written_path = recorder._write_transcript_file(
                    fallback_audio_path,
                    live_transcript_text,
                    name,
                    transcript_data.get("configured_language") or "auto",
                    detected_language=transcript_data.get("detected_language"),
                )
                existing_transcript_file = str(written_path)
                logger.info(
                    "Wrote transcript file with live transcript: %s",
                    existing_transcript_file,
                )
            except Exception as e:
                logger.warning(
                    "Failed to write transcript file with live text: %s", e
                )
            # Rebuild transcript_data so the rest of the pipeline (summary, save)
            # uses the live transcript. Live transcripts are not channel-diarised.
            transcript_data = {
                "transcript_text": live_transcript_text,
                "diarised_text": None,
                "is_diarised": False,
                "duration_seconds": transcript_data.get("duration_seconds"),
                "detected_language": transcript_data.get("detected_language"),
                "transcript_file": existing_transcript_file,
            }

        # A transcription crash (e.g. an MLX OOM on a long system-audio
        # recording) is not silence — preserve the audio and save a marked,
        # reprocessable meeting instead of summarising a fake-empty one.
        # (Only when there's no live transcript to fall back on.)
        if transcript_data.get("transcription_failed"):
            recorder._handle_transcription_failure(Path(audio_file), name, transcript_data, notes_text)
            return

        transcript_text = transcript_data.get("transcript_text", "")
        diarised_text = transcript_data.get("diarised_text")
        text_for_summary = diarised_text or transcript_text

        duration_seconds = transcript_data.get("duration_seconds")
        duration_minutes = int(duration_seconds / 60) if duration_seconds else 0

        print(f"TRANSCRIPTION_COMPLETE:{len(transcript_text)}", flush=True)

        # Step 2: Stream summary
        if recorder.summarizer is None:
            recorder.summarizer = OllamaSummarizer()

        from src.config import get_config
        config = get_config()
        configured_language = config.get_language()
        output_language = recorder._resolve_output_language(
            configured_language, transcript_data.get("detected_language")
        )

        import base64
        streamed_chunks = []
        # Keep the watchdog alive through model load + prompt eval — the
        # silent stretch before the first streamed token. Stopped on the
        # first chunk; from then on the chunks themselves are the signal.
        summary_heartbeat = _start_summary_heartbeat()
        try:
            for chunk in recorder.summarizer.summarize_transcript_streaming(
                text_for_summary, duration_minutes, output_language, notes_text
            ):
                summary_heartbeat.set()
                encoded = base64.b64encode(chunk.encode('utf-8')).decode('ascii')
                sys.stdout.write(f"CHUNK:{encoded}\n")
                sys.stdout.flush()
                streamed_chunks.append(chunk)
        finally:
            summary_heartbeat.set()
        streamed_md = ''.join(streamed_chunks)

        print("STREAM_COMPLETE", flush=True)

        # Step 3: Generate title
        session_name = name
        if _AUTO_NAMED_PATTERN.match(name):
            try:
                generated_title = recorder.summarizer.generate_title(
                    streamed_md, transcript_text, language=output_language
                )
                if generated_title:
                    session_name = generated_title
                    print(f"TITLE:{session_name}", flush=True)
            except Exception as e:
                logger.warning(f"Title generation failed: {e}")

        # Step 4: Save as .md
        audio_path = Path(audio_file)
        summary_path = recorder.output_dir / f"{audio_path.stem}_summary.md"

        # Parse the streamed markdown for title generation
        parsed = MeetingPipeline._parse_streamed_markdown(streamed_md)

        # Save as .md only (primary format for new meetings)
        summary_path = summary_path.with_suffix('.md')
        processed_at = datetime.now().isoformat()
        md_meta = {
            'title': session_name,
            'date': processed_at,
            'duration_seconds': int(duration_seconds) if duration_seconds else None,
            'language': output_language,
            'is_diarised': transcript_data.get('is_diarised', False),
        }
        # Mark live-sourced meetings (#207) so the UI and future code know this
        # transcript came from the live capture, not a batch transcription.
        if is_live_transcript:
            md_meta['is_live_transcript'] = True
        md_lines = _render_frontmatter(md_meta)
        md_lines.append('')
        md_lines.append(streamed_md)
        md_lines.append('')
        md_lines.append('## Transcript')
        md_lines.append('')
        md_lines.append(diarised_text or transcript_text)
        if notes_text:
            md_lines.append('')
            md_lines.append('## User Notes')
            md_lines.append('')
            md_lines.append(notes_text)
        summary_path.write_text('\n'.join(md_lines), encoding='utf-8')

        # Clean up audio. When we fell back to the live transcript the batch
        # transcription was empty/failed, so KEEP the audio regardless of the
        # keep_recordings setting — it's the user's only retry material if they
        # want a proper batch transcript later (mirrors the failure path).
        from src.config import get_config
        if not is_live_transcript and not get_config().get_keep_recordings():
            try:
                audio_path.unlink()
            except Exception:
                pass

        print(f"SAVED:{summary_path}", flush=True)

    asyncio.run(run())


@cli.command(name='get-whisper-model')
def get_whisper_model_cmd():
    """Get the configured Whisper model size."""
    from src.config import get_config
    config = get_config()
    print(json.dumps({
        "whisper_model": config.get_whisper_model(),
        "supported_models": list(config.SUPPORTED_WHISPER_MODELS),
    }))


@cli.command(name='list-whisper-models')
def list_whisper_models_cmd():
    """List supported Whisper models with metadata + installed status (UI)."""
    from src.config import get_config
    from src.whisper_models import SUPPORTED_WHISPER_MODELS, is_installed
    config = get_config()
    current = config.get_whisper_model()
    supported = {
        key: {**meta, "installed": is_installed(key)}
        for key, meta in SUPPORTED_WHISPER_MODELS.items()
    }
    print(json.dumps({
        "current_model": current,
        "supported_models": supported,
        "provider": "local",
    }))


@cli.command(name='pull-whisper-model')
@click.argument('model_name')
def pull_whisper_model_cmd(model_name):
    """Download a Whisper model from HuggingFace, streaming progress lines."""
    from src.whisper_models import (
        SUPPORTED_WHISPER_MODELS,
        download_with_progress,
        is_installed,
    )
    if model_name not in SUPPORTED_WHISPER_MODELS:
        print(json.dumps({"success": False, "error": f"Unknown model: {model_name}"}))
        return
    if is_installed(model_name):
        print(json.dumps({"success": True, "model": model_name, "already_installed": True}))
        return

    def emit(pct, done, total):
        # Match the Ollama pull format ("<status> <pct>%") so the Electron
        # progress parser can reuse the same regex.
        print(f"Downloading {pct}%", flush=True)

    ok = download_with_progress(model_name, emit)
    if ok:
        print(json.dumps({"success": True, "model": model_name}))
    else:
        print(json.dumps({"success": False, "error": "Download failed"}))


@cli.command(name='set-whisper-model')
@click.argument('model_size')
def set_whisper_model_cmd(model_size: str):
    """Set the Whisper model size."""
    from src.config import get_config
    config = get_config()
    if config.set_whisper_model(model_size):
        print(json.dumps({"success": True, "whisper_model": model_size}))
    else:
        print(json.dumps({
            "success": False,
            "error": f"Unsupported model: {model_size}",
            "supported_models": list(config.SUPPORTED_WHISPER_MODELS),
        }))


@cli.command(name='get-transcription-engine')
def get_transcription_engine_cmd():
    """Get the active ASR engine ('parakeet' or 'whisper')."""
    from src.config import get_config
    config = get_config()
    print(json.dumps({
        "engine": config.get_transcription_engine(),
        "valid_engines": list(config.VALID_TRANSCRIPTION_ENGINES),
    }))


@cli.command(name='set-transcription-engine')
@click.argument('engine')
def set_transcription_engine_cmd(engine: str):
    """Set the active ASR engine. Used by Settings → Transcribe."""
    from src.config import get_config
    config = get_config()
    if config.set_transcription_engine(engine):
        print(json.dumps({"success": True, "engine": engine}))
    else:
        print(json.dumps({
            "success": False,
            "error": f"Invalid engine: {engine}",
            "valid_engines": list(config.VALID_TRANSCRIPTION_ENGINES),
        }))


@cli.command(name='list-parakeet-models')
def list_parakeet_models_cmd():
    """List Parakeet models with metadata + installed status (UI)."""
    from src.parakeet_models import SUPPORTED_PARAKEET_MODELS, is_installed, DEFAULT_MODEL_ID
    supported = {
        key: {**meta, "installed": is_installed(key)}
        for key, meta in SUPPORTED_PARAKEET_MODELS.items()
    }
    print(json.dumps({
        "current_model": DEFAULT_MODEL_ID,
        "supported_models": supported,
        "provider": "local",
    }))


@cli.command(name='parakeet-status')
def parakeet_status_cmd():
    """Cheap check the Setup wizard polls to decide whether step 2 can be skipped."""
    from src.parakeet_models import is_installed, DEFAULT_MODEL_ID
    print(json.dumps({
        "model": DEFAULT_MODEL_ID,
        "installed": is_installed(DEFAULT_MODEL_ID),
    }))


@cli.command(name='onnx-selftest')
def onnx_selftest_cmd():
    """Prove ONNX Runtime's native libraries load + run inside the bundle.

    CI's other smoke tests (``parakeet-status``) only touch a Python id
    string and never construct an InferenceSession, so a missing or broken
    onnxruntime native DLL — the well-documented PyInstaller-on-Windows
    gotcha (microsoft/onnxruntime#25193) — would still build green and only
    fail at the user's first transcription. This loads the bundled Silero
    VAD model (a few hundred KB, no network) and runs one inference, which
    forces the native session libs to load and execute. The same DLLs back
    the onnx-asr Parakeet path on Windows/Linux, so a pass here means the
    ASR session libs are present too.

    Prints ``ONNX_SELFTEST_OK`` and exits 0 on success; prints the error and
    exits 1 on any failure so CI fails the build.
    """
    try:
        import numpy as np
        from src.silero_vad import SileroVAD, VAD_CHUNK_SAMPLES
        vad = SileroVAD()
        prob = vad.predict(np.zeros((VAD_CHUNK_SAMPLES,), dtype=np.float32))
        # On non-darwin the Parakeet backend is onnx-asr. Importing it here
        # catches bundling gaps the VAD check misses — notably onnx_asr's
        # `importlib.metadata.version("onnx-asr")` at import, which needs the
        # package metadata copied into the bundle (copy_metadata in the spec).
        if sys.platform != "darwin":
            import onnx_asr  # noqa: F401

        # Long-file windowing self-check. The actual ASR weights (670 MB)
        # aren't in CI, so we can't recognise real audio here — but we CAN
        # prove the manual windowing in _parakeet_onnx.transcribe_file slices
        # a >120 s array into multiple windows and merges them, end-to-end in
        # the frozen bundle, by driving it with a stub recogniser. This catches
        # a numpy/slicing bundling gap or a windowing regression offline.
        from src import _parakeet_onnx as _onnx
        long_samples = np.zeros(130 * _onnx._SAMPLE_RATE, dtype=np.float32)

        class _CountingModel:
            def __init__(self):
                self.calls = 0

            def recognize(self, window, sample_rate=None):
                self.calls += 1
                from types import SimpleNamespace
                return SimpleNamespace(text="", tokens=[], timestamps=[])

        counter = _CountingModel()
        merged = _onnx._transcribe_windows(counter, long_samples)
        if counter.calls < 2:
            raise RuntimeError(
                f"windowing produced {counter.calls} window(s) for a 130 s array; expected >= 2"
            )
        if not isinstance(merged, _onnx._SimpleResult):
            raise RuntimeError("windowing did not return a _SimpleResult")

        print(f"ONNX_SELFTEST_OK prob={float(prob):.4f} windows={counter.calls}")
    except Exception as e:
        print(f"ONNX_SELFTEST_FAIL: {e}", file=sys.stderr)
        sys.exit(1)


@cli.command(name='warmup-parakeet')
def warmup_parakeet_cmd():
    """Pre-load Parakeet weights to warm the OS page cache.

    Fired by Electron at app launch (best-effort, non-blocking). The
    subprocess loads the model end-to-end and exits — when the actual
    recording subprocess later spawns and calls ``ensure_loaded``, the
    model files are already in the OS page cache so disk I/O is
    near-instant. Does NOT eliminate the per-subprocess MLX parse cost
    (that requires a long-running daemon), but it shaves the visible
    portion of "first record after launch is slow" by ~1 s on modern
    SSDs and more on cold caches.

    Silent on success — Electron parses only the exit code. On
    'model not installed' (fresh user before Setup runs), exits 0
    without loading; the cost of trying to load a missing model is
    higher than just skipping.
    """
    from src.parakeet_models import is_installed, DEFAULT_MODEL_ID
    if not is_installed(DEFAULT_MODEL_ID):
        return
    try:
        from src.parakeet import ensure_loaded
        ensure_loaded()
    except Exception as e:
        # Best-effort: a warmup failure must never block app startup.
        # Log to stderr so the Electron debug log captures it, but
        # exit 0 so main.js doesn't surface it as an error to the user.
        print(f"warmup-parakeet failed: {e}", file=sys.stderr)


@cli.command(name='download-parakeet-model')
@click.argument('model_id', required=False)
def download_parakeet_model_cmd(model_id):
    """Download a Parakeet snapshot from HuggingFace.

    Emits ``PARAKEET_PULL_STAGE:<stage>`` lines (parsed by main.js into a
    parakeet-pull-progress IPC event) before the final JSON result. Stages
    are coarse (``downloading`` / ``loading``) because the snapshot is
    multiple files and threading byte-level progress through
    huggingface_hub's tqdm isn't worth the wire complexity for a one-time
    ~600 MB download.
    """
    from src.parakeet_models import (
        DEFAULT_MODEL_ID,
        SUPPORTED_PARAKEET_MODELS,
        download,
        is_installed,
    )
    target = model_id or DEFAULT_MODEL_ID
    if target not in SUPPORTED_PARAKEET_MODELS:
        print(json.dumps({"success": False, "error": f"Unknown model: {target}"}))
        return
    if is_installed(target):
        print(json.dumps({"success": True, "model": target, "already_installed": True}))
        return

    def emit(stage: str):
        print(f"PARAKEET_PULL_STAGE:{stage}", flush=True)

    ok = download(target, emit)
    if ok:
        print(json.dumps({"success": True, "model": target}))
    else:
        print(json.dumps({"success": False, "error": "Download failed"}))


@cli.command(name='get-keep-recordings')
def get_keep_recordings_cmd():
    """Get whether recordings are kept after processing."""
    from src.config import get_config
    config = get_config()
    print(json.dumps({"keep_recordings": config.get_keep_recordings()}))


@cli.command(name='set-keep-recordings')
@click.argument('enabled', type=bool)
def set_keep_recordings_cmd(enabled: bool):
    """Set whether recordings are kept after processing."""
    from src.config import get_config
    config = get_config()
    if config.set_keep_recordings(enabled):
        print(json.dumps({"success": True, "keep_recordings": enabled}))
    else:
        print(json.dumps({"success": False, "error": "Failed to persist setting"}))


@cli.command(name='get-silence-auto-stop')
def get_silence_auto_stop_cmd():
    """Get whether recordings auto-stop on a stretch of silence + the duration."""
    from src.config import get_config
    config = get_config()
    print(json.dumps({
        "silence_auto_stop_enabled": config.get_silence_auto_stop_enabled(),
        "silence_auto_stop_minutes": config.get_silence_auto_stop_minutes(),
        "supported_minutes": list(config.SUPPORTED_SILENCE_AUTO_STOP_MINUTES),
    }))


@cli.command(name='set-silence-auto-stop-enabled')
@click.argument('enabled', type=bool)
def set_silence_auto_stop_enabled_cmd(enabled: bool):
    from src.config import get_config
    config = get_config()
    if config.set_silence_auto_stop_enabled(enabled):
        print(json.dumps({"success": True, "silence_auto_stop_enabled": enabled}))
    else:
        print(json.dumps({"success": False, "error": "Failed to persist setting"}))


@cli.command(name='set-silence-auto-stop-minutes')
@click.argument('minutes', type=int)
def set_silence_auto_stop_minutes_cmd(minutes: int):
    from src.config import get_config
    config = get_config()
    if config.set_silence_auto_stop_minutes(minutes):
        print(json.dumps({"success": True, "silence_auto_stop_minutes": minutes}))
    else:
        print(json.dumps({
            "success": False,
            "error": f"Unsupported minutes value; expected one of {list(config.SUPPORTED_SILENCE_AUTO_STOP_MINUTES)}",
        }))


@cli.command()
def status():
    """Show recorder status.

    Recording state is tracked in the Electron main process now (capture is
    renderer-driven), not in recorder_state.json — so this reports backend
    readiness ("READY") plus recent recordings. Used by main.js as a backend
    health check (get-status).
    """
    recorder = MeetingPipeline()

    print("🎙️ Steno Recorder Status")
    print("=" * 25)
    print("STATUS: READY")

    # Show recent recordings
    recordings = list(recorder.recordings_dir.glob("*.wav"))
    if recordings:
        recent = sorted(recordings, key=lambda x: x.stat().st_mtime, reverse=True)[:3]
        print(f"\nRecent recordings ({len(recordings)} total):")
        for recording in recent:
            size_mb = recording.stat().st_size / (1024 * 1024)
            print(f"  • {recording.name} ({size_mb:.1f}MB)")


class _LiveVadPipeline:
    """VAD-gated batch transcription pipeline for the live-transcript consumer.

    Replaces the earlier parakeet-mlx streaming approach with the
    Granola / OpenOats / Meetily pattern: Silero VAD detects utterance
    boundaries; each closed utterance is batch-transcribed by Parakeet
    for a stable, finalised segment. While speech is in progress, a
    throttled re-transcribe of the trailing few seconds emits a partial
    so the user sees text forming in real time without flicker between
    unrelated decoder hypotheses.

    Protocol emitted on stdout (unchanged from earlier streaming consumer
    so main.js / preload / ipc.ts wiring is reused):

      LIVE_READY:<config json>     once, after both models are loaded
      LIVE_SEG:<segment json>      per partial OR final
      LIVE_ERROR:<error json>      on any unrecoverable failure

    Driven by ``_live_stdin_consumer`` (stdin bytes input, the renderer-driven
    capture path), which drives ``process(chunk)`` from its own input loop and
    calls ``finalize()`` on shutdown. The class owns all VAD + partial/final
    state so the live path is in one place.

    Architecture notes:
      * Audio is consumed at 16 kHz mono float32 (Parakeet + Silero
        native rate). Callers must downsample / decimate / mono-mix
        upstream — the pipeline doesn't resample.
      * Preroll ring holds the most recent ``PREROLL_CHUNKS`` chunks of
        pre-speech audio so the first syllable of every utterance is
        recovered after VAD fires (Silero always trips slightly late).
      * Partials see the trailing ``PARTIAL_WINDOW_S`` of the utterance.
        At 15 s, a 4-5 sentence monologue stays fully visible in the live
        bubble (the prior 5 s window meant the rolling view dropped
        earlier sentences off-screen during continuous speech). Parakeet
        decodes 15 s in ~150-250 ms on Apple Silicon, comfortably under
        the 400 ms partial interval. Going wider (e.g. matching MAX at
        30 s) would risk decode time creeping past the interval and
        back-pressuring the stdin pipe.
      * Final fires on Silero's SpeechEnd OR when the utterance hits
        ``MAX_UTTERANCE_S`` so a monologue still produces output.
    """

    PARTIAL_INTERVAL_S = 0.4
    PARTIAL_WINDOW_S = 15.0
    MIN_UTTERANCE_S = 0.5
    MAX_UTTERANCE_S = 30.0
    PREROLL_CHUNKS = 2  # ≈ 512 ms at 256 ms per callback

    @classmethod
    def create(cls, source_rate, source_label):
        """Load Parakeet + Silero, emit LIVE_READY, return a ready pipeline.

        Returns ``None`` if any setup step fails (after emitting
        LIVE_ERROR). Callers should ``return`` on ``None``.
        """
        try:
            import numpy as _np
        except ImportError:
            print("LIVE_ERROR:" + json.dumps({"stage": "import_numpy"}), flush=True)
            return None

        # Live transcription is Parakeet-only. Whisper users get the
        # post-stop pipeline (src.transcriber.WhisperTranscriber) and no
        # live drawer; main.js gates this by not spawning the
        # `transcribe-stream` sidecar for whisper recordings. The defensive
        # check below catches anyone driving the CLI directly with a whisper
        # config.
        try:
            from src.config import get_config
            _cfg = get_config()
            engine = _cfg.get_transcription_engine()
            language = _cfg.get_language() or "auto"
        except Exception as e:
            print("LIVE_ERROR:" + json.dumps({
                "stage": "load_config", "error": str(e),
            }), flush=True)
            return None

        if engine != "parakeet":
            print("LIVE_ERROR:" + json.dumps({
                "stage": "engine_not_supported_for_live",
                "engine": engine,
                "message": (
                    f"Live transcription is Parakeet-only; engine is {engine!r}. "
                    "Switch to Parakeet in Settings → Transcribe, or rely on the "
                    "post-stop transcription pipeline."
                ),
            }), flush=True)
            return None

        try:
            from src.parakeet import (
                transcribe_samples, ensure_loaded, model_sample_rate,
            )
        except ImportError as e:
            print("LIVE_ERROR:" + json.dumps({
                "stage": "import_parakeet", "error": str(e),
            }), flush=True)
            return None

        try:
            from src.silero_vad import (
                SileroProcessor, SpeechStart, SpeechEnd, VAD_SAMPLE_RATE,
            )
        except ImportError as e:
            print("LIVE_ERROR:" + json.dumps({
                "stage": "import_silero", "error": str(e),
            }), flush=True)
            return None

        try:
            sr = model_sample_rate()
        except Exception as e:
            print("LIVE_ERROR:" + json.dumps({
                "stage": f"load_{engine}", "error": str(e),
            }), flush=True)
            return None

        if sr != VAD_SAMPLE_RATE:
            # Silero is hard-pinned to 16 kHz; if Parakeet's expected rate
            # ever diverges we'd need a real resampler here. Surface it
            # loudly rather than silently producing garbage.
            print("LIVE_ERROR:" + json.dumps({
                "stage": "rate_mismatch",
                "error": f"parakeet_rate={sr} != silero_rate={VAD_SAMPLE_RATE}",
            }), flush=True)
            return None

        try:
            vad = SileroProcessor()
        except Exception as e:
            print("LIVE_ERROR:" + json.dumps({
                "stage": "load_silero", "error": str(e),
            }), flush=True)
            return None

        # Pre-load the active engine so the first SpeechEnd doesn't pay
        # warm-load latency on the user's very first utterance.
        try:
            ensure_loaded()
        except Exception as e:
            print("LIVE_ERROR:" + json.dumps({
                "stage": "ensure_loaded", "error": str(e),
            }), flush=True)
            return None

        ready_payload = {
            "engine": engine,
            "language": language,
            "sample_rate": sr,
            "vad_chunk_samples": vad.chunk_samples,
            "min_utterance_s": cls.MIN_UTTERANCE_S,
            "max_utterance_s": cls.MAX_UTTERANCE_S,
            "partial_interval_s": cls.PARTIAL_INTERVAL_S,
        }
        if source_rate is not None:
            ready_payload["source_rate"] = source_rate
        if source_label is not None:
            ready_payload["source"] = source_label
        print("LIVE_READY:" + json.dumps(ready_payload), flush=True)

        return cls(
            np=_np,
            vad=vad,
            sr=sr,
            SpeechStart=SpeechStart,
            SpeechEnd=SpeechEnd,
            transcribe_samples=transcribe_samples,
            language=language,
        )

    def __init__(self, np, vad, sr, SpeechStart, SpeechEnd, transcribe_samples,
                 language="auto"):
        self.np = np
        self.vad = vad
        self.sr = sr
        self.SpeechStart = SpeechStart
        self.SpeechEnd = SpeechEnd
        self.transcribe_samples = transcribe_samples
        # Passed through to every transcribe_samples() call. Parakeet is
        # multilingual + language-agnostic at inference, so "auto" and a
        # concrete code both produce the same decoding. The hint is
        # surfaced back to the summariser via detected_language when
        # concrete.
        self.language = "auto" if language in (None, "", "auto") else language
        self.partial_interval_samples = int(sr * self.PARTIAL_INTERVAL_S)
        self.partial_window_samples = int(sr * self.PARTIAL_WINDOW_S)
        self.min_utterance_samples = int(sr * self.MIN_UTTERANCE_S)
        self.max_utterance_samples = int(sr * self.MAX_UTTERANCE_S)

        # Mutable state for the run.
        self.speech_samples = np.empty((0,), dtype=np.float32)
        self.speech_start_offset = 0
        self.last_partial_count = 0
        self.last_partial_text = ""
        self.preroll: list = []
        self.cursor = 0

    def parse_float32_bytes(self, raw_bytes):
        """Parse raw little-endian float32 bytes into a 1-D float32 array.

        Used by the stdin consumer so the consumer itself doesn't need a
        guarded numpy import — the pipeline already failed at create()
        time if numpy was missing, so by the time we get here it exists.
        ``.copy()`` because ``frombuffer`` returns a read-only view of
        the input bytes; downstream VAD code mutates in place.
        """
        return self.np.frombuffer(raw_bytes, dtype=self.np.float32).copy()

    def process(self, chunk):
        """Feed one float32 1-D chunk through the VAD + transcribe pipeline."""
        if chunk.size == 0:
            return
        was_in_speech = self.vad.in_speech
        events = self.vad.process(chunk)
        self.cursor += len(chunk)

        for ev in events:
            if isinstance(ev, self.SpeechStart):
                preroll_audio = (
                    self.np.concatenate(self.preroll) if self.preroll
                    else self.np.empty((0,), dtype=self.np.float32)
                )
                self.speech_samples = preroll_audio
                self.speech_start_offset = max(
                    0, self.cursor - len(chunk) - len(preroll_audio),
                )
                self.last_partial_count = 0
                self.last_partial_text = ""
            elif isinstance(ev, self.SpeechEnd):
                self._finalise()

        if self.vad.in_speech:
            self.speech_samples = self.np.concatenate([self.speech_samples, chunk])
            self.preroll = []
            if len(self.speech_samples) >= self.max_utterance_samples:
                self._finalise()
            else:
                self._maybe_emit_partial()
        else:
            self.preroll.append(chunk)
            if len(self.preroll) > self.PREROLL_CHUNKS:
                self.preroll.pop(0)

        if was_in_speech != self.vad.in_speech:
            logger.debug(
                "VAD transition: in_speech=%s buffer=%d samples",
                self.vad.in_speech, len(self.speech_samples),
            )

    def finalize(self):
        """Drain VAD on shutdown so a trailing utterance still emits.

        Callers should call this once after their input loop exits (EOF,
        stop_event set, etc.)."""
        for ev in self.vad.flush():
            if isinstance(ev, self.SpeechEnd):
                self._finalise()
        if len(self.speech_samples) >= self.min_utterance_samples:
            self._finalise()

    def _emit(self, text, start_samples, end_samples, is_final):
        if not text:
            return
        print("LIVE_SEG:" + json.dumps({
            "text": text,
            "start": start_samples / self.sr,
            "end": end_samples / self.sr,
            "is_final": is_final,
        }), flush=True)

    def _finalise(self):
        if len(self.speech_samples) < self.min_utterance_samples:
            self.speech_samples = self.np.empty((0,), dtype=self.np.float32)
            self.last_partial_count = 0
            self.last_partial_text = ""
            return
        try:
            result = self.transcribe_samples(self.speech_samples, language=self.language)
            text = (result.get("text") or "").strip() if result else ""
        except Exception as e:
            print("LIVE_ERROR:" + json.dumps({
                "stage": "transcribe_final", "error": str(e),
            }), flush=True)
            self.speech_samples = self.np.empty((0,), dtype=self.np.float32)
            self.last_partial_count = 0
            self.last_partial_text = ""
            return
        end_sample = self.speech_start_offset + len(self.speech_samples)
        self._emit(
            text,
            start_samples=self.speech_start_offset,
            end_samples=end_sample,
            is_final=True,
        )
        # Advance the offset so a continued utterance (e.g. when
        # MAX_UTTERANCE_S forces a mid-monologue final) doesn't reuse the
        # just-emitted segment's start time on its next partial/final.
        self.speech_start_offset = end_sample
        self.speech_samples = self.np.empty((0,), dtype=self.np.float32)
        self.last_partial_count = 0
        self.last_partial_text = ""

    def _maybe_emit_partial(self):
        delta = len(self.speech_samples) - self.last_partial_count
        if delta < self.partial_interval_samples:
            return
        if len(self.speech_samples) < self.min_utterance_samples:
            return
        # Only the trailing window — re-transcribing the full utterance
        # every PARTIAL_INTERVAL_S would scale O(n²) with utterance length.
        tail = self.speech_samples[-self.partial_window_samples:]
        try:
            result = self.transcribe_samples(tail, language=self.language)
        except Exception as e:
            # Partials are best-effort. Don't tear down the consumer over
            # a transient decode hiccup; the next partial/final retries.
            logger.debug("partial transcribe failed: %s", e)
            self.last_partial_count = len(self.speech_samples)
            return
        text = (result.get("text") or "").strip() if result else ""
        self.last_partial_count = len(self.speech_samples)
        if text and text != self.last_partial_text:
            self.last_partial_text = text
            self._emit(
                text,
                start_samples=self.speech_start_offset + max(
                    0, len(self.speech_samples) - self.partial_window_samples,
                ),
                end_samples=self.speech_start_offset + len(self.speech_samples),
                is_final=False,
            )


def _live_stdin_consumer():
    """Live consumer fed by raw float32 stdin (renderer-driven system-audio
    path). The renderer captures mic + system audio via Web Audio,
    downsamples its 48 kHz mix to 16 kHz mono float32, and pushes chunks
    to main.js over IPC. main.js spawns this subprocess and writes those
    chunks to our stdin.

    Exits cleanly on stdin EOF (main.js closes the pipe on stop) or on
    SIGTERM. Input format is contract: 16 kHz mono float32, native byte
    order. Any other input is undefined behaviour.
    """
    import sys
    import signal

    # numpy is imported (and guarded) inside _LiveVadPipeline.create() so
    # an absent install emits LIVE_ERROR and returns None rather than
    # crashing the subprocess before main.js sees any signal.
    pipeline = _LiveVadPipeline.create(source_rate=None, source_label="stdin")
    if pipeline is None:
        return

    # Signal handler: SIGTERM from main.js (on stop) should flush + exit
    # cleanly. SIGINT covers terminal Ctrl-C in dev runs.
    stop_flag = [False]
    def _on_signal(signum, frame):
        stop_flag[0] = True
    try:
        signal.signal(signal.SIGTERM, _on_signal)
        signal.signal(signal.SIGINT, _on_signal)
    except (AttributeError, ValueError):
        pass

    # Read stdin in 4 KB blocks (~1024 samples per read at 16 kHz). The
    # block size is a latency-vs-syscall-overhead trade; smaller blocks
    # give finer VAD timing but more read() calls. 4 KB is comfortable.
    BLOCK_BYTES = 4096
    pending = bytearray()
    try:
        stdin_buf = sys.stdin.buffer
        while not stop_flag[0]:
            block = stdin_buf.read(BLOCK_BYTES)
            if not block:
                break  # EOF
            pending.extend(block)
            n_floats = len(pending) // 4
            if n_floats == 0:
                continue
            # Slice off complete float32 samples; leave any partial-sample
            # tail in pending for the next read.
            usable = bytes(pending[: n_floats * 4])
            del pending[: n_floats * 4]
            pipeline.process(pipeline.parse_float32_bytes(usable))
        pipeline.finalize()
    except Exception as e:
        print("LIVE_ERROR:" + json.dumps({
            "stage": "consumer_loop", "error": str(e),
        }), flush=True)


@cli.command(name='transcribe-stream')
def transcribe_stream_cmd():
    """Run the VAD-gated live transcription consumer over raw stdin audio.

    The pipe contract: caller writes raw 16 kHz mono float32 little-endian
    samples to our stdin; we emit LIVE_READY / LIVE_SEG / LIVE_ERROR
    NDJSON lines to stdout. Used by main.js for the renderer-driven
    system-audio path, where the Web Audio mix is downsampled in the
    renderer and pushed to us through IPC.
    """
    _live_stdin_consumer()


@cli.command()
def test():
    """Quick system test - check components can initialize"""
    print("🧪 Quick system test...")
    
    try:
        # Test transcriber availability
        print("🗣️ Testing Whisper transcriber...")
        if not WhisperTranscriber:
            print("❌ Whisper transcriber not available")
            print("ERROR: Whisper not installed")
            return
            
        try:
            from src.config import get_config
            transcriber = WhisperTranscriber(model_size=get_config().get_whisper_model())
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


def _parse_meeting_markdown(md_path):
    """Parse a .md meeting file into the standard meeting dict."""
    content = md_path.read_text(encoding='utf-8')

    # Split frontmatter
    meta = {}
    body = content
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            for line in parts[1].strip().split('\n'):
                if ':' in line:
                    key, _, value = line.partition(':')
                    value = value.strip()
                    if value.startswith('"') and value.endswith('"'):
                        import re as _re
                        value = _re.sub(r'\\(.)', lambda m: m.group(1), value[1:-1])
                    elif value.startswith('['):
                        try:
                            value = json.loads(value)
                        except (ValueError, TypeError):
                            value = []
                    elif value == 'null':
                        value = None
                    elif value == 'true':
                        value = True
                    elif value == 'false':
                        value = False
                    else:
                        try:
                            value = int(value)
                        except (ValueError, TypeError):
                            pass
                    meta[key.strip()] = value
            body = parts[2].strip()

    # Parse markdown body into sections
    sections = {}
    current_section = None
    current_lines = []

    for line in body.split('\n'):
        if line.startswith('## '):
            if current_section:
                sections[current_section] = '\n'.join(current_lines).strip()
            current_section = line[3:].strip().lower()
            current_lines = []
        else:
            current_lines.append(line)
    if current_section:
        sections[current_section] = '\n'.join(current_lines).strip()

    # Extract structured fields
    participants = []
    if 'participants' in sections:
        participants = [p.strip() for p in sections['participants'].split(',') if p.strip()]

    key_points = []
    if 'key points' in sections:
        for line in sections['key points'].split('\n'):
            line = line.strip()
            if line.startswith('- '):
                key_points.append(line[2:])

    action_items = []
    if 'action items' in sections:
        for line in sections['action items'].split('\n'):
            line = line.strip()
            if line.startswith('- '):
                action_items.append(line[2:].replace('[ ] ', '').replace('[x] ', ''))

    discussion_areas = []
    if 'key topics' in sections:
        current_topic = None
        topic_lines = []
        for line in sections['key topics'].split('\n'):
            if line.startswith('### '):
                if current_topic:
                    discussion_areas.append({
                        'title': current_topic,
                        'analysis': '\n'.join(topic_lines).strip()
                    })
                current_topic = line[4:].strip()
                topic_lines = []
            else:
                topic_lines.append(line)
        if current_topic:
            discussion_areas.append({
                'title': current_topic,
                'analysis': '\n'.join(topic_lines).strip()
            })

    session_info = {
        'name': meta.get('title', md_path.stem),
        'processed_at': meta.get('date', ''),
        'duration_seconds': meta.get('duration_seconds'),
        'summary_file': str(md_path),
        'output_language': meta.get('language'),
    }
    # A meeting whose transcription crashed carries these markers so the UI
    # can render an honest failure state (and a future retry) rather than a
    # blank note. Only thread them through when present so normal meetings'
    # session_info shape is unchanged.
    if meta.get('transcription_failed'):
        session_info['transcription_failed'] = True
        session_info['reprocessable'] = bool(meta.get('reprocessable'))
        if meta.get('audio_file'):
            session_info['audio_file'] = meta.get('audio_file')
        if meta.get('error'):
            session_info['error'] = meta.get('error')
    # A live-sourced meeting (#207): the batch transcription was empty so this
    # transcript came from the live capture. Surface the flag so the UI can
    # tell the user no batch transcript exists.
    if meta.get('is_live_transcript'):
        session_info['is_live_transcript'] = True

    return {
        'session_info': session_info,
        'summary': sections.get('summary', ''),
        'participants': participants,
        'discussion_areas': discussion_areas,
        'key_points': key_points,
        'action_items': action_items,
        'transcript': sections.get('transcript', ''),
        'is_diarised': meta.get('is_diarised', False),
        'diarised_text': sections.get('transcript', '') if meta.get('is_diarised') else None,
        'user_notes': sections.get('user notes'),
        'folders': meta.get('folders', []),
    }


@cli.command()
def list_meetings():
    """List all processed meetings - optimized for fast loading"""
    from src.config import get_data_dirs, get_config
    dirs = get_data_dirs()
    output_dir = dirs["output"]

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect summary files from current output dir (JSON preferred over MD)
    seen_files = set()
    seen_stems = set()
    summaries = []
    # JSON first — if both .json and .md exist, JSON wins (it has structured data)
    for pattern in ("*_summary.json", "*_summary.md"):
        for f in output_dir.glob(pattern):
            stem = f.stem.replace('_summary', '')
            if stem not in seen_stems:
                summaries.append(f)
                seen_files.add(f.resolve())
                seen_stems.add(stem)

    # Also scan the default location if a custom path is set,
    # so meetings stored before the path change remain visible
    custom = get_config().get_storage_path()
    if custom:
        from src.config import is_bundled, get_user_data_dir
        if is_bundled():
            default_output = get_user_data_dir() / "output"
        else:
            default_output = Path(__file__).parent / "output"
        if default_output.exists():
            for pattern in ("*_summary.json", "*_summary.md"):
                for f in default_output.glob(pattern):
                    stem = f.stem.replace('_summary', '')
                    if f.resolve() not in seen_files and stem not in seen_stems:
                        summaries.append(f)
                        seen_files.add(f.resolve())
                        seen_stems.add(stem)

    meetings = []

    # Single-pass: read each file once, extract sort key and data together
    for summary_file in summaries:
        try:
            if summary_file.suffix == '.md':
                essential_meeting = _parse_meeting_markdown(summary_file)
                sort_key = essential_meeting.get('session_info', {}).get('processed_at', '')
            else:
                with open(summary_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    sort_key = data.get('session_info', {}).get('processed_at', '')
                    essential_meeting = {
                        "session_info": data.get("session_info", {}),
                        "summary": data.get("summary", ""),
                        "participants": data.get("participants", []),
                        "discussion_areas": data.get("discussion_areas", []),
                        "key_points": data.get("key_points", []),
                        "action_items": data.get("action_items", []),
                        "transcript": data.get("transcript", ""),
                        "is_diarised": data.get("is_diarised", False),
                        "diarised_text": data.get("diarised_text"),
                        "folders": data.get("folders", [])
                    }
            meetings.append((sort_key, essential_meeting))
        except Exception as e:
            logger.warning(f"Failed to load {summary_file}: {e}")
            continue

    meetings.sort(key=lambda x: x[0], reverse=True)
    meetings = [m for _, m in meetings]
    
    # Output as compact JSON for Electron (no indentation for speed)
    print(json.dumps(meetings, separators=(',', ':')))


@cli.command()
@click.argument('summary_file', required=True)
@click.option('--regenerate-title', is_flag=True, default=False, help='Also regenerate the meeting title')
def reprocess(summary_file, regenerate_title):
    """Reprocess a failed summary by re-running Ollama analysis on existing transcript"""
    import json
    from pathlib import Path

    import base64

    recorder = MeetingPipeline()
    summary_path = Path(summary_file)

    if not summary_path.exists():
        print(f"ERROR: Summary file not found: {summary_file}")
        sys.exit(1)

    try:
        # Load existing summary file (JSON or MD)
        if summary_path.suffix == '.md':
            existing_data = _parse_meeting_markdown(summary_path)
        else:
            with open(summary_path, 'r') as f:
                existing_data = json.load(f)

        # Get transcript from the data
        transcript = existing_data.get('transcript', '')
        if not transcript:
            print("ERROR: No transcript found in summary file")
            sys.exit(1)

        session_name = existing_data.get('session_info', {}).get('name', 'Reprocessed')
        duration_minutes = existing_data.get('session_info', {}).get('duration_minutes', 10)
        if duration_minutes is None:
            ds = existing_data.get('session_info', {}).get('duration_seconds')
            duration_minutes = int(ds / 60) if ds else 10

        # Load user notes from the meeting data
        notes_text = existing_data.get('user_notes')

        print(f"Reprocessing summary for: {session_name}")
        print(f"Transcript length: {len(transcript)} characters")
        if notes_text:
            print(f"User notes: {len(notes_text)} characters")

        # Resolve output language
        existing_session_info = existing_data.get("session_info", {})
        output_language = existing_session_info.get("output_language")
        if not output_language:
            configured_language = existing_session_info.get("configured_language")
            if not configured_language:
                from src.config import get_config
                configured_language = get_config().get_language()
            output_language = recorder._resolve_output_language(
                configured_language,
                existing_session_info.get("detected_language")
            )

        # Use streaming summarization (same as new recordings)
        if recorder.summarizer is None:
            from src.summarizer import OllamaSummarizer
            recorder.summarizer = OllamaSummarizer()

        print("Generating summary...", flush=True)
        streamed_chunks = []
        # Same watchdog-liveness cover as process_streaming: model load +
        # prompt eval is silent until the first streamed token.
        summary_heartbeat = _start_summary_heartbeat()
        try:
            for chunk in recorder.summarizer.summarize_transcript_streaming(
                transcript, duration_minutes, output_language, notes_text
            ):
                summary_heartbeat.set()
                encoded = base64.b64encode(chunk.encode('utf-8')).decode('ascii')
                sys.stdout.write(f"CHUNK:{encoded}\n")
                sys.stdout.flush()
                streamed_chunks.append(chunk)
        finally:
            summary_heartbeat.set()
        streamed_md = ''.join(streamed_chunks)

        print("STREAM_COMPLETE", flush=True)

        # Regenerate title if requested
        if regenerate_title:
            try:
                generated_title = recorder.summarizer.generate_title(
                    streamed_md, transcript, language=output_language
                )
                if generated_title:
                    session_name = generated_title
                    existing_data["session_info"]["name"] = generated_title
                    print(f"TITLE:{session_name}", flush=True)
                    print(f"Auto-generated title: {session_name}")
            except Exception as e:
                print(f"Title regeneration skipped: {e}")

        # Add reprocess timestamp
        existing_data["session_info"]["reprocessed_at"] = datetime.now().isoformat()

        # Save updated summary
        if summary_path.suffix == '.md':
            session_name = existing_data.get('session_info', {}).get('name', 'Reprocessed')
            md_lines = ['---']
            md_meta = {
                'title': session_name,
                'date': existing_data.get('session_info', {}).get('processed_at', datetime.now().isoformat()),
                'duration_seconds': existing_data.get('session_info', {}).get('duration_seconds'),
                'language': output_language,
                'is_diarised': existing_data.get('is_diarised', False),
            }
            for k, v in md_meta.items():
                if v is None:
                    md_lines.append(f'{k}: null')
                elif isinstance(v, bool):
                    md_lines.append(f'{k}: {"true" if v else "false"}')
                elif isinstance(v, int):
                    md_lines.append(f'{k}: {v}')
                else:
                    escaped = str(v).replace('\\', '\\\\').replace('"', '\\"')
                    md_lines.append(f'{k}: "{escaped}"')
            md_lines.append('---')
            md_lines.append('')
            # Write the raw streamed markdown (preserves LLM formatting)
            md_lines.append(streamed_md)
            md_lines.append('')
            md_lines.append('## Transcript')
            md_lines.append('')
            md_lines.append(transcript)
            if notes_text:
                md_lines.append('')
                md_lines.append('## User Notes')
                md_lines.append('')
                md_lines.append(notes_text)
            summary_path.write_text('\n'.join(md_lines), encoding='utf-8')
        else:
            # JSON format: parse streamed markdown into structured fields
            parsed = recorder._parse_streamed_markdown(streamed_md)
            existing_data.update({
                "summary": parsed.get("summary", "") or "",
                "participants": parsed.get("participants", []) or [],
                "discussion_areas": parsed.get("discussion_areas", []) or [],
                "key_points": parsed.get("key_points", []) or [],
                "action_items": parsed.get("action_items", []) or [],
            })
            with open(summary_path, 'w') as f:
                json.dump(existing_data, f, indent=2)

        print(f"Summary reprocessed successfully: {summary_path}")

    except Exception as e:
        print(f"ERROR: Failed to reprocess summary: {e}")
        sys.exit(1)


@cli.command('regen-title')
@click.argument('summary_file', required=True)
def regen_title(summary_file):
    """Regenerate only the title for an existing meeting."""
    import json
    from pathlib import Path

    recorder = MeetingPipeline()
    summary_path = Path(summary_file)

    if not summary_path.exists():
        print(f"ERROR: Summary file not found: {summary_file}")
        sys.exit(1)

    try:
        if summary_path.suffix == '.md':
            existing_data = _parse_meeting_markdown(summary_path)
        else:
            with open(summary_path, 'r') as f:
                existing_data = json.load(f)

        transcript = existing_data.get('transcript', '')
        summary = existing_data.get('summary', '')
        session_info = existing_data.get('session_info', {})
        output_language = session_info.get('output_language') or session_info.get('configured_language') or 'en'

        if not transcript and not summary:
            print("ERROR: No transcript or summary found in file")
            sys.exit(1)

        if recorder.summarizer is None:
            from src.summarizer import OllamaSummarizer
            recorder.summarizer = OllamaSummarizer()

        generated_title = recorder.summarizer.generate_title(summary, transcript, language=output_language)
        if not generated_title:
            print("ERROR: Title generation returned empty result")
            sys.exit(1)

        # Update and save
        existing_data['session_info']['name'] = generated_title
        if summary_path.suffix == '.md':
            # Rewrite the title in the YAML front matter only
            text = summary_path.read_text(encoding='utf-8')
            import re
            escaped = generated_title.replace('\\', '\\\\').replace('"', '\\"')
            text = re.sub(r'^title:.*$', f'title: "{escaped}"', text, flags=re.MULTILINE)
            summary_path.write_text(text, encoding='utf-8')
        else:
            with open(summary_path, 'w') as f:
                json.dump(existing_data, f, indent=2)

        print(f"TITLE:{generated_title}", flush=True)
        print(f"Title updated: {generated_title}")

    except Exception as e:
        print(f"ERROR: Failed to regenerate title: {e}")
        sys.exit(1)


@cli.command()
@click.argument('transcript_file')
@click.option('--question', '-q', required=True, help='Question to ask about the transcript')
def query(transcript_file, question):
    """Query a transcript with AI."""
    from pathlib import Path

    transcript_path = Path(transcript_file)
    language = None

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
                session_info = data.get("session_info", {})
                language = session_info.get("output_language")
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to read summary file: {e}"}))
            return
    elif transcript_file.endswith('.md'):
        # Handle markdown summary files — parse sections
        if not transcript_path.exists():
            print(json.dumps({"success": False, "error": f"File not found: {transcript_file}"}))
            return

        try:
            meeting_data = _parse_meeting_markdown(transcript_path)
            raw_transcript = meeting_data.get('transcript', '')
            # Build rich context: summary + key points + transcript
            parts = []
            if meeting_data.get('summary'):
                parts.append(f"SUMMARY:\n{meeting_data['summary']}")
            if meeting_data.get('discussion_areas'):
                topics = '\n'.join(f"- {d['title']}: {d['analysis']}" for d in meeting_data['discussion_areas'])
                parts.append(f"KEY TOPICS:\n{topics}")
            if meeting_data.get('key_points'):
                points = '\n'.join(f"- {p}" for p in meeting_data['key_points'])
                parts.append(f"KEY POINTS:\n{points}")
            if raw_transcript:
                parts.append(f"TRANSCRIPT:\n{raw_transcript}")
            transcript_text = '\n\n'.join(parts)
            session_info = meeting_data.get("session_info", {})
            language = session_info.get("output_language")
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

    # Use the user's configured model for all providers
    try:
        from src.config import get_config
        config = get_config()
        if not language:
            language = config.get_language()
        if language == "auto":
            language = "en"
        summarizer = OllamaSummarizer()
        answer = summarizer.query_transcript(transcript_text, question, language=language)

        if answer:
            print(json.dumps({"success": True, "answer": answer}))
        else:
            print(json.dumps({"success": False, "error": "Failed to get response from AI"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Query failed: {e}"}))


@cli.command(name='query-streaming')
@click.argument('transcript_file')
@click.option('--question', '-q', required=True, help='Question to ask about the transcript')
def query_streaming(transcript_file, question):
    """Query a transcript with streaming output. Emits CHUNK:base64 lines then STREAM_COMPLETE."""
    import sys
    import base64
    from pathlib import Path

    transcript_path = Path(transcript_file)
    language = None

    if transcript_file.endswith('.json'):
        if not transcript_path.exists():
            print(f"STREAM_ERROR:File not found: {transcript_file}", flush=True)
            return
        try:
            with open(transcript_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                transcript_text = data.get('transcript', '')
                if not transcript_text:
                    print("STREAM_ERROR:No transcript found in summary file", flush=True)
                    return
                session_info = data.get("session_info", {})
                language = session_info.get("output_language")
        except Exception as e:
            print(f"STREAM_ERROR:Failed to read file: {e}", flush=True)
            return
    elif transcript_file.endswith('.md'):
        if not transcript_path.exists():
            print(f"STREAM_ERROR:File not found: {transcript_file}", flush=True)
            return
        try:
            meeting_data = _parse_meeting_markdown(transcript_path)
            parts = []
            if meeting_data.get('summary'):
                parts.append(f"SUMMARY:\n{meeting_data['summary']}")
            if meeting_data.get('discussion_areas'):
                topics = '\n'.join(f"- {d['title']}: {d['analysis']}" for d in meeting_data['discussion_areas'])
                parts.append(f"KEY TOPICS:\n{topics}")
            if meeting_data.get('key_points'):
                points = '\n'.join(f"- {p}" for p in meeting_data['key_points'])
                parts.append(f"KEY POINTS:\n{points}")
            if meeting_data.get('transcript'):
                parts.append(f"TRANSCRIPT:\n{meeting_data['transcript']}")
            transcript_text = '\n\n'.join(parts)
            session_info = meeting_data.get("session_info", {})
            language = session_info.get("output_language")
        except Exception as e:
            print(f"STREAM_ERROR:Failed to read file: {e}", flush=True)
            return
    else:
        if not transcript_path.exists():
            print(f"STREAM_ERROR:File not found: {transcript_file}", flush=True)
            return
        try:
            transcript_text = transcript_path.read_text(encoding='utf-8')
        except Exception as e:
            print(f"STREAM_ERROR:Failed to read file: {e}", flush=True)
            return

    if not language:
        from src.config import get_config
        language = get_config().get_language()
    if language == "auto":
        language = "en"

    try:
        summarizer = OllamaSummarizer()
        for chunk in summarizer.query_transcript_streaming(transcript_text, question, language=language):
            encoded = base64.b64encode(chunk.encode('utf-8')).decode('ascii')
            sys.stdout.write(f"CHAT_CHUNK:{encoded}\n")
            sys.stdout.flush()
        print("CHAT_STREAM_COMPLETE", flush=True)
    except Exception as e:
        print(f"CHAT_STREAM_ERROR:{e}", flush=True)


def _chat_corpus_char_budget(ai_provider: str, model: str) -> int:
    """Char budget for the cross-note chat corpus, sized to the active model.

    Cloud/adapter models have large windows (Anthropic 200k, recent OpenAI
    128k+ tokens), so we use a generous fixed budget. Local/remote Ollama
    windows are smaller, so we derive the budget from the model's num_ctx (the
    same window the summariser requests) — a smaller local model then answers
    over fewer, most-recent notes instead of overflowing. ~3.5 chars/token;
    reserve ~45% of the window for the question, prompt scaffold and reply.
    Pure function so it's unit-testable without notes or a model.
    """
    if ai_provider in ("local", "remote"):
        from src.summarizer import resolve_num_ctx
        return int(resolve_num_ctx(model) * 3.5 * 0.55)
    return 400_000


@cli.command(name='chat-global-streaming')
@click.option('--question', '-q', required=True, help='Question to ask across notes')
@click.option('--folder', '-f', default=None, help='Folder ID to scope the corpus to (default: all notes)')
def chat_global_streaming(question, folder):
    """Cross-note chat: gather meeting title + summary + key points, feed as
    context to the configured LLM, stream the answer. Optionally scope to a
    single folder; default queries every note.

    Works with every provider — cloud / org adapter / local / remote Ollama.
    The assembled corpus is capped to the active model's context window
    (model-aware budget below), so a local model with a smaller window simply
    answers over fewer (most-recent) notes rather than overflowing. We don't
    have retrieval (RAG) yet, so older notes beyond the budget are omitted."""
    import sys
    import base64
    from pathlib import Path
    from src.config import get_config, get_data_dirs

    config = get_config()
    dirs = get_data_dirs()
    output_dir = dirs["output"]

    # Collect every summary file, preferring .md (the new format) but reading
    # legacy .json too so users with old recordings aren't excluded.
    summaries: list[tuple[Path, dict]] = []
    seen = set()
    for f in sorted(output_dir.glob("*_summary.md")):
        try:
            data = _parse_meeting_markdown(f)
            summaries.append((f, data))
            seen.add(f.stem.replace('_summary', ''))
        except Exception:
            continue
    for f in sorted(output_dir.glob("*_summary.json")):
        if f.stem.replace('_summary', '') in seen:
            continue
        try:
            with open(f, 'r', encoding='utf-8') as fh:
                summaries.append((f, json.load(fh)))
        except Exception:
            continue

    # Folder scoping. Each meeting record carries a 'folders' array of IDs;
    # filter to only those that include the requested ID. Empty folder ID
    # or 'all' explicitly means no filter.
    if folder and folder != 'all':
        summaries = [
            (path, data) for (path, data) in summaries
            if isinstance(data.get('folders'), list) and folder in data['folders']
        ]

    if not summaries:
        if folder and folder != 'all':
            print("CHAT_STREAM_ERROR:No notes in this folder yet. Pick another or remove the filter.", flush=True)
        else:
            print("CHAT_STREAM_ERROR:No notes found yet. Record a meeting first.", flush=True)
        return

    # Most-recent first so the model weights newer context higher when token
    # budget is tight. Each block is kept compact (title + summary + key
    # points + action items) — full transcripts would blow even a 200k window.
    def sort_key(item):
        _, data = item
        return data.get("session_info", {}).get("processed_at") or ""

    summaries.sort(key=sort_key, reverse=True)

    # Cap the assembled corpus so a user with hundreds of meetings can't blow
    # past the active model's context window (see _chat_corpus_char_budget).
    CORPUS_CHAR_BUDGET = _chat_corpus_char_budget(
        config.get_ai_provider(), config.get_model()
    )
    blocks = []
    used_chars = 0
    truncated = 0
    for _, data in summaries:
        info = data.get("session_info", {}) or {}
        name = info.get("name") or "Untitled"
        date = (info.get("processed_at") or "")[:10]
        summary = (data.get("summary") or "").strip()
        key_points = data.get("key_points") or []
        action_items = data.get("action_items") or []
        block = [f"## {name}" + (f" — {date}" if date else "")]
        if summary:
            block.append(summary)
        if key_points:
            block.append("Key points:\n" + "\n".join(f"- {p}" for p in key_points))
        if action_items:
            block.append("Action items:\n" + "\n".join(f"- {a}" for a in action_items))
        block_text = "\n".join(block)
        # +5 accounts for the "\n\n---\n\n" separator added later.
        if used_chars + len(block_text) + 5 > CORPUS_CHAR_BUDGET:
            # If the very first block is already larger than the budget,
            # truncate it so we still send something representative rather
            # than blasting the model with an oversized prompt.
            if not blocks:
                budget_left = max(0, CORPUS_CHAR_BUDGET - used_chars - 80)
                if budget_left > 0:
                    truncated_block = block_text[:budget_left].rstrip() + "\n…(truncated)"
                    blocks.append(truncated_block)
                    used_chars += len(truncated_block) + 5
            truncated = len(summaries) - len(blocks)
            break
        blocks.append(block_text)
        used_chars += len(block_text) + 5

    corpus = "\n\n---\n\n".join(blocks)
    if truncated:
        corpus += (
            f"\n\n---\n\n_Note: {truncated} older note(s) omitted to stay within"
            " the model's context window. Ask about a specific older meeting"
            " to pull it in directly._"
        )

    language = config.get_language()
    if language == "auto":
        language = "en"

    try:
        summarizer = OllamaSummarizer()
        for chunk in summarizer.query_transcript_streaming(corpus, question, language=language):
            encoded = base64.b64encode(chunk.encode('utf-8')).decode('ascii')
            sys.stdout.write(f"CHAT_CHUNK:{encoded}\n")
            sys.stdout.flush()
        print("CHAT_STREAM_COMPLETE", flush=True)
    except Exception as e:
        print(f"CHAT_STREAM_ERROR:{e}", flush=True)


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
        from src.config import is_bundled, get_user_data_dir
        if is_bundled():
            default_output = get_user_data_dir() / "output"
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
    recorder = MeetingPipeline()
    
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
        ffmpeg_exe_suffix = ".exe" if sys.platform == "win32" else ""
        ffmpeg_binary = f"ffmpeg{ffmpeg_exe_suffix}"

        # Check bundled ffmpeg (PyInstaller bundle)
        if getattr(sys, 'frozen', False):
            exe_dir = Path(sys.executable).parent
            for candidate in [
                exe_dir / ffmpeg_binary,                # bundle root (stenoai.spec places it at '.')
                exe_dir / '_internal' / ffmpeg_binary,  # _internal subdirectory
            ]:
                if candidate.exists():
                    possible_ffmpeg_paths.append(('bundled', str(candidate)))

        possible_ffmpeg_paths.append((None, 'ffmpeg'))  # PATH (Windows resolves via PATHEXT)
        if sys.platform != "win32":
            possible_ffmpeg_paths.extend([
                (None, '/opt/homebrew/bin/ffmpeg'),     # Homebrew Apple Silicon
                (None, '/usr/local/bin/ffmpeg'),        # Homebrew Intel
                (None, '/usr/bin/ffmpeg'),              # System
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
            install_hint = (
                "winget install Gyan.FFmpeg" if sys.platform == "win32"
                else "brew install ffmpeg"
            )
            checks.append(("❌ ffmpeg", f"not found - run: {install_hint}"))
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

    # Check if whisper model is downloaded. pywhispercpp uses platformdirs, so
    # the cache dir varies per OS — check the canonical location for each.
    whisper_candidates = [
        Path.home() / "Library" / "Application Support" / "pywhispercpp" / "models",
        Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "pywhispercpp" / "models",
        Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "pywhispercpp" / "models",
    ]
    whisper_models = []
    for whisper_model_path in whisper_candidates:
        if whisper_model_path.exists():
            whisper_models = list(whisper_model_path.glob("ggml-*.bin"))
            if whisper_models:
                break
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
    provider = config.get_ai_provider()
    current_model = config.get_model()

    if provider == "remote":
        remote_url = config.get_remote_ollama_url()
        if not remote_url:
            result = {
                "current_model": current_model,
                "supported_models": {},
                "provider": "remote",
                "error": "No remote Ollama URL configured"
            }
            print(json.dumps(result, indent=2))
            return

        try:
            import ollama as ollama_pkg
            client = ollama_pkg.Client(host=remote_url)
            response = client.list()
            raw_models = getattr(response, 'models', []) or []
            models = {}
            for m in raw_models:
                name = getattr(m, 'model', '')
                if not name:
                    continue
                # Extract human-readable size
                size_bytes = getattr(m, 'size', 0) or 0
                if size_bytes >= 1_000_000_000:
                    size_str = f"{size_bytes / 1_000_000_000:.1f}GB"
                elif size_bytes >= 1_000_000:
                    size_str = f"{size_bytes / 1_000_000:.0f}MB"
                else:
                    size_str = f"{size_bytes}B"

                # Extract details string
                details = getattr(m, 'details', None)
                detail_parts = []
                if details:
                    family = getattr(details, 'family', '') or ''
                    param_size = getattr(details, 'parameter_size', '') or ''
                    quant = getattr(details, 'quantization_level', '') or ''
                    if family:
                        detail_parts.append(family)
                    if param_size:
                        detail_parts.append(param_size)
                    if quant:
                        detail_parts.append(quant)

                models[name] = {
                    "size": size_str,
                    "description": " / ".join(detail_parts) if detail_parts else "",
                    "installed": True
                }

            result = {
                "current_model": current_model,
                "supported_models": models,
                "provider": "remote"
            }
        except Exception as e:
            error_msg = "Could not connect to remote Ollama server"
            if "Connection refused" in str(e) or "ConnectError" in str(e):
                error_msg = "Remote Ollama server is not reachable"
            elif "timed out" in str(e).lower() or "Timeout" in str(e):
                error_msg = "Remote Ollama server timed out"
            result = {
                "current_model": current_model,
                "supported_models": {},
                "provider": "remote",
                "error": error_msg
            }
    else:
        models = config.list_supported_models()
        try:
            import ollama as ollama_pkg
            installed_names = {getattr(m, 'model', '') for m in (getattr(ollama_pkg.list(), 'models', []) or [])}
        except Exception:
            installed_names = set()
        for model_id, info in models.items():
            # Match exactly, or where Ollama appended extra detail after the tag
            # e.g. "deepseek-r1:14b" matches "deepseek-r1:14b-qwen-distill-q4_K_M"
            info['installed'] = any(
                name == model_id or name.startswith(model_id + '-')
                for name in installed_names
            )
        result = {
            "current_model": current_model,
            "supported_models": models,
            # The actual configured provider ('local', 'cloud', 'adapter').
            # This used to be hardcoded "local", which made debug logs claim
            # a local provider while summaries went through the org adapter.
            "provider": provider
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
        # Exit non-zero so callers (e.g. the setup-ollama-and-model reuse path in
        # main.js) can't read a config-write failure as success — the model was
        # NOT persisted as active. sys.exit (not bare exit) for the PyInstaller bundle.
        sys.exit(1)


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
def get_dock_icon():
    """Get the current hide-dock-icon preference"""
    from src.config import get_config

    config = get_config()
    enabled = config.get_hide_dock_icon()

    print(json.dumps({"hide_dock_icon": enabled}))


@cli.command()
def get_org_auto_backup():
    """Get whether org auto-backup is enabled."""
    from src.config import get_config

    config = get_config()
    print(json.dumps({"org_auto_backup_enabled": config.get_org_auto_backup_enabled()}))


@cli.command()
@click.argument('enabled', type=bool)
def set_org_auto_backup(enabled):
    """Set whether org auto-backup is enabled (True/False)."""
    from src.config import get_config

    config = get_config()
    success = config.set_org_auto_backup_enabled(enabled)
    if success:
        print(json.dumps({"success": True, "org_auto_backup_enabled": enabled}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save config"}))


@cli.command()
@click.argument('default', type=bool)
def seed_org_auto_backup(default):
    """Seed org auto-backup from the adapter's auto_share_default policy,
    only when the user has no stored preference yet (set-the-default-only)."""
    from src.config import get_config

    config = get_config()
    effective = config.seed_org_auto_backup_default(default)
    print(json.dumps({"success": True, "org_auto_backup_enabled": effective}))


@cli.command()
@click.argument('enabled', type=bool)
def set_dock_icon(enabled):
    """Set hide-dock-icon preference (True/False)"""
    from src.config import get_config

    config = get_config()
    success = config.set_hide_dock_icon(enabled)

    if success:
        print(f"SUCCESS: Hide dock icon {'enabled' if enabled else 'disabled'}")
        print(json.dumps({"success": True, "hide_dock_icon": enabled}))
    else:
        print(f"ERROR: Failed to save hide dock icon preference")
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
def get_auto_detect_meetings():
    """Get the current auto-detect meetings preference"""
    from src.config import get_config

    config = get_config()
    enabled = config.get_auto_detect_meetings_enabled()

    print(json.dumps({"auto_detect_meetings_enabled": enabled}))


@cli.command()
@click.argument('enabled', callback=lambda ctx, param, v: v.lower() == 'true')
def set_auto_detect_meetings(enabled):
    """Set auto-detect meetings preference (True/False)"""
    from src.config import get_config

    config = get_config()
    success = config.set_auto_detect_meetings_enabled(enabled)

    if success:
        print(json.dumps({"success": True, "auto_detect_meetings_enabled": enabled}))
    else:
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


@cli.command(name='get-user-name')
def get_user_name_cmd():
    """Get the user's first name (for in-app greetings)."""
    from src.config import get_config
    print(json.dumps({"user_name": get_config().get_user_name()}))


@cli.command(name='set-user-name')
@click.argument('name', default='')
def set_user_name_cmd(name):
    """Set the user's first name. Empty string clears it."""
    from src.config import get_config
    success = get_config().set_user_name(name)
    if success:
        print(json.dumps({"success": True, "user_name": name.strip()}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save user name"}))


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
@click.argument('icon')
def update_folder_icon(folder_id, icon):
    """Update a folder's icon"""
    from src.folders import get_folders_manager
    mgr = get_folders_manager()
    success = mgr.update_icon(folder_id, icon)
    print(json.dumps({"success": success}))


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
def get_ai_provider():
    """Get all AI provider configuration"""
    from src.config import get_config
    config = get_config()

    result = {
        "ai_provider": config.get_ai_provider(),
        "remote_ollama_url": config.get_remote_ollama_url(),
        "cloud_api_url": config.get_cloud_api_url(),
        "cloud_api_key_set": bool(config.get_cloud_api_key()),
        "cloud_provider": config.get_cloud_provider(),
        "cloud_model": config.get_cloud_model(),
        # The local/remote Ollama summarisation model, so the UI can show the
        # model that's actually answering under ai_provider=local/remote
        # (cloud/adapter use cloud_model / the org's server-side model).
        "model": config.get_model(),
        "bedrock_region": config.get_bedrock_region(),
        "bedrock_inference_profile": config.get_bedrock_inference_profile(),
        "bedrock_supported_models": list(config.SUPPORTED_BEDROCK_MODELS),
    }
    print(json.dumps(result))


@cli.command()
@click.argument('provider')
def set_ai_provider(provider):
    """Set the AI provider (local, remote, or cloud)"""
    from src.config import get_config
    config = get_config()

    if provider not in config.VALID_AI_PROVIDERS:
        print(json.dumps({
            "success": False,
            "error": f"Invalid provider: {provider}. Must be one of: {', '.join(config.VALID_AI_PROVIDERS)}"
        }))
        return

    success = config.set_ai_provider(provider)
    if success:
        print(json.dumps({"success": True, "ai_provider": provider}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save AI provider setting"}))


@cli.command()
@click.argument('url')
def set_remote_ollama_url(url):
    """Set the remote Ollama server URL"""
    from src.config import get_config
    config = get_config()
    success = config.set_remote_ollama_url(url)
    if success:
        print(json.dumps({"success": True, "remote_ollama_url": url}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save remote Ollama URL"}))


@cli.command()
@click.argument('url')
def set_cloud_api_url(url):
    """Set the cloud API URL"""
    from src.config import get_config
    config = get_config()
    success = config.set_cloud_api_url(url)
    if success:
        print(json.dumps({"success": True, "cloud_api_url": url}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save cloud API URL"}))


@cli.command()
@click.argument('provider')
def set_cloud_provider(provider):
    """Set the cloud provider type (openai or custom)"""
    from src.config import get_config
    config = get_config()

    if provider not in config.VALID_CLOUD_PROVIDERS:
        print(json.dumps({
            "success": False,
            "error": f"Invalid cloud provider: {provider}. Must be one of: {', '.join(config.VALID_CLOUD_PROVIDERS)}"
        }))
        return

    success = config.set_cloud_provider(provider)
    if success:
        print(json.dumps({"success": True, "cloud_provider": provider}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save cloud provider"}))


@cli.command()
@click.argument('model')
def set_cloud_model(model):
    """Set the cloud model name"""
    from src.config import get_config
    config = get_config()
    success = config.set_cloud_model(model)
    if success:
        print(json.dumps({"success": True, "cloud_model": model}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save cloud model"}))


@cli.command()
@click.argument('region')
def set_bedrock_region(region):
    """Set the AWS Bedrock region (e.g. us-east-1)"""
    from src.config import get_config
    config = get_config()
    success = config.set_bedrock_region(region)
    if success:
        print(json.dumps({"success": True, "bedrock_region": region}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save Bedrock region (empty?)"}))


@cli.command()
@click.argument('profile', required=False, default='')
def set_bedrock_inference_profile(profile):
    """Set the AWS Bedrock cross-region inference profile (empty clears)"""
    from src.config import get_config
    config = get_config()
    success = config.set_bedrock_inference_profile(profile)
    if success:
        print(json.dumps({"success": True, "bedrock_inference_profile": profile}))
    else:
        print(json.dumps({"success": False, "error": "Failed to save Bedrock inference profile"}))


@cli.command()
@click.argument('url')
def test_remote_ollama(url):
    """Test connection to a remote Ollama server"""
    try:
        import ollama as ollama_pkg
        client = ollama_pkg.Client(host=url)
        response = client.list()
        models = [getattr(m, 'model', '') for m in getattr(response, 'models', [])]
        print(json.dumps({"success": True, "models": models}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


# Model families OpenAI's /models endpoint mixes in alongside chat models —
# embeddings, speech, image and moderation. Excluded so the Settings model
# picker only offers models that actually answer chat completions (#198).
# NB: no "search" marker — the *-search-preview models are chat-completion
# models (web-search-grounded). "search" is a substring of "deep-research", but
# those are excluded by their own marker below, so the two don't interfere.
_OPENAI_NON_CHAT_MARKERS = (
    "embedding", "whisper", "tts", "audio", "realtime",
    "moderation", "dall-e", "image", "transcribe", "codex",
)

# Reasoning tiers OpenAI serves ONLY through the Responses API, never
# chat.completions. Steno talks to client.chat.completions.create, so offering
# one of these would 400 at request time — they must be dropped from the picker
# even though they pass the gpt-/o\d gate. ``deep-research`` is a substring match
# (covers o3-deep-research, o4-mini-deep-research and their dated snapshots); the
# ``-pro`` tier (gpt-5-pro, …-pro-YYYY-MM-DD) is matched as a ``-pro`` segment so
# dated snapshots drop too without snagging unrelated names.
_OPENAI_RESPONSES_ONLY_MARKERS = ("deep-research",)
_OPENAI_RESPONSES_ONLY_RE = re.compile(r"-pro(?:-|$)")


def _is_openai_chat_model(model_id: str) -> bool:
    """True for OpenAI chat/reasoning models (``gpt-*``, the ``o<n>`` reasoning
    series, ``chatgpt-*``), excluding the non-chat families above and the
    Responses-only reasoning tiers (``*-pro``, ``*-deep-research``). ``gpt-`` and
    ``o\\d`` are prefix/pattern matches so newer releases (gpt-4.1, o4, …) keep
    showing up without a code change. Applied to the openai provider only —
    custom OpenAI-compatible endpoints use their own naming, so their lists are
    left unfiltered."""
    mid = model_id.lower()
    if not (
        mid.startswith("gpt-")
        or mid.startswith("chatgpt-")
        or re.match(r"o\d", mid)
    ):
        return False
    if any(marker in mid for marker in _OPENAI_NON_CHAT_MARKERS):
        return False
    if any(marker in mid for marker in _OPENAI_RESPONSES_ONLY_MARKERS):
        return False
    if _OPENAI_RESPONSES_ONLY_RE.search(mid):
        return False
    return True


@cli.command()
def test_cloud_api():
    """Test connection to the cloud API"""
    from src.config import get_config
    config = get_config()

    cloud_api_key = config.get_cloud_api_key()
    cloud_provider = config.get_cloud_provider()
    cloud_api_url = config.get_cloud_api_url()

    if not cloud_api_key:
        print(json.dumps({"success": False, "error": "No API key configured"}))
        return

    try:
        if cloud_provider == "anthropic":
            from anthropic import Anthropic
            client = Anthropic(api_key=cloud_api_key)
            # Lightweight test: list models
            models_page = client.models.list(limit=10)
            model_ids = [m.id for m in models_page.data]
            print(json.dumps({"success": True, "models": model_ids}))
        elif cloud_provider == "bedrock":
            # Bedrock doesn't expose a cheap list endpoint via the bearer-token
            # API surface (ListFoundationModels needs SigV4). The Settings UI
            # uses the curated SUPPORTED_BEDROCK_MODELS list directly, so the
            # only thing left to verify is "does the key + region actually
            # answer Converse?". Send a 1-token ping to the configured model.
            import urllib.request
            import urllib.error
            from src.summarizer import bedrock_converse_url
            region = config.get_bedrock_region()
            profile = config.get_bedrock_inference_profile()
            model_id = config.get_cloud_model()
            target = profile or model_id
            url = bedrock_converse_url(region, target)
            body = json.dumps({
                "messages": [{"role": "user", "content": [{"text": "hi"}]}],
                "inferenceConfig": {"maxTokens": 1},
            }).encode("utf-8")
            headers = {
                "content-type": "application/json",
                "authorization": f"Bearer {cloud_api_key}",
            }
            try:
                req = urllib.request.Request(url, data=body, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=15) as resp:
                    resp.read()  # we only care about the status code
                # Surface the curated list as "models" so the UI's existing
                # dropdown wiring lights up after a successful test.
                print(json.dumps({
                    "success": True,
                    "models": list(config.SUPPORTED_BEDROCK_MODELS),
                }))
            except urllib.error.HTTPError as he:
                detail = ""
                try:
                    detail = he.read().decode("utf-8", errors="replace")[:300]
                except Exception:
                    pass
                print(json.dumps({
                    "success": False,
                    "error": f"Bedrock HTTP {he.code}: {detail or he.reason}",
                }))
        else:
            from openai import OpenAI
            base_url = cloud_api_url if cloud_provider == "custom" and cloud_api_url else None
            client = OpenAI(api_key=cloud_api_key, base_url=base_url)
            models = client.models.list()
            # Newest first so current chat models lead the Settings dropdown.
            # OpenAI returns ~50+ models in arbitrary order, mixing in
            # embeddings/audio/image/moderation; the old unfiltered [:10] slice
            # crowded those in and pushed newer chat models off the end (#198).
            # Keep only chat/reasoning models for the openai provider; custom
            # OpenAI-compatible endpoints keep every model (unknown naming).
            entries = sorted(
                models.data,
                key=lambda m: getattr(m, "created", 0) or 0,
                reverse=True,
            )
            if cloud_provider == "openai":
                entries = [m for m in entries if _is_openai_chat_model(m.id)]
            model_ids = [m.id for m in entries[:25]]
            print(json.dumps({"success": True, "models": model_ids}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


@cli.command()
def download_whisper_model():
    """Download the Whisper transcription model"""
    print("Downloading Whisper model...")

    try:
        from pywhispercpp.model import Model as WhisperCppModel

        # This will trigger the model download if not present
        print("Initializing Whisper model (will download if needed)...")
        from src.config import get_config
        model_size = get_config().get_whisper_model()
        model = WhisperCppModel(model_size)
        print("SUCCESS: Whisper model ready")

    except Exception as e:
        print(f"ERROR: Failed to download Whisper model: {e}")
        import sys
        sys.exit(1)


@cli.command()
@click.argument('model_name')
def check_model(model_name):
    """Check if a model is installed in Ollama (uses HTTP API)."""
    from src.config import get_config
    config = get_config()
    provider = config.get_ai_provider()

    if provider == "remote":
        remote_url = config.get_remote_ollama_url()
        if not remote_url:
            print(json.dumps({"installed": False, "model": model_name, "error": "No remote URL configured"}))
            return
        try:
            import ollama as ollama_pkg
            client = ollama_pkg.Client(host=remote_url)
            response = client.list()
            models = getattr(response, 'models', []) or []
            model_names = [getattr(m, 'model', '') for m in models]
            installed = model_name in model_names
            print(json.dumps({"installed": installed, "model": model_name}))
        except Exception as e:
            print(json.dumps({"installed": False, "model": model_name, "error": str(e)}))
    else:
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


def pick_installed_supported_model(installed_names, preferred, supported_order, deprecated=()):
    """Pick the best already-installed supported Ollama model id, or None (#123).

    Args:
        installed_names: model ids the connected Ollama reports via /api/tags.
        preferred: ids to try first, in order — the configured model, then the
            packaged default. Honours "prefer the configured default if present".
        supported_order: the supported registry keys, ascending by capability
            (config.SUPPORTED_MODELS order); the fall-through when no preferred
            id is installed.
        deprecated: supported ids flagged deprecated — chosen only as a last
            resort so a live model always wins over a retired one.

    Returns the id to reuse, or None when nothing supported is installed (the
    caller then pulls the default).
    """
    installed = set(installed_names)
    supported = set(supported_order)
    dep = set(deprecated)
    for cand in preferred:
        if cand and cand in supported and cand in installed:
            return cand
    for cand in supported_order:
        if cand in installed and cand not in dep:
            return cand
    for cand in supported_order:
        if cand in installed and cand in dep:
            return cand
    return None


@cli.command(name='resolve-setup-model')
def resolve_setup_model():
    """Report an already-installed supported model so first-run setup can skip a
    redundant download (#123).

    Prints {"installed": "<model-id>"} when the connected Ollama already has a
    supported model, else {"installed": null}. Never pulls — the caller decides
    whether to download. Uses the HTTP API (ollama package), not the binary.
    """
    from src.config import get_config, Config
    from src.ollama_manager import start_ollama_server

    result = {"installed": None}
    try:
        start_ollama_server()
        import ollama
        resp = ollama.list()
        installed = {
            getattr(m, 'model', '') or ''
            for m in (getattr(resp, 'models', None) or [])
        }
        installed.discard('')
        config = get_config()
        deprecated = [
            mid for mid, meta in Config.SUPPORTED_MODELS.items()
            if meta.get('deprecated')
        ]
        result["installed"] = pick_installed_supported_model(
            installed_names=installed,
            preferred=[config.get_model(), Config.DEFAULT_MODEL],
            supported_order=list(Config.SUPPORTED_MODELS.keys()),
            deprecated=deprecated,
        )
    except Exception as e:
        result["error"] = str(e)
    print(json.dumps(result))


@cli.command(name='check-adapter')
@click.argument('url')
def check_adapter_cmd(url: str):
    """Probe an adapter's /health over HTTPS using the bundle's stdlib SSL stack.

    Diagnostic for the customer-side trust-store issue where the
    PyInstaller bundle's compiled-in CA paths don't exist on the host.
    Prints OK on a successful TLS handshake or the underlying SSL/HTTP
    error so support can paste it into a ticket.
    """
    import urllib.request
    import urllib.error

    url = url.rstrip('/') + '/health'
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            body = resp.read().decode('utf-8', errors='replace')
        print(f"OK {resp.status} {url}")
        print(body)
    except urllib.error.URLError as e:
        print(f"FAIL {url}")
        print(f"  reason: {e.reason}")
        sys.exit(1)
    except Exception as e:
        print(f"FAIL {url}")
        print(f"  error: {e}")
        sys.exit(1)


@cli.command(name='spike-parakeet')
def spike_parakeet_cmd():
    """Run the Parakeet TDT v3 spike from inside the bundled binary.

    Equivalent to ``python scripts/spike_parakeet.py`` but reachable from the
    PyInstaller bundle — that's the run that matters for proving MLX +
    parakeet-mlx survive the hardened runtime + codesign.
    """
    try:
        # Adjust sys.path so the dev-mode invocation finds scripts/ without
        # the user having to set PYTHONPATH. In a PyInstaller bundle the
        # script lives at sys._MEIPASS/scripts/ (datas=('scripts','scripts')
        # would be required to ship it — but we just inline the spike here
        # so the bundle doesn't need extra data files).
        from scripts.spike_parakeet import main as spike_main
    except ImportError:
        # PyInstaller bundle: the scripts/ tree isn't copied in (datas don't
        # include it). Re-import the spike logic inline by exec'ing the file
        # if it's beside us, otherwise just import the modules directly and
        # run the equivalent loop here.
        import importlib
        try:
            mod = importlib.import_module('scripts.spike_parakeet')
            spike_main = mod.main
        except ImportError:
            click.echo(
                json.dumps({
                    "event": "error",
                    "stage": "import_spike",
                    "message": "scripts/spike_parakeet.py not bundled; "
                               "run the dev-mode invocation instead."
                }),
                err=True,
            )
            sys.exit(2)
    sys.exit(spike_main())


if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    cli()
