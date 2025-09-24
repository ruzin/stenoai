try:
    import whisper
    WHISPER_AVAILABLE = True
except ImportError:
    whisper = None
    WHISPER_AVAILABLE = False

import logging
import os
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class WhisperTranscriber:
    def __init__(self, model_size: str = "small"):
        if not WHISPER_AVAILABLE:
            raise ImportError("Whisper is not installed. Please install openai-whisper.")
        """
        Initialize the Whisper transcriber.
        
        Args:
            model_size: Whisper model size (tiny, base, small, medium, large)
        """
        self.model_size = model_size
        self.model = None
        self._ensure_ffmpeg_in_path()
        self._load_model()
    
    def _ensure_ffmpeg_in_path(self) -> None:
        """
        Ensure ffmpeg is in PATH for Whisper to use, handling DMG vs development environments.
        This uses the same logic as Ollama path resolution.
        """
        # Check if ffmpeg is already in PATH
        try:
            subprocess.run(['ffmpeg', '-version'], capture_output=True, timeout=5, check=True)
            logger.info("ffmpeg found in PATH")
            return
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
            pass
        
        # ffmpeg not in PATH, try common Homebrew locations
        possible_ffmpeg_paths = [
            '/opt/homebrew/bin/ffmpeg',  # Homebrew on Apple Silicon
            '/usr/local/bin/ffmpeg',     # Homebrew on Intel
            '/usr/bin/ffmpeg',           # System installation
        ]
        
        ffmpeg_found_path = None
        for path in possible_ffmpeg_paths:
            try:
                result = subprocess.run([path, '-version'], 
                                      capture_output=True, timeout=5, check=True)
                ffmpeg_found_path = path
                logger.info(f"Found ffmpeg at: {path}")
                break
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
                continue
        
        if ffmpeg_found_path:
            # Add the directory containing ffmpeg to PATH for this process
            ffmpeg_dir = os.path.dirname(ffmpeg_found_path)
            current_path = os.environ.get('PATH', '')
            if ffmpeg_dir not in current_path:
                os.environ['PATH'] = f"{ffmpeg_dir}:{current_path}"
                logger.info(f"Added {ffmpeg_dir} to PATH for Whisper ffmpeg access")
        else:
            logger.warning("ffmpeg not found in any common location - transcription may fail")
        
    def _load_model(self) -> None:
        """Load the Whisper model."""
        try:
            logger.info(f"Loading Whisper model: {self.model_size}")
            self.model = whisper.load_model(self.model_size)
            logger.info("Whisper model loaded successfully")
        except Exception as e:
            logger.error(f"Error loading Whisper model: {e}")
            raise
            
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
            
            # Add more verbose logging and error handling
            result = self.model.transcribe(
                str(audio_filepath), 
                verbose=False,  # Reduce whisper's own logging
                fp16=False      # Explicitly disable FP16 to avoid the warning
            )
            
            if not result or "text" not in result:
                logger.error("Transcription result is empty or invalid")
                return None
                
            transcript = result["text"].strip()
            logger.info(f"Transcription completed. Length: {len(transcript)} characters")
            
            if not transcript:
                logger.warning("Transcription returned empty text")
                return "No speech detected in audio"
                
            return transcript
            
        except Exception as e:
            logger.error(f"Error during transcription: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None
            
    def transcribe_with_timestamps(self, audio_filepath: Path) -> Optional[dict]:
        """
        Transcribe audio file with timestamp information.
        
        Args:
            audio_filepath: Path to the audio file
            
        Returns:
            Full whisper result dict with segments and timestamps
        """
        if not audio_filepath.exists():
            logger.error(f"Audio file not found: {audio_filepath}")
            return None
            
        if self.model is None:
            logger.error("Whisper model not loaded")
            return None
            
        try:
            logger.info(f"Transcribing audio file with timestamps: {audio_filepath}")
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