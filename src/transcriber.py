"""
Whisper transcription module.

Supports two backends:
1. whisper.cpp (via pywhispercpp) - Lightweight, fast, recommended
2. openai-whisper (PyTorch) - Original, heavier, fallback

whisper.cpp is preferred as it's 10x smaller and 2-4x faster.
"""

import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


# Resolve a usable ffmpeg binary. Electron-spawned subprocesses don't inherit
# the user's shell PATH (no /opt/homebrew/bin), so a bare `ffmpeg` string fails
# silently and breaks the stereo-channel split downstream. Look in PyInstaller
# bundle locations first, then PATH, then standard install paths. Cached on
# first successful resolve.
_FFMPEG_PATH_CACHE: Optional[str] = None


def _resolve_ffmpeg() -> Optional[str]:
    global _FFMPEG_PATH_CACHE
    if _FFMPEG_PATH_CACHE is not None:
        return _FFMPEG_PATH_CACHE
    candidates: list[str] = []
    if getattr(sys, 'frozen', False):
        exe_dir = Path(sys.executable).parent
        candidates.extend([
            str(exe_dir / 'ffmpeg'),
            str(exe_dir / '_internal' / 'ffmpeg'),
        ])
    candidates.extend([
        'ffmpeg',
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
    ])
    for cand in candidates:
        try:
            r = subprocess.run([cand, '-version'], capture_output=True, timeout=5)
            if r.returncode == 0:
                _FFMPEG_PATH_CACHE = cand
                logger.info(f"ffmpeg resolved at: {cand}")
                return cand
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    logger.warning("ffmpeg not found in any candidate location")
    return None


def _token_jaccard(a: str, b: str) -> float:
    """Jaccard similarity over normalised word tokens.

    Used to detect speaker-bleed: when mic and system channel transcripts
    contain nearly the same words (regardless of order or whitespace), it
    means both microphones heard the same audio. Threshold ~0.6 cleanly
    separates true bleed (>0.8 in practice) from a real two-party call
    (typically <0.2).
    """
    tokens_a = set(re.findall(r"\w+", a.lower()))
    tokens_b = set(re.findall(r"\w+", b.lower()))
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)

# Try whisper.cpp first (preferred - smaller, faster)
try:
    from pywhispercpp.model import Model as WhisperCppModel
    WHISPER_CPP_AVAILABLE = True
    logger.info("Using whisper.cpp backend (pywhispercpp)")
except ImportError:
    WhisperCppModel = None
    WHISPER_CPP_AVAILABLE = False

# Fall back to openai-whisper if whisper.cpp not available
try:
    import whisper as openai_whisper
    OPENAI_WHISPER_AVAILABLE = True
except ImportError:
    openai_whisper = None
    OPENAI_WHISPER_AVAILABLE = False

WHISPER_AVAILABLE = WHISPER_CPP_AVAILABLE or OPENAI_WHISPER_AVAILABLE


class WhisperTranscriber:
    """
    Whisper-based audio transcription.

    Automatically uses whisper.cpp if available (faster, smaller),
    falls back to openai-whisper (PyTorch) if not.
    """

    def __init__(self, model_size: str = "small"):
        """
        Initialize the Whisper transcriber.

        Args:
            model_size: Whisper model size (tiny, base, small, medium, large)
        """
        if not WHISPER_AVAILABLE:
            raise ImportError(
                "No Whisper backend available. Install pywhispercpp (recommended) "
                "or openai-whisper: pip install pywhispercpp"
            )

        self.model_size = model_size
        self.model = None
        self.backend = None
        self._ensure_ffmpeg_in_path()
        self._load_model()

    def _ensure_ffmpeg_in_path(self) -> None:
        """
        Ensure ffmpeg is in PATH for audio processing.
        Checks bundled ffmpeg first, then system locations.
        """
        import sys

        # Build list of possible ffmpeg locations
        possible_ffmpeg_paths = []

        # Check bundled ffmpeg first (PyInstaller bundle)
        if getattr(sys, 'frozen', False):
            # Running from PyInstaller bundle
            # stenoai.spec places ffmpeg at '.' (bundle root, next to executable)
            exe_dir = Path(sys.executable).parent
            root_ffmpeg = exe_dir / 'ffmpeg'
            if root_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(root_ffmpeg))
            # Also check _MEIPASS (_internal) in case layout changes
            if hasattr(sys, '_MEIPASS'):
                meipass_ffmpeg = Path(sys._MEIPASS) / 'ffmpeg'
                if meipass_ffmpeg.exists():
                    possible_ffmpeg_paths.append(str(meipass_ffmpeg))
            # Also check _internal subdirectory
            internal_ffmpeg = exe_dir / '_internal' / 'ffmpeg'
            if internal_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(internal_ffmpeg))
        else:
            # Development mode - check bin directory
            dev_ffmpeg = Path(__file__).parent.parent / 'bin' / 'ffmpeg'
            if dev_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(dev_ffmpeg))

        # Add system locations as fallback
        possible_ffmpeg_paths.extend([
            '/opt/homebrew/bin/ffmpeg',  # Homebrew on Apple Silicon
            '/usr/local/bin/ffmpeg',     # Homebrew on Intel
            '/usr/bin/ffmpeg',           # System installation
        ])

        # Check if ffmpeg is already in PATH
        try:
            subprocess.run(['ffmpeg', '-version'], capture_output=True, timeout=5, check=True)
            logger.info("ffmpeg found in PATH")
            return
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
            pass

        # Try each possible location
        ffmpeg_found_path = None
        for ffmpeg_path in possible_ffmpeg_paths:
            try:
                subprocess.run([ffmpeg_path, '-version'], capture_output=True, timeout=5, check=True)
                ffmpeg_found_path = ffmpeg_path
                logger.info(f"Found ffmpeg at: {ffmpeg_path}")
                break
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
                continue

        if ffmpeg_found_path:
            ffmpeg_dir = os.path.dirname(ffmpeg_found_path)
            current_path = os.environ.get('PATH', '')
            if ffmpeg_dir not in current_path:
                os.environ['PATH'] = f"{ffmpeg_dir}:{current_path}"
                logger.info(f"Added {ffmpeg_dir} to PATH")
        else:
            logger.warning("ffmpeg not found - transcription may fail")

    def _load_model(self) -> None:
        """Load the Whisper model using the best available backend."""
        try:
            if WHISPER_CPP_AVAILABLE:
                self._load_whisper_cpp()
            elif OPENAI_WHISPER_AVAILABLE:
                self._load_openai_whisper()
            else:
                raise ImportError("No Whisper backend available")
        except Exception as e:
            logger.error(f"Error loading Whisper model: {e}")
            raise

    def _load_whisper_cpp(self) -> None:
        """Load model using whisper.cpp (pywhispercpp)."""
        logger.info(f"Loading whisper.cpp model: {self.model_size}")

        # Determine number of threads (use most cores, leave 2 for system)
        import multiprocessing
        n_threads = max(1, multiprocessing.cpu_count() - 2)

        # pywhispercpp auto-downloads the model if not present
        self.model = WhisperCppModel(self.model_size, n_threads=n_threads)
        self.backend = "whisper.cpp"
        logger.info(f"whisper.cpp model loaded successfully (threads: {n_threads})")

    def _load_openai_whisper(self) -> None:
        """Load model using openai-whisper (PyTorch)."""
        logger.info(f"Loading openai-whisper model: {self.model_size}")
        self.model = openai_whisper.load_model(self.model_size)
        self.backend = "openai-whisper"
        logger.info("openai-whisper model loaded successfully")

    def transcribe_audio(self, audio_filepath: Path, language: str = "en") -> Optional[dict]:
        """
        Transcribe audio file to text.

        Args:
            audio_filepath: Path to the audio file
            language: Language code (e.g., "en", "de", "auto")

        Returns:
            Transcribed text or None if transcription failed
        """
        if not audio_filepath.exists():
            logger.error(f"Audio file not found: {audio_filepath}")
            return None

        if self.model is None:
            logger.error("Whisper model not loaded")
            return None

        try:
            logger.info(f"Transcribing audio file: {audio_filepath}")

            # Check file size
            file_size = audio_filepath.stat().st_size
            logger.info(f"Audio file size: {file_size / 1024:.1f} KB")

            if file_size < 1000:  # Less than 1KB
                logger.warning("Audio file appears to be too small for transcription")
                return {
                    "text": "Audio file too small or empty",
                    "duration_seconds": None,
                    "detected_language": None,
                    "detected_language_probability": None,
                }

            # Use appropriate backend
            if self.backend == "whisper.cpp":
                result = self._transcribe_whisper_cpp(audio_filepath, language)
            else:
                result = self._transcribe_openai_whisper(audio_filepath, language)
                result["duration_seconds"] = None

            transcript = result.get("text")
            logger.info(f"Transcription completed. Length: {len(transcript) if transcript else 0} characters")

            if not transcript:
                logger.warning("Transcription returned empty text")
                result["text"] = "No speech detected in audio"

            result.setdefault("detected_language", None)
            result.setdefault("detected_language_probability", None)
            return result

        except Exception as e:
            logger.error(f"Error during transcription: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None

    def _convert_to_16khz(self, audio_filepath: Path) -> tuple:
        """Convert audio to 16kHz mono WAV for whisper.cpp compatibility.

        Returns:
            (converted_path, duration_seconds) where duration_seconds is the
            audio length read from the converted WAV header, or None if it
            could not be determined.
        """
        import tempfile
        import wave

        # Create temp file for converted audio
        temp_dir = tempfile.gettempdir()
        converted_path = Path(temp_dir) / f"stenoai_16khz_{audio_filepath.stem}.wav"

        try:
            # Use ffmpeg to convert to 16kHz mono WAV
            result = subprocess.run(
                [
                    'ffmpeg', '-y',  # Overwrite output
                    '-i', str(audio_filepath),
                    '-ar', '16000',  # 16kHz sample rate
                    '-ac', '1',      # Mono
                    '-c:a', 'pcm_s16le',  # 16-bit PCM
                    str(converted_path)
                ],
                capture_output=True,
                timeout=60
            )

            if result.returncode == 0 and converted_path.exists():
                logger.info(f"Converted audio to 16kHz: {converted_path}")

                # Read duration from converted WAV header
                duration_seconds = None
                try:
                    with wave.open(str(converted_path), 'rb') as wf:
                        duration_seconds = wf.getnframes() / wf.getframerate()
                        logger.info(f"Audio duration from converted WAV: {duration_seconds:.1f}s")
                except Exception as e:
                    logger.warning(f"Could not read duration from converted WAV: {e}")

                return converted_path, duration_seconds
            else:
                logger.error(f"ffmpeg conversion failed: {result.stderr.decode()}")
                return audio_filepath, None

        except Exception as e:
            logger.error(f"Audio conversion error: {e}")
            return audio_filepath, None

    def _transcribe_whisper_cpp(self, audio_filepath: Path, language: str = "en") -> dict:
        """Transcribe using whisper.cpp backend.

        Returns:
            dict with text/duration and optional detected language metadata
        """
        # whisper.cpp requires 16kHz audio - convert if needed
        converted_path, duration_seconds = self._convert_to_16khz(audio_filepath)
        cleanup_converted = converted_path != audio_filepath

        try:
            resolved_language = language
            detected_language = None
            detected_language_probability = None

            if language == "auto":
                try:
                    detection_result, _ = self.model.auto_detect_language(media=str(converted_path))
                    if detection_result and len(detection_result) >= 1:
                        # pywhispercpp returns (language_code, probability) on auto_detect_language.
                        detected_language = detection_result[0]
                        resolved_language = detected_language
                        if len(detection_result) >= 2:
                            detected_language_probability = float(detection_result[1])
                    logger.info(
                        f"Auto-detected language: {detected_language} "
                        f"(p={detected_language_probability})"
                    )
                except Exception as e:
                    logger.warning(f"Failed to auto-detect language; using whisper default detection: {e}")
                    # Setting to None omits the language kwarg, letting whisper.cpp
                    # use its own internal language detection as a fallback.
                    resolved_language = None

            # pywhispercpp returns a list of segments
            transcribe_kwargs = {"media": str(converted_path)}
            if resolved_language and resolved_language != "auto":
                transcribe_kwargs["language"] = resolved_language
            segments = self.model.transcribe(**transcribe_kwargs)

            if not segments:
                return {
                    "text": None,
                    "segments": [],
                    "duration_seconds": duration_seconds,
                    "detected_language": detected_language,
                    "detected_language_probability": detected_language_probability,
                }

            # Combine all segment texts and surface per-segment timing so
            # callers like transcribe_diarised can chronologically interleave
            # turns from multiple channels. pywhispercpp reports t0/t1 in
            # centiseconds (1/100s), so divide by 100 to get seconds.
            transcript = " ".join(segment.text.strip() for segment in segments)
            return {
                "text": transcript.strip(),
                "segments": [
                    {
                        "text": segment.text.strip(),
                        "start": segment.t0 / 100.0,
                        "end": segment.t1 / 100.0,
                    }
                    for segment in segments
                    if segment.text.strip()
                ],
                "duration_seconds": duration_seconds,
                "detected_language": detected_language,
                "detected_language_probability": detected_language_probability,
            }
        finally:
            # Clean up temp file
            if cleanup_converted and converted_path.exists():
                try:
                    converted_path.unlink()
                    logger.debug(f"Cleaned up converted audio: {converted_path}")
                except Exception:
                    pass

    def _transcribe_openai_whisper(self, audio_filepath: Path, language: str = "en") -> dict:
        """Transcribe using openai-whisper backend."""
        transcribe_kwargs = {
            "audio": str(audio_filepath),
            "verbose": False,
            "fp16": False,  # Disable FP16 to avoid warnings on CPU
        }
        if language and language != "auto":
            transcribe_kwargs["language"] = language
        result = self.model.transcribe(**transcribe_kwargs)

        if not result or "text" not in result:
            return {
                "text": None,
                "segments": [],
                "detected_language": None,
                "detected_language_probability": None,
            }

        # openai-whisper returns segments with start/end in seconds and
        # additional fields we don't need; normalise the shape so the
        # whisper.cpp and openai paths are interchangeable downstream.
        raw_segments = result.get("segments") or []
        return {
            "text": result["text"].strip(),
            "segments": [
                {
                    "text": (s.get("text") or "").strip(),
                    "start": float(s.get("start") or 0.0),
                    "end": float(s.get("end") or 0.0),
                }
                for s in raw_segments
                if (s.get("text") or "").strip()
            ],
            "detected_language": result.get("language"),
            "detected_language_probability": None,
        }

    def _split_stereo_to_channels(self, audio_filepath: Path) -> Tuple[Optional[Path], Optional[Path], Optional[float]]:
        """Detect if audio is stereo and split into separate channel files.

        Returns:
            (mic_path, system_path, duration_seconds) if stereo,
            (None, None, None) if mono or detection fails.
        """
        ffmpeg = _resolve_ffmpeg()
        if not ffmpeg:
            logger.warning("ffmpeg unavailable; cannot split stereo channels")
            return None, None, None

        # Detect channel count via `ffmpeg -i FILE -f null -`. ffmpeg writes
        # stream info to stderr; we parse "Audio: ..., stereo|mono|N channels".
        # We avoid ffprobe so the bundled ffmpeg alone is enough — ffprobe is
        # not shipped with our PyInstaller bundle.
        try:
            probe = subprocess.run(
                [ffmpeg, '-hide_banner', '-i', str(audio_filepath), '-f', 'null', '-'],
                capture_output=True, timeout=30, text=True
            )
            stderr = probe.stderr or ''
            channels = None
            m = re.search(r'Audio: [^\n]*?(stereo|mono|(\d+) channels)', stderr)
            if m:
                token = m.group(1)
                if token == 'stereo':
                    channels = 2
                elif token == 'mono':
                    channels = 1
                else:
                    channels = int(m.group(2))
            if channels is None:
                logger.warning(f"Could not parse channel count from ffmpeg output: {stderr[:300]}")
                return None, None, None

            duration = None
            dur_m = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', stderr)
            if dur_m:
                duration = int(dur_m.group(1)) * 3600 + int(dur_m.group(2)) * 60 + float(dur_m.group(3))

            if channels < 2:
                logger.info("Audio is mono, skipping stereo split")
                return None, None, None

            logger.info(f"Stereo audio detected ({channels} channels), splitting")
        except Exception as e:
            logger.warning(f"Channel detection failed: {e}")
            return None, None, None

        # Split channels into temp files
        temp_dir = tempfile.gettempdir()
        mic_path = Path(temp_dir) / f"stenoai_ch0_{audio_filepath.stem}.wav"
        system_path = Path(temp_dir) / f"stenoai_ch1_{audio_filepath.stem}.wav"

        try:
            for ch_idx, out_path in [(0, mic_path), (1, system_path)]:
                result = subprocess.run(
                    [ffmpeg, '-y', '-i', str(audio_filepath),
                     '-af', f'pan=mono|c0=c{ch_idx}',
                     '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
                     str(out_path)],
                    capture_output=True, timeout=120
                )
                if result.returncode != 0:
                    logger.error(f"Channel {ch_idx} extraction failed: {result.stderr.decode()}")
                    return None, None, None

            # If ffprobe couldn't get duration from the container (e.g. WebM),
            # calculate it from the split WAV file
            if duration is None:
                try:
                    import wave
                    with wave.open(str(mic_path), 'rb') as wf:
                        duration = wf.getnframes() / wf.getframerate()
                        logger.info(f"Duration from split WAV: {duration:.1f}s")
                except Exception as e:
                    logger.warning(f"Could not get duration from WAV: {e}")

            logger.info("Stereo channels split successfully")
            return mic_path, system_path, duration
        except Exception as e:
            logger.error(f"Channel splitting error: {e}")
            return None, None, None

    def _check_rms_energy(self, audio_path: Path, threshold: float = 0.0003) -> bool:
        """Check if an audio file has speech-level energy in any 1-second window.

        Uses sliding 1-second windows sampled across the entire file rather
        than only the first 5 seconds. System audio captured via CoreAudio
        Tap may not start until the user plays a clip mid-recording, and a
        head-only check averages those leading-silence seconds and falsely
        declares the channel silent — disabling diarisation for the whole
        meeting.

        Threshold is intentionally low (-70 dB) so headphones-mode recordings,
        where the mic input is captured at a fraction of speakers-mode levels,
        still pass. Whisper handles low-amplitude speech fine; the gate's
        only job is to skip channels with effectively zero audio (≤ -inf
        digital silence from a stalled CoreAudio tap, etc.) so we don't burn
        time transcribing nothing or invite hallucinations on dead air.
        """
        try:
            import wave
            import struct
            import math

            with wave.open(str(audio_path), 'rb') as wf:
                n_frames = wf.getnframes()
                sr = wf.getframerate()
                if n_frames == 0:
                    return False
                window = sr  # 1 second
                # Sample at most ~60 windows so a 30-min file doesn't pull
                # the whole thing into memory; for shorter files step is 1s.
                step = max(window, n_frames // 60)
                max_rms = 0.0
                pos = 0
                while pos + window <= n_frames:
                    wf.setpos(pos)
                    raw = wf.readframes(window)
                    samples = struct.unpack(f'<{window}h', raw)
                    rms = math.sqrt(sum((s / 32768.0) ** 2 for s in samples) / len(samples))
                    if rms > max_rms:
                        max_rms = rms
                    if max_rms >= threshold:
                        logger.info(f"RMS energy for {audio_path.name}: max={max_rms:.6f} (threshold {threshold}, early exit)")
                        return True
                    pos += step
                logger.info(f"RMS energy for {audio_path.name}: max={max_rms:.6f} (threshold {threshold})")
                return max_rms >= threshold
        except Exception as e:
            logger.warning(f"RMS check failed for {audio_path}: {e}")
            # If we can't check, assume it has audio so we don't drop diarisation.
            return True

    def transcribe_diarised(self, audio_filepath: Path, language: str = "en") -> Optional[dict]:
        """Transcribe audio with stereo channel diarisation.

        If the audio is stereo (left=mic, right=system), each channel is
        transcribed separately and labelled as [You] and [Others].

        Falls back to normal transcription for mono audio.

        Args:
            audio_filepath: Path to the audio file
            language: Language code

        Returns:
            Dict with text, diarised_text, is_diarised, plus standard fields
        """
        # Try stereo split
        mic_path, system_path, duration = self._split_stereo_to_channels(audio_filepath)

        if mic_path is None:
            # Mono audio — use standard transcription
            result = self.transcribe_audio(audio_filepath, language)
            if result:
                result['is_diarised'] = False
                result['diarised_text'] = None
            return result

        try:
            mic_has_audio = self._check_rms_energy(mic_path)
            system_has_audio = self._check_rms_energy(system_path)

            mic_segments: list[dict] = []
            system_segments: list[dict] = []
            detected_language = None
            detected_language_probability = None

            if mic_has_audio:
                logger.info("Transcribing mic channel (You)...")
                mic_result = self.transcribe_audio(mic_path, language)
                if mic_result and mic_result.get("text"):
                    mic_segments = mic_result.get("segments") or []
                    # Propagate detected language from the first channel with speech
                    if not detected_language and mic_result.get("detected_language"):
                        detected_language = mic_result["detected_language"]
                        detected_language_probability = mic_result.get("detected_language_probability")
            else:
                logger.info("Mic channel is silent, skipping")

            if system_has_audio:
                logger.info("Transcribing system channel (Others)...")
                sys_result = self.transcribe_audio(system_path, language)
                if sys_result and sys_result.get("text"):
                    system_segments = sys_result.get("segments") or []
                    if not detected_language and sys_result.get("detected_language"):
                        detected_language = sys_result["detected_language"]
                        detected_language_probability = sys_result.get("detected_language_probability")
            else:
                logger.info("System channel is silent, skipping")

            # Speaker-bleed collapse. Without headphones, the mic captures
            # both the user AND the system audio echoing through speakers,
            # while the CoreAudio Tap captures the same system audio
            # cleanly. Both channels end up containing nearly identical
            # text and labelled bubbles would just repeat the same content
            # twice (once green, once grey). When the two transcripts
            # overlap above this Jaccard threshold, we drop the system
            # channel and present the recording as mic-only — honest UX,
            # matches what Granola does when no headphones are detected.
            if mic_segments and system_segments:
                mic_text = ' '.join(s.get('text', '') for s in mic_segments)
                sys_text = ' '.join(s.get('text', '') for s in system_segments)
                similarity = _token_jaccard(mic_text, sys_text)
                if similarity >= 0.6:
                    logger.info(
                        f"Channel bleed detected (Jaccard={similarity:.2f}); "
                        f"collapsing to mic-only"
                    )
                    system_segments = []

            # Chronologically interleave segments from both channels and
            # collapse runs of consecutive same-speaker segments into a
            # single labelled turn so the rendered transcript reads as a
            # natural back-and-forth (Granola-style) instead of two
            # block-concatenated monologues.
            tagged: list[tuple[float, str, str]] = []
            for s in mic_segments:
                text = (s.get("text") or "").strip()
                if text:
                    tagged.append((float(s.get("start") or 0.0), "You", text))
            for s in system_segments:
                text = (s.get("text") or "").strip()
                if text:
                    tagged.append((float(s.get("start") or 0.0), "Others", text))
            # Stable sort: equal-start segments (overlapping speech) keep
            # the order they were appended in (mic first, then system),
            # which keeps the user as the "first speaker" in tied cases.
            tagged.sort(key=lambda t: t[0])

            turns: list[tuple[str, list[str]]] = []
            for _start, speaker, text in tagged:
                if turns and turns[-1][0] == speaker:
                    turns[-1][1].append(text)
                else:
                    turns.append((speaker, [text]))

            plain_parts = [' '.join(parts) for _speaker, parts in turns]
            plain_text = "\n\n".join(plain_parts) if plain_parts else "No speech detected in audio"

            # Only emit a labelled diarised_text when we actually had speech
            # on BOTH channels. A single-speaker run shouldn't pretend to be
            # a multi-party transcript — and leaking a stray `[You]` prefix
            # into the saved transcript file (which the meeting list shows
            # as plain text when is_diarised=false) looks broken in the UI.
            is_diarised = bool(mic_segments) and bool(system_segments)
            if is_diarised:
                labelled_parts = [
                    f"[{speaker}] {' '.join(parts)}" for speaker, parts in turns
                ]
                diarised_text = "\n\n".join(labelled_parts)
            else:
                diarised_text = None

            return {
                "text": plain_text,
                "diarised_text": diarised_text,
                "is_diarised": is_diarised,
                "duration_seconds": duration,
                "detected_language": detected_language,
                "detected_language_probability": detected_language_probability,
            }
        finally:
            # Clean up temp channel files
            for p in (mic_path, system_path):
                if p and p.exists():
                    try:
                        p.unlink()
                    except Exception:
                        pass

    def transcribe_with_timestamps(self, audio_filepath: Path) -> Optional[dict]:
        """
        Transcribe audio file with timestamp information.

        Args:
            audio_filepath: Path to the audio file

        Returns:
            Dict with 'text' and 'segments' (list of {text, start, end})
        """
        if not audio_filepath.exists():
            logger.error(f"Audio file not found: {audio_filepath}")
            return None

        if self.model is None:
            logger.error("Whisper model not loaded")
            return None

        try:
            logger.info(f"Transcribing audio file with timestamps: {audio_filepath}")

            if self.backend == "whisper.cpp":
                segments = self.model.transcribe(str(audio_filepath))
                result = {
                    "text": " ".join(s.text.strip() for s in segments),
                    "segments": [
                        {"text": s.text.strip(), "start": s.t0 / 100.0, "end": s.t1 / 100.0}
                        for s in segments
                    ]
                }
            else:
                result = self.model.transcribe(str(audio_filepath), verbose=True)

            logger.info("Transcription with timestamps completed")
            return result

        except Exception as e:
            logger.error(f"Error during transcription: {e}")
            return None

    def change_model(self, model_size: str) -> bool:
        """
        Change the Whisper model size.

        Args:
            model_size: New model size

        Returns:
            True if model changed successfully
        """
        if model_size == self.model_size:
            logger.info(f"Already using model: {model_size}")
            return True

        try:
            self.model_size = model_size
            self._load_model()
            return True
        except Exception as e:
            logger.error(f"Failed to change model to {model_size}: {e}")
            return False

    def get_backend_info(self) -> dict:
        """Get information about the current backend."""
        return {
            "backend": self.backend,
            "model_size": self.model_size,
            "whisper_cpp_available": WHISPER_CPP_AVAILABLE,
            "openai_whisper_available": OPENAI_WHISPER_AVAILABLE,
        }
