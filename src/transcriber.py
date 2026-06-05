"""Batch transcription via Parakeet TDT v3 (MLX).

Replaces the previous pywhispercpp + openai-whisper backends. One engine
for live (in simple_recorder.py's VAD-gated consumer) and post-stop
(here), which means a recording's live transcript and final transcript
share the same model — no flavour mismatch between what the user saw
during recording and what summarisation sees afterwards.

Public surface kept compatible with the prior whisper-era pipeline so
the rest of the codebase doesn't churn:

* ``WhisperTranscriber`` (class name retained for callers / tests)
  - ``transcribe_audio(path, language)`` — single-channel batch
  - ``transcribe_diarised(path, language)`` — stereo channel split into
    [You] / [Others] turns
  - ``transcribe_with_timestamps(path)`` — segment-level timing

The stereo channel split, RMS-energy gating, and speaker-bleed collapse
all stay — they operate on transcript text + audio metadata, not on the
specific ASR engine.

Whisper-era hallucination filtering ("Thank you." / "Bye." on silence)
is gone: Parakeet doesn't produce those canned phrases on silent or
noisy input (verified empirically — pure silence, low noise, and
isolated clicks all return empty). Filtering by phrase against a real
ASR engine would now strictly remove real speech without preventing
anything; the model is the source of truth.
"""

import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


# --- Tunables ---------------------------------------------------------------
# Speaker-bleed detection: collapse to mic-only when the two-channel
# transcripts overlap above this Jaccard similarity. True bleed (no
# headphones, mic picks up speaker echo) is consistently >0.8 in practice;
# a real two-party call where the same audio doesn't reach both channels
# is typically <0.2. 0.6 leaves wide headroom on either side.
BLEED_JACCARD_THRESHOLD = 0.6

# RMS energy gate for "channel has speech". Intentionally low (-70 dB) so
# headphones-mode mic recordings — captured at much lower amplitude than
# speakers-mode — still pass. The model handles low-amplitude speech fine;
# this gate's only job is to skip channels with effectively zero audio.
MIN_RMS_THRESHOLD = 0.0003

# Cap how many 1-second windows we sample when scanning RMS so a 30-min
# recording doesn't pull all 30 min of int16 samples into Python lists.
RMS_MAX_WINDOWS = 60


# Resolve a usable ffmpeg binary. Electron-spawned subprocesses don't inherit
# the user's shell PATH (no /opt/homebrew/bin), so a bare `ffmpeg` string fails
# silently and breaks the stereo-channel split downstream. Look in PyInstaller
# bundle locations first, then PATH, then standard install paths. Cached on
# first successful resolve; lock guards the cache against concurrent first
# calls from multiple transcription threads.
_FFMPEG_PATH_CACHE: Optional[str] = None
_FFMPEG_PATH_LOCK = threading.Lock()


def _resolve_ffmpeg() -> Optional[str]:
    global _FFMPEG_PATH_CACHE
    if _FFMPEG_PATH_CACHE is not None:
        return _FFMPEG_PATH_CACHE
    with _FFMPEG_PATH_LOCK:
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


def _parse_channels_from_ffmpeg_stderr(stderr: str) -> Optional[int]:
    """Parse "Audio: ..., stereo|mono|N channels" from ffmpeg's `-i` output."""
    m = re.search(r'Audio: [^\n]*?(stereo|mono|(\d+) channels)', stderr)
    if not m:
        return None
    token = m.group(1)
    if token == 'stereo':
        return 2
    if token == 'mono':
        return 1
    return int(m.group(2))


def _parse_duration_from_ffmpeg_stderr(stderr: str) -> Optional[float]:
    """Parse "Duration: HH:MM:SS.mmm" from ffmpeg's `-i` output."""
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', stderr)
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


try:
    import numpy as _np
    _NUMPY_AVAILABLE = True
except ImportError:
    _np = None
    _NUMPY_AVAILABLE = False


def _rms_of_pcm16(raw: bytes, n_samples: int) -> float:
    """RMS amplitude of an int16 little-endian PCM buffer, normalised to [0, 1]."""
    import struct
    import math

    if n_samples == 0:
        return 0.0
    if _NUMPY_AVAILABLE:
        samples = _np.frombuffer(raw, dtype=_np.int16).astype(_np.float32)
        samples /= 32768.0
        return float(_np.sqrt(_np.mean(samples * samples)))
    unpacked = struct.unpack(f'<{n_samples}h', raw)
    return math.sqrt(sum((s / 32768.0) ** 2 for s in unpacked) / len(unpacked))


def _scan_max_rms(wf, window: int, step: int, early_exit_threshold: float) -> float:
    """Return the maximum RMS amplitude found across stepped 1-second windows."""
    n_frames = wf.getnframes()
    if n_frames == 0:
        return 0.0

    if n_frames < window:
        wf.setpos(0)
        raw = wf.readframes(n_frames)
        return _rms_of_pcm16(raw, n_frames)

    max_rms = 0.0
    pos = 0
    while pos + window <= n_frames:
        wf.setpos(pos)
        raw = wf.readframes(window)
        rms = _rms_of_pcm16(raw, window)
        if rms > max_rms:
            max_rms = rms
        if max_rms >= early_exit_threshold:
            return max_rms
        pos += step
    return max_rms


def _token_jaccard(a: str, b: str) -> float:
    """Jaccard similarity over normalised word tokens.

    Used to detect speaker-bleed: when mic and system channel transcripts
    contain nearly the same words (regardless of order or whitespace), it
    means both microphones heard the same audio. See BLEED_JACCARD_THRESHOLD.
    """
    tokens_a = set(re.findall(r"\w+", a.lower()))
    tokens_b = set(re.findall(r"\w+", b.lower()))
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


# Try Parakeet first (preferred — same engine as live).
try:
    from src.parakeet import transcribe_file as _parakeet_transcribe_file
    PARAKEET_AVAILABLE = True
except ImportError:
    _parakeet_transcribe_file = None
    PARAKEET_AVAILABLE = False
    logger.warning("parakeet backend not importable; batch transcription will fail")


# Top-level capability flag retained for callers that probed for whisper
# presence. Now it just means "do we have any working ASR backend at all".
WHISPER_AVAILABLE = PARAKEET_AVAILABLE


