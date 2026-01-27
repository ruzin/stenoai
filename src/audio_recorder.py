try:
    import sounddevice as sd
    import numpy as np
    AUDIO_AVAILABLE = True
except ImportError:
    sd = None
    np = None
    AUDIO_AVAILABLE = False
import wave
import threading
import time
import atexit
from pathlib import Path
from typing import Optional
import logging
import json

logger = logging.getLogger(__name__)

# Global cleanup to prevent resource leaks
def cleanup_sounddevice():
    """Clean up sounddevice resources on exit"""
    try:
        if sd is not None:
            sd._terminate()
    except (AttributeError, RuntimeError, Exception) as e:
        # Log but don't raise - this is cleanup code
        logger.debug(f"Error during sounddevice cleanup: {e}")

atexit.register(cleanup_sounddevice)


class AudioRecorder:
    def __init__(self, sample_rate: int = 44100, channels: int = 1):
        if not AUDIO_AVAILABLE:
            raise ImportError("Audio dependencies not available. Please install sounddevice and numpy.")

        self.sample_rate = sample_rate
        self.channels = channels
        self.recording = False
        self.paused = False
        self.audio_data = []
        self.recording_thread: Optional[threading.Thread] = None

        # Thread safety lock for audio_data access
        self.audio_lock = threading.Lock()
        # Separate lock for pause state
        self.pause_lock = threading.Lock()

        # Simple state - no persistence for now
        self.stream = None
    
    def _load_state(self):
        """No persistence - start fresh each time."""
        self.recording = False
        self.audio_data = []
    
    def _save_state(self):
        """No persistence - do nothing."""
        pass
    
    def _clear_state(self):
        """No persistence - do nothing.""" 
        pass
        
    def start_recording(self) -> None:
        """Start recording audio from the microphone."""
        if self.recording:
            logger.warning("Recording is already in progress")
            return

        self.recording = True

        # Clear audio data with thread safety
        with self.audio_lock:
            self.audio_data = []

        logger.info("Creating recording thread...")
        self.recording_thread = threading.Thread(target=self._record)
        self.recording_thread.start()
        logger.info("Started recording thread")

        # Give thread a moment to start
        time.sleep(0.2)
        if not self.recording:
            logger.error("Recording failed to start - thread ended immediately")
        else:
            logger.info("Recording appears to be active")
        
    def stop_recording(self) -> None:
        """Stop recording audio."""
        if not self.recording:
            logger.warning("No recording in progress")
            return

        self.recording = False
        with self.pause_lock:
            self.paused = False
        if self.recording_thread:
            self.recording_thread.join(timeout=5.0)  # Add timeout to prevent hanging
            self.recording_thread = None  # Clean up reference

        logger.info("Stopped recording")

    def pause_recording(self) -> None:
        """Pause the current recording."""
        if not self.recording:
            logger.warning("No recording in progress to pause")
            return
        with self.pause_lock:
            if self.paused:
                logger.warning("Recording is already paused")
                return
            self.paused = True
        logger.info("Recording paused")

    def resume_recording(self) -> None:
        """Resume a paused recording."""
        if not self.recording:
            logger.warning("No recording in progress to resume")
            return
        with self.pause_lock:
            if not self.paused:
                logger.warning("Recording is not paused")
                return
            self.paused = False
        logger.info("Recording resumed")

    def is_paused(self) -> bool:
        """Check if recording is currently paused."""
        with self.pause_lock:
            return self.paused
        
    def _record(self) -> None:
        """Internal method to handle the recording process."""
        stream = None
        try:
            logger.info(f"Starting audio stream with sample_rate={self.sample_rate}, channels={self.channels}")
            stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                callback=self._audio_callback,
                blocksize=1024
            )
            self.stream = stream  # Store reference for cleanup
            stream.start()
            logger.info("Audio stream started successfully")
            
            while self.recording:
                time.sleep(0.1)
            logger.info("Recording loop ended")
            
        except Exception as e:
            logger.error(f"Error during recording: {e}")
            logger.error(f"Available audio devices: {sd.query_devices()}")
            self.recording = False
        finally:
            # Ensure stream is always properly closed
            if stream is not None:
                try:
                    stream.stop()
                    stream.close()
                    logger.info("Audio stream closed")
                except (AttributeError, RuntimeError, Exception) as e:
                    logger.warning(f"Error closing audio stream: {e}")
            self.stream = None
            
    def _audio_callback(self, indata, frames, time, status):
        """Callback function for audio input stream."""
        if status:
            logger.warning(f"Audio callback status: {status}")
        if self.recording and not self.is_paused():
            # Thread-safe append to audio_data (skip when paused)
            with self.audio_lock:
                self.audio_data.append(indata.copy())
            
    def save_recording(self, filepath: Path) -> bool:
        """Save the recorded audio to a WAV file."""
        # Thread-safe check and copy of audio data
        with self.audio_lock:
            if not self.audio_data:
                logger.error("No audio data to save")
                return False
            # Create a copy to release lock quickly
            audio_data_copy = self.audio_data.copy()

        try:
            # Convert list of numpy arrays to single array
            audio_array = np.concatenate(audio_data_copy, axis=0)

            # Ensure the directory exists
            filepath.parent.mkdir(parents=True, exist_ok=True)

            # Save as WAV file
            with wave.open(str(filepath), 'wb') as wav_file:
                wav_file.setnchannels(self.channels)
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(self.sample_rate)

                # Convert float32 to int16
                audio_int16 = (audio_array * 32767).astype(np.int16)
                wav_file.writeframes(audio_int16.tobytes())

            logger.info(f"Audio saved to {filepath}")

            # Clear audio data after successful save (thread-safe)
            with self.audio_lock:
                self.audio_data = []
            self.recording = False

            return True

        except Exception as e:
            logger.error(f"Error saving audio: {e}")
            return False
            
    def get_recording_duration(self) -> float:
        """Get the duration of the current recording in seconds."""
        # Thread-safe read of audio data
        with self.audio_lock:
            if not self.audio_data:
                return 0.0
            total_frames = sum(len(chunk) for chunk in self.audio_data)
        return total_frames / self.sample_rate
        
    def is_recording(self) -> bool:
        """Check if currently recording."""
        return self.recording
    
    def __del__(self):
        """Cleanup resources when instance is destroyed."""
        try:
            if self.recording:
                self.stop_recording()
            if self.stream:
                try:
                    self.stream.stop()
                    self.stream.close()
                except (AttributeError, RuntimeError, Exception) as e:
                    logger.debug(f"Error closing stream in __del__: {e}")
            if self.recording_thread and self.recording_thread.is_alive():
                self.recording_thread.join(timeout=1.0)
        except (AttributeError, RuntimeError, Exception) as e:
            logger.debug(f"Error in __del__: {e}")