"""
Whisper transcription module.

Supports two backends:
1. whisper.cpp (via pywhispercpp) - Lightweight, fast, recommended
2. openai-whisper (PyTorch) - Original, heavier, fallback

whisper.cpp is preferred as it's 10x smaller and 2-4x faster.
"""

import logging
import os
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

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

    def transcribe_audio(self, audio_filepath: Path) -> Optional[str]:
        """
        Transcribe audio file to text.

        Args:
            audio_filepath: Path to the audio file

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
                return "Audio file too small or empty"

            # Use appropriate backend
            if self.backend == "whisper.cpp":
                transcript = self._transcribe_whisper_cpp(audio_filepath)
            else:
                transcript = self._transcribe_openai_whisper(audio_filepath)

            logger.info(f"Transcription completed. Length: {len(transcript) if transcript else 0} characters")

            if not transcript:
                logger.warning("Transcription returned empty text")
                return "No speech detected in audio"

            return transcript

        except Exception as e:
            logger.error(f"Error during transcription: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None

    def _convert_to_16khz(self, audio_filepath: Path) -> Path:
        """Convert audio to 16kHz mono WAV for whisper.cpp compatibility."""
        import tempfile

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
                return converted_path
            else:
                logger.error(f"ffmpeg conversion failed: {result.stderr.decode()}")
                return audio_filepath

        except Exception as e:
            logger.error(f"Audio conversion error: {e}")
            return audio_filepath

    def _transcribe_whisper_cpp(self, audio_filepath: Path) -> Optional[str]:
        """Transcribe using whisper.cpp backend."""
        # whisper.cpp requires 16kHz audio - convert if needed
        converted_path = self._convert_to_16khz(audio_filepath)
        cleanup_converted = converted_path != audio_filepath

        try:
            # pywhispercpp returns a list of segments
            # Set language='en' for English transcription
            segments = self.model.transcribe(
                str(converted_path),
                language='en'
            )

            if not segments:
                return None

            # Combine all segment texts
            transcript = " ".join(segment.text.strip() for segment in segments)
            return transcript.strip()
        finally:
            # Clean up temp file
            if cleanup_converted and converted_path.exists():
                try:
                    converted_path.unlink()
                    logger.debug(f"Cleaned up converted audio: {converted_path}")
                except Exception:
                    pass

    def _transcribe_openai_whisper(self, audio_filepath: Path) -> Optional[str]:
        """Transcribe using openai-whisper backend."""
        result = self.model.transcribe(
            str(audio_filepath),
            verbose=False,
            fp16=False  # Disable FP16 to avoid warnings on CPU
        )

        if not result or "text" not in result:
            return None

        return result["text"].strip()

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