class WhisperTranscriber:
    """Batch transcription via Parakeet TDT v3.

    Class name retained from the whisper era so the rest of the codebase
    (CLI in simple_recorder.py, tests, etc.) doesn't churn. Internally
    it's just a thin shim over ``src.parakeet.transcribe_file`` plus the
    stereo-channel split + speaker-bleed collapse + RMS-energy gating
    logic that the old whisper path had.

    ``model_size`` is accepted for backwards compatibility with the old
    pywhispercpp interface but ignored — Parakeet TDT v3 is a single
    model (no size variants).
    """

    def __init__(self, model_size: str = "small"):
        if not PARAKEET_AVAILABLE:
            raise ImportError(
                "Parakeet (parakeet-mlx) backend is not available. "
                "Run `pip install parakeet-mlx` in the venv or rebuild the "
                "PyInstaller bundle."
            )
        # Kept on the instance so existing callers / logs that read
        # ``model_size`` and ``backend`` don't change.
        self.model_size = model_size
        self.model = None  # Parakeet manages its own model singleton
        self.backend = "parakeet-tdt-v3"
        self._ensure_ffmpeg_in_path()

    def _ensure_ffmpeg_in_path(self) -> None:
        """Make sure ffmpeg is reachable from $PATH for the stereo split.

        We don't need ffmpeg for the basic transcribe path anymore (Parakeet
        handles arbitrary formats via librosa), but the stereo-channel split
        in ``transcribe_diarised`` still calls ffmpeg with a `pan` filter to
        separate the mic and system channels.
        """
        possible_ffmpeg_paths = []

        if getattr(sys, 'frozen', False):
            exe_dir = Path(sys.executable).parent
            root_ffmpeg = exe_dir / 'ffmpeg'
            if root_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(root_ffmpeg))
            if hasattr(sys, '_MEIPASS'):
                meipass_ffmpeg = Path(sys._MEIPASS) / 'ffmpeg'
                if meipass_ffmpeg.exists():
                    possible_ffmpeg_paths.append(str(meipass_ffmpeg))
            internal_ffmpeg = exe_dir / '_internal' / 'ffmpeg'
            if internal_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(internal_ffmpeg))
        else:
            dev_ffmpeg = Path(__file__).parent.parent / 'bin' / 'ffmpeg'
            if dev_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(dev_ffmpeg))

        possible_ffmpeg_paths.extend([
            '/opt/homebrew/bin/ffmpeg',
            '/usr/local/bin/ffmpeg',
            '/usr/bin/ffmpeg',
        ])

        try:
            subprocess.run(['ffmpeg', '-version'], capture_output=True, timeout=5, check=True)
            logger.info("ffmpeg found in PATH")
            return
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
            pass

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
            logger.warning("ffmpeg not found - stereo diarisation will fall back to mono")

    # ------------------------------------------------------------------
    # Core: run Parakeet on a WAV path, return our normalised dict shape.
    # ------------------------------------------------------------------

    def _run_parakeet(self, audio_filepath: Path, language: str) -> dict:
        """Call into ``src.parakeet`` and normalise the result shape.

        No phrase-level filtering here — Parakeet returns empty on silence
        and noise (verified) so the previous whisper-era "Thank you." /
        "Bye." canned-phrase blocklist would strictly drop real speech now.
        """
        # Parakeet TDT v3 is multilingual + language-agnostic at inference
        # time, so "auto" and a concrete code both work — the model just
        # decodes. We surface the requested code in ``detected_language``
        # when it's concrete so the summariser still sees a hint.
        lang_for_parakeet = None if language == "auto" else language
        result = _parakeet_transcribe_file(audio_filepath, language=lang_for_parakeet)
        if not result:
            return {
                "text": None,
                "segments": [],
                "duration_seconds": None,
                "detected_language": None,
                "detected_language_probability": None,
            }

        segments = result.get("segments") or []
        raw_text = (result.get("text") or "").strip()
        return {
            "text": raw_text or None,
            "segments": segments,
            "duration_seconds": result.get("duration_seconds"),
            "detected_language": result.get("detected_language"),
            "detected_language_probability": result.get("detected_language_probability"),
        }

    # ------------------------------------------------------------------
    # Public batch API (back-compat with the whisper-era surface).
    # ------------------------------------------------------------------

    def transcribe_audio(self, audio_filepath: Path, language: str = "en") -> Optional[dict]:
        """Transcribe a single-channel (or mono-mixed) audio file.

        Returns ``None`` if the file is missing or too small to transcribe;
        otherwise a dict with ``text`` / ``segments`` / ``duration_seconds`` /
        ``detected_language`` / ``detected_language_probability``.
        """
        if not audio_filepath.exists():
            logger.error(f"Audio file not found: {audio_filepath}")
            return None

        try:
            logger.info(f"Transcribing audio file: {audio_filepath}")
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

            result = self._run_parakeet(audio_filepath, language)

            transcript = result.get("text")
            logger.info(f"Transcription completed. Length: {len(transcript) if transcript else 0} characters")

            if not transcript:
                logger.warning("Transcription returned empty text (all hallucinations or silent)")
                result["text"] = "No speech detected in audio"

            result.setdefault("detected_language", None)
            result.setdefault("detected_language_probability", None)
            return result

        except Exception as e:
            logger.error(f"Error during transcription: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None

    def _split_stereo_to_channels(self, audio_filepath: Path) -> Tuple[Optional[Path], Optional[Path], Optional[float]]:
        """Detect stereo and split into mono mic + system channel files.

        Returns ``(mic_path, system_path, duration_seconds)`` if stereo,
        ``(None, None, None)`` if mono or detection fails.
        """
        ffmpeg = _resolve_ffmpeg()
        if not ffmpeg:
            logger.warning("ffmpeg unavailable; cannot split stereo channels")
            return None, None, None

        # Detect channel count via ffmpeg. `-t 0` makes ffmpeg parse the
        # input header (where the channel layout lives) and exit immediately
        # without decoding any audio frames — without it, a 1-hour recording
        # would actually decode in full just to read metadata.
        try:
            probe = subprocess.run(
                [ffmpeg, '-hide_banner', '-t', '0', '-i', str(audio_filepath),
                 '-f', 'null', '-'],
                capture_output=True, timeout=15, text=True
            )
            stderr = probe.stderr or ''
            channels = _parse_channels_from_ffmpeg_stderr(stderr)
            if channels is None:
                logger.warning(f"Could not parse channel count from ffmpeg output: {stderr[:300]}")
                return None, None, None

            duration = _parse_duration_from_ffmpeg_stderr(stderr)

            if channels < 2:
                logger.info("Audio is mono, skipping stereo split")
                return None, None, None

            logger.info(f"Stereo audio detected ({channels} channels), splitting")
        except Exception as e:
            logger.warning(f"Channel detection failed: {e}")
            return None, None, None

        # Split channels into temp files (16kHz mono — Parakeet's expected
        # rate, so the model doesn't have to resample internally).
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

    def _check_rms_energy(self, audio_path: Path, threshold: float = MIN_RMS_THRESHOLD) -> bool:
        """Check if an audio file has speech-level energy in any 1-second window.

        Default threshold (MIN_RMS_THRESHOLD, -70 dB) is intentionally low so
        headphones-mode recordings, where the mic input is captured at a
        fraction of speakers-mode levels, still pass. The model handles
        low-amplitude speech fine; the gate's only job is to skip channels
        with effectively zero audio (digital silence from a stalled tap,
        etc.) so we don't waste time transcribing nothing or invite
        hallucinations on dead air.
        """
        try:
            import wave
            with wave.open(str(audio_path), 'rb') as wf:
                n_frames = wf.getnframes()
                sr = wf.getframerate()
                if n_frames == 0:
                    return False
                window = sr  # 1 second
                step = max(window, n_frames // RMS_MAX_WINDOWS)
                max_rms = _scan_max_rms(wf, window, step, threshold)

            label = "early exit" if max_rms >= threshold else "scanned"
            logger.info(
                f"RMS energy for {audio_path.name}: max={max_rms:.6f} "
                f"(threshold {threshold}, {label})"
            )
            return max_rms >= threshold
        except Exception as e:
            logger.warning(f"RMS check failed for {audio_path}: {e}")
            return True

    def transcribe_diarised(self, audio_filepath: Path, language: str = "en") -> Optional[dict]:
        """Transcribe with stereo channel diarisation.

        If the audio is stereo (left=mic, right=system), each channel is
        transcribed separately and labelled as [You] and [Others]. Falls
        back to normal transcription for mono audio.
        """
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
            # overlap above this Jaccard threshold, drop the system
            # channel and present as mic-only.
            if mic_segments and system_segments:
                mic_text = ' '.join(s.get('text', '') for s in mic_segments)
                sys_text = ' '.join(s.get('text', '') for s in system_segments)
                similarity = _token_jaccard(mic_text, sys_text)
                if similarity >= BLEED_JACCARD_THRESHOLD:
                    logger.info(
                        f"Channel bleed detected (Jaccard={similarity:.2f} ≥ "
                        f"{BLEED_JACCARD_THRESHOLD}); collapsing to mic-only"
                    )
                    system_segments = []

            # Chronologically interleave segments from both channels and
            # collapse runs of consecutive same-speaker segments into a
            # single labelled turn.
            tagged: list[tuple[float, str, str]] = []
            for s in mic_segments:
                text = (s.get("text") or "").strip()
                if text:
                    tagged.append((float(s.get("start") or 0.0), "You", text))
            for s in system_segments:
                text = (s.get("text") or "").strip()
                if text:
                    tagged.append((float(s.get("start") or 0.0), "Others", text))
            tagged.sort(key=lambda t: t[0])

            turns: list[tuple[str, list[str]]] = []
            for _start, speaker, text in tagged:
                if turns and turns[-1][0] == speaker:
                    turns[-1][1].append(text)
                else:
                    turns.append((speaker, [text]))

            plain_parts = [' '.join(parts) for _speaker, parts in turns]
            plain_text = "\n\n".join(plain_parts) if plain_parts else "No speech detected in audio"

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
        """Batch transcribe and return segment-level timing.

        Thin wrapper around ``_run_parakeet`` — Parakeet returns AlignedSentence
        timings directly, so we just normalise the shape.
        """
        if not audio_filepath.exists():
            logger.error(f"Audio file not found: {audio_filepath}")
            return None

        try:
            logger.info(f"Transcribing audio file with timestamps: {audio_filepath}")
            result = self._run_parakeet(audio_filepath, language="auto")
            return {
                "text": result.get("text") or "",
                "segments": result.get("segments") or [],
            }
        except Exception as e:
            logger.error(f"Error during transcription: {e}")
            return None

    def change_model(self, model_size: str) -> bool:
        """Back-compat shim. Parakeet TDT v3 has no size variants; we just
        accept the call so the existing CLI / settings code doesn't break,
        log a notice, and return True."""
        if model_size != self.model_size:
            logger.info(
                "change_model called with %r — ignored, Parakeet TDT v3 is "
                "the only available model.", model_size,
            )
        self.model_size = model_size
        return True

    def get_backend_info(self) -> dict:
        """Backend info surface kept compatible with the whisper-era callers."""
        return {
            "backend": self.backend,
            "model_size": self.model_size,
            "parakeet_available": PARAKEET_AVAILABLE,
            # Legacy keys retained so any existing UI that probes them
            # doesn't crash on KeyError; both are now always False.
            "whisper_cpp_available": False,
            "openai_whisper_available": False,
        }
