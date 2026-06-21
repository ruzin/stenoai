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

import inspect
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Optional, Tuple

from src._heartbeat import _emit_heartbeat

logger = logging.getLogger(__name__)


# --- Tunables ---------------------------------------------------------------
# Speaker-bleed detection: collapse to mic-only when the two-channel
# transcripts overlap above this Jaccard similarity. True bleed (no
# headphones, mic picks up speaker echo) is consistently >0.8 in practice;
# a real two-party call where the same audio doesn't reach both channels
# is typically <0.2. 0.6 leaves wide headroom on either side.
BLEED_JACCARD_THRESHOLD = 0.6

# Per-segment bleed correction. Whole-transcript Jaccard catches
# catastrophic bleed but misses the case where ASR word-level differences
# ("weight" vs "wait", "let me" vs "let") drop the aggregate similarity
# into the 0.5-0.6 gap while individual adjacent segments still obviously
# echo. For each system_segment we find the nearest mic_segment by start
# time within ±PER_SEGMENT_BLEED_WINDOW_S and drop it if Jaccard exceeds
# the per-segment threshold. Threshold is lower than the whole-transcript
# one because per-segment text is shorter — random vocabulary overlap is
# rarer in a single sentence than across a whole call.
PER_SEGMENT_BLEED_JACCARD = 0.5
PER_SEGMENT_BLEED_WINDOW_S = 3.0
# Minimum-length gate. Short utterances ("Yes", "OK", "thanks", "好的")
# trivially Jaccard-match across channels when both speakers genuinely
# say the same brief thing — the dedup would then delete a real Others
# reply rather than a bleed echo. We gate on character count instead of
# token count because Python's ``\w+`` matches a whole CJK sentence as
# one continuous token (no inter-word spaces), so a token-based gate
# would silently disable bleed correction for Chinese / Japanese /
# Thai etc. ~15 chars is "substantial sentence" in any script: ~3-4
# English words, ~5-6 CJK ideographs. The whole-transcript backstop
# still catches catastrophic bleed where every line is short.
PER_SEGMENT_BLEED_MIN_CHARS = 15

# Audio pre-processing before batch transcription. A gentle high-pass strips
# low-frequency rumble (HVAC, desk thumps, handling noise) below the voice
# band, and single-pass loudness normalization lifts quiet stretches toward a
# consistent level — cleaner input improves ASR accuracy and reduces
# hallucination on near-silent passages. Single-pass (dynamic) loudnorm is
# deliberate: the two-pass variant would double decode time for marginal gain.
AUDIO_HIGHPASS_HZ = 90
AUDIO_LOUDNORM = "I=-16:TP=-1.5:LRA=11"

# ffmpeg wall-clock cap for the pre-processing pass. Decode+filter+encode of
# 16 kHz mono runs far faster than realtime (~30 s for a 3-hour meeting);
# 10 minutes is generous headroom before we give up and use the original.
AUDIO_PREPROCESS_TIMEOUT_S = 600

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
        import shutil
        exe_suffix = ".exe" if sys.platform == "win32" else ""
        binary_name = f"ffmpeg{exe_suffix}"
        candidates: list[str] = []
        if getattr(sys, 'frozen', False):
            exe_dir = Path(sys.executable).parent
            candidates.extend([
                str(exe_dir / binary_name),
                str(exe_dir / '_internal' / binary_name),
            ])
        # PATH (cross-platform; honours PATHEXT on Windows)
        on_path = shutil.which("ffmpeg")
        if on_path:
            candidates.append(on_path)
        if sys.platform != "win32":
            candidates.extend([
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


def _audio_filter_chain() -> str:
    """The ffmpeg ``-af`` chain applied to mono audio before transcription."""
    return f"highpass=f={AUDIO_HIGHPASS_HZ},loudnorm={AUDIO_LOUDNORM}"


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


def _segment_rms(wav_path, start_sec: float, end_sec: float) -> float:
    """Mean RMS amplitude of a [start_sec, end_sec] slice in a 16-bit
    PCM WAV. Used by per-segment bleed correction to identify which
    channel carries the direct signal vs the attenuated echo.

    Returns 0.0 on any error so the caller falls back to the
    conservative "drop system" default.
    """
    import wave
    try:
        with wave.open(str(wav_path), 'rb') as wf:
            sr = wf.getframerate()
            n_frames_total = wf.getnframes()
            start_frame = max(0, int(start_sec * sr))
            end_frame = min(n_frames_total, int(end_sec * sr))
            duration_frames = end_frame - start_frame
            if duration_frames <= 0:
                return 0.0
            wf.setpos(start_frame)
            raw = wf.readframes(duration_frames)
            return _rms_of_pcm16(raw, duration_frames)
    except Exception:
        return 0.0


def _drop_per_segment_bleed(
    mic_segments: list,
    system_segments: list,
    mic_path=None,
    system_path=None,
):
    """Drop the bleed-echo side of each Jaccard-matched (mic, system) pair.

    Returns the (possibly-trimmed) mic_segments and system_segments lists.

    The naive version of this function assumed system = bleed echo of
    mic, but in the headphone-less case it's typically the opposite:
    the mic picks up the speaker echo of Others' speech, so the *mic*
    segment is the bleed and system has the clean direct signal. We
    decide per-pair by comparing RMS over the segment's time range on
    each channel — the channel with HIGHER RMS holds the direct signal,
    the lower-RMS one is the attenuated echo and gets dropped.

    When ``mic_path`` / ``system_path`` aren't supplied (test paths or
    a defensive caller), we fall back to the historical behaviour of
    dropping the system side.
    """
    if not mic_segments or not system_segments:
        return mic_segments, system_segments

    drop_mic: set = set()
    drop_sys: set = set()
    can_compare_rms = mic_path is not None and system_path is not None

    for i_sys, sys_seg in enumerate(system_segments):
        sys_text = (sys_seg.get("text") or "").strip()
        if not sys_text or len(sys_text) < PER_SEGMENT_BLEED_MIN_CHARS:
            continue
        sys_start = float(sys_seg.get("start") or 0.0)
        sys_end = float(sys_seg.get("end") or sys_start)
        best_jaccard = 0.0
        best_mic_idx = -1
        for i_mic, mic_seg in enumerate(mic_segments):
            if i_mic in drop_mic:
                continue
            mic_start = float(mic_seg.get("start") or 0.0)
            if abs(sys_start - mic_start) > PER_SEGMENT_BLEED_WINDOW_S:
                continue
            mic_text = (mic_seg.get("text") or "").strip()
            if not mic_text or len(mic_text) < PER_SEGMENT_BLEED_MIN_CHARS:
                continue
            jac = _token_jaccard(sys_text, mic_text)
            if jac > best_jaccard:
                best_jaccard = jac
                best_mic_idx = i_mic
        if best_jaccard < PER_SEGMENT_BLEED_JACCARD or best_mic_idx < 0:
            continue

        # Bleed pair confirmed. Decide which side to drop.
        if can_compare_rms:
            mic_seg = mic_segments[best_mic_idx]
            mic_start = float(mic_seg.get("start") or 0.0)
            mic_end = float(mic_seg.get("end") or mic_start)
            mic_rms = _segment_rms(mic_path, mic_start, mic_end)
            sys_rms = _segment_rms(system_path, sys_start, sys_end)
            # Tie-break / RMS unreadable → fall back to historical behaviour
            # (drop system) so we never delete real user mic content on
            # ambiguous evidence. >= covers the genuine-tie case AND the
            # both-zero case (_segment_rms returns 0.0 on any read error),
            # both of which should keep mic and drop system.
            if mic_rms >= sys_rms:
                drop_sys.add(i_sys)
                logger.debug(
                    "Per-segment bleed: dropping system %r "
                    "(Jaccard=%.2f, mic_rms=%.4f >= sys_rms=%.4f)",
                    sys_text[:60], best_jaccard, mic_rms, sys_rms,
                )
            else:
                drop_mic.add(best_mic_idx)
                logger.debug(
                    "Per-segment bleed: dropping mic %r "
                    "(Jaccard=%.2f, sys_rms=%.4f >= mic_rms=%.4f)",
                    (mic_segments[best_mic_idx].get("text") or "")[:60],
                    best_jaccard, sys_rms, mic_rms,
                )
        else:
            drop_sys.add(i_sys)

    if drop_sys or drop_mic:
        logger.info(
            "Per-segment bleed correction: dropped %d/%d system, %d/%d mic",
            len(drop_sys), len(system_segments),
            len(drop_mic), len(mic_segments),
        )

    kept_mic = [s for i, s in enumerate(mic_segments) if i not in drop_mic]
    kept_sys = [s for i, s in enumerate(system_segments) if i not in drop_sys]
    return kept_mic, kept_sys


# Try Parakeet first (preferred — same engine as live, arm64 Macs only).
try:
    from src.parakeet import transcribe_file as _parakeet_transcribe_file
    PARAKEET_AVAILABLE = True
except ImportError:
    _parakeet_transcribe_file = None
    PARAKEET_AVAILABLE = False

# whisper.cpp via pywhispercpp is the cross-platform fallback that keeps
# Intel-Mac DMGs working (parakeet-mlx is Apple-Silicon-only). Bundled
# unconditionally in stenoai.spec and lazily probed here at import time.
try:
    from pywhispercpp.model import Model as WhisperCppModel
    WHISPER_CPP_AVAILABLE = True
except ImportError:
    WhisperCppModel = None
    WHISPER_CPP_AVAILABLE = False

if not PARAKEET_AVAILABLE and not WHISPER_CPP_AVAILABLE:
    logger.warning(
        "No ASR backend importable (parakeet-mlx + pywhispercpp both "
        "missing); batch transcription will fail",
    )

# Top-level capability flag retained for callers that probed for whisper
# presence. Means "any working ASR backend at all".
WHISPER_AVAILABLE = PARAKEET_AVAILABLE or WHISPER_CPP_AVAILABLE


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

    def __init__(self, model_size: str = "large-v3-turbo"):
        if not (PARAKEET_AVAILABLE or WHISPER_CPP_AVAILABLE):
            raise ImportError(
                "No ASR backend available. Need parakeet-mlx (Apple Silicon) "
                "or pywhispercpp (cross-platform). Rebuild the PyInstaller "
                "bundle or `pip install` the relevant package."
            )
        # Kept on the instance so existing callers / logs that read
        # ``model_size`` and ``backend`` don't change. Backend selection
        # respects the user-selected engine from Settings → Transcribe
        # (Config.get_transcription_engine). Without this, an arm64 user
        # who picked Whisper would still get Parakeet on the post-stop
        # pass — live and final would silently use different engines
        # and the diarised transcript wouldn't match what they previewed
        # live. Fallback order when the requested engine isn't installed:
        #   * engine='whisper' but pywhispercpp missing → use Parakeet
        #   * engine='parakeet' but parakeet-mlx missing (x64 Macs) →
        #     fall back to whisper.cpp as before
        self.model_size = model_size
        self.model = None

        try:
            from src.config import get_config
            requested = get_config().get_transcription_engine()
        except Exception:
            requested = "parakeet"

        if requested == "whisper" and WHISPER_CPP_AVAILABLE:
            self.backend = "whisper.cpp"
            self._load_whisper_cpp()
        elif PARAKEET_AVAILABLE:
            self.backend = "parakeet-tdt-v3"
        else:
            self.backend = "whisper.cpp"
            self._load_whisper_cpp()
        self._ensure_ffmpeg_in_path()

    def _load_whisper_cpp(self) -> None:
        """Load the whisper.cpp model lazily for the Intel-Mac fallback path.

        pywhispercpp auto-downloads the ggml weight on first construction;
        ``self.model_size`` should be one of the entries in
        ``src/whisper_models.py`` (large-v3-turbo is the default).
        """
        import multiprocessing
        n_threads = max(1, multiprocessing.cpu_count() - 2)
        logger.info("Loading whisper.cpp model: %s", self.model_size)
        self.model = WhisperCppModel(self.model_size, n_threads=n_threads)
        logger.info("whisper.cpp model loaded (threads=%d)", n_threads)

    def _build_whisper_fallback(self) -> bool:
        """Try to stand up whisper.cpp as a crash-recovery fallback engine.

        Returns True only when a retry on whisper.cpp is actually possible:
        the active backend is Parakeet, pywhispercpp is importable, and the
        ggml weight for ``self.model_size`` is ALREADY on disk. The
        is_installed gate is load-bearing — constructing pywhispercpp's
        Model for a missing weight auto-downloads ~466 MB, which must never
        happen implicitly in a failure path (offline machines, metered
        connections). Any error means "no fallback", never a crash.
        """
        try:
            if self.backend != "parakeet-tdt-v3" or not WHISPER_CPP_AVAILABLE:
                return False
            if self.model is not None:
                # Already loaded by a previous fallback (e.g. the first
                # diarised channel) — reuse it.
                return True
            from src import whisper_models
            if not whisper_models.is_installed(self.model_size):
                logger.info(
                    "whisper.cpp fallback unavailable: model %r not installed",
                    self.model_size,
                )
                return False
            self._load_whisper_cpp()
            return True
        except Exception as e:
            logger.warning("whisper.cpp fallback unavailable: %s", e)
            return False

    def _ensure_ffmpeg_in_path(self) -> None:
        """Make sure ffmpeg is reachable from $PATH for the stereo split.

        We don't need ffmpeg for the basic transcribe path anymore (Parakeet
        handles arbitrary formats via librosa), but the stereo-channel split
        in ``transcribe_diarised`` still calls ffmpeg with a `pan` filter to
        separate the mic and system channels.
        """
        exe_suffix = ".exe" if sys.platform == "win32" else ""
        binary_name = f"ffmpeg{exe_suffix}"
        possible_ffmpeg_paths = []

        if getattr(sys, 'frozen', False):
            exe_dir = Path(sys.executable).parent
            root_ffmpeg = exe_dir / binary_name
            if root_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(root_ffmpeg))
            if hasattr(sys, '_MEIPASS'):
                meipass_ffmpeg = Path(sys._MEIPASS) / binary_name
                if meipass_ffmpeg.exists():
                    possible_ffmpeg_paths.append(str(meipass_ffmpeg))
            internal_ffmpeg = exe_dir / '_internal' / binary_name
            if internal_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(internal_ffmpeg))
        else:
            dev_ffmpeg = Path(__file__).parent.parent / 'bin' / binary_name
            if dev_ffmpeg.exists():
                possible_ffmpeg_paths.append(str(dev_ffmpeg))

        if sys.platform != "win32":
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
                # os.pathsep is ':' on POSIX and ';' on Windows — hardcoding ':'
                # corrupts PATH on Windows so the prepended dir never resolves.
                os.environ['PATH'] = f"{ffmpeg_dir}{os.pathsep}{current_path}"
                logger.info(f"Added {ffmpeg_dir} to PATH")
        else:
            logger.warning("ffmpeg not found - stereo diarisation will fall back to mono")

    def _preprocess_audio(self, audio_filepath: Path) -> Tuple[Path, bool]:
        """Clean mono audio before transcription: high-pass + loudnorm.

        Returns ``(path_to_transcribe, is_temp)``. On any problem — ffmpeg
        missing, non-zero exit, timeout — falls back to ``(original, False)``
        so pre-processing can never fail a meeting. The caller owns deleting
        the temp file when ``is_temp`` is True.
        """
        ffmpeg = _resolve_ffmpeg()
        if not ffmpeg:
            logger.info("ffmpeg unavailable; skipping audio pre-processing")
            return audio_filepath, False

        # mkstemp (not a name derived from the input stem) so concurrent CLI
        # invocations over same-named files can't overwrite or unlink each
        # other's pre-processed audio mid-transcription. Inside the fail-open
        # guard: an mkstemp failure (disk full, temp-dir perms) must fall
        # back to the original audio like every other pre-processing problem,
        # not fail the meeting.
        try:
            fd, temp_name = tempfile.mkstemp(
                prefix=f"stenoai_prep_{audio_filepath.stem}_", suffix=".wav"
            )
            os.close(fd)
        except OSError as e:
            logger.warning("Could not create pre-processing temp file; using original audio: %s", e)
            return audio_filepath, False
        temp_path = Path(temp_name)
        try:
            result = subprocess.run(
                [ffmpeg, '-y', '-i', str(audio_filepath),
                 '-af', _audio_filter_chain(),
                 '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
                 str(temp_path)],
                capture_output=True,
                timeout=AUDIO_PREPROCESS_TIMEOUT_S,
            )
            if result.returncode == 0 and temp_path.exists() and temp_path.stat().st_size > 0:
                logger.info("Audio pre-processed (highpass + loudnorm): %s", temp_path.name)
                return temp_path, True
            logger.warning(
                "Audio pre-processing failed (rc=%s); using original audio: %s",
                result.returncode, result.stderr.decode(errors='replace')[-300:],
            )
        except Exception as e:
            logger.warning("Audio pre-processing error; using original audio: %s", e)
        # Clean up any partial output from the failed pass.
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass
        return audio_filepath, False

    # ------------------------------------------------------------------
    # Core: run Parakeet on a WAV path, return our normalised dict shape.
    # ------------------------------------------------------------------

    def _run_backend(self, audio_filepath: Path, language: str) -> dict:
        """Dispatch to whichever ASR backend is active for this instance."""
        if self.backend == "parakeet-tdt-v3":
            return self._run_parakeet(audio_filepath, language)
        return self._run_whisper_cpp(audio_filepath, language)

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

    def _convert_to_16khz(self, audio_filepath: Path) -> tuple[Path, Optional[float]]:
        """Convert audio to 16 kHz mono WAV for whisper.cpp via ffmpeg.

        Used only on the whisper.cpp path. Parakeet's ``transcribe_file``
        accepts arbitrary formats via librosa, so the Parakeet path doesn't
        need this step.
        """
        import wave

        # Already 16 kHz mono PCM — e.g. produced by _preprocess_audio (the
        # whisper.cpp crash-fallback receives that temp) or the diarised
        # channel split. Skip the second full decode+encode.
        try:
            with wave.open(str(audio_filepath), 'rb') as wf:
                if (wf.getframerate() == 16000 and wf.getnchannels() == 1
                        and wf.getsampwidth() == 2):
                    return audio_filepath, wf.getnframes() / wf.getframerate()
        except Exception:
            pass  # not a readable WAV — fall through to ffmpeg

        ffmpeg = _resolve_ffmpeg() or 'ffmpeg'
        temp_dir = tempfile.gettempdir()
        converted_path = Path(temp_dir) / f"stenoai_16khz_{audio_filepath.stem}.wav"
        try:
            result = subprocess.run(
                [ffmpeg, '-y', '-i', str(audio_filepath),
                 '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
                 str(converted_path)],
                capture_output=True,
                timeout=60,
            )
            if result.returncode == 0 and converted_path.exists():
                duration_seconds = None
                try:
                    with wave.open(str(converted_path), 'rb') as wf:
                        duration_seconds = wf.getnframes() / wf.getframerate()
                except Exception as e:
                    logger.warning("Could not read duration from converted WAV: %s", e)
                return converted_path, duration_seconds
            logger.error("ffmpeg conversion failed: %s", result.stderr.decode())
            return audio_filepath, None
        except Exception as e:
            logger.error("Audio conversion error: %s", e)
            return audio_filepath, None

    def _run_whisper_cpp(self, audio_filepath: Path, language: str) -> dict:
        """Call into pywhispercpp on the converted 16 kHz mono WAV.

        Same return shape as ``_run_parakeet``. ``language="auto"`` uses
        whisper.cpp's built-in language detection; a concrete code biases
        the decoder toward that language. Loop-hallucination dedup (runs
        of 5+ identical segments) preserved from the whisper-era code —
        whisper.cpp is known to emit canned phrases like ``"Thank you."``
        repeatedly on silent input.
        """
        if self.model is None:
            logger.error("whisper.cpp model not loaded")
            return {"text": None, "segments": [], "duration_seconds": None,
                    "detected_language": None, "detected_language_probability": None}

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
                        detected_language = detection_result[0]
                        resolved_language = detected_language
                        if len(detection_result) >= 2:
                            detected_language_probability = float(detection_result[1])
                except Exception as e:
                    logger.warning("Failed to auto-detect language; using whisper default: %s", e)
                    resolved_language = None

            transcribe_kwargs = {"media": str(converted_path)}
            if resolved_language and resolved_language != "auto":
                transcribe_kwargs["language"] = resolved_language
            # Per-segment heartbeat: keeps the Electron inactivity watchdog
            # alive on this path too — including when whisper.cpp runs as
            # the crash-recovery fallback for a long meeting on a slow
            # machine, which would otherwise be minutes of stdout silence.
            # Probed by signature so an API change degrades to no heartbeat
            # rather than a TypeError mid-failure-recovery.
            try:
                if "new_segment_callback" in inspect.signature(self.model.transcribe).parameters:
                    segment_count = 0

                    def _on_segment(_segment):
                        nonlocal segment_count
                        segment_count += 1
                        _emit_heartbeat(segment_count, 0)  # total unknown

                    transcribe_kwargs["new_segment_callback"] = _on_segment
            except (TypeError, ValueError):
                pass
            segments = self.model.transcribe(**transcribe_kwargs)

            # Dedup whisper.cpp loop hallucinations: 5+ consecutive identical
            # segments. Preserved from the historical whisper code path.
            if segments:
                deduped: list = []
                i = 0
                while i < len(segments):
                    text = segments[i].text.strip()
                    run_end = i + 1
                    while run_end < len(segments) and segments[run_end].text.strip() == text:
                        run_end += 1
                    if run_end - i >= 5 and text:
                        logger.warning("Dropped %d repeated whisper segments: %r", run_end - i, text[:60])
                    else:
                        deduped.extend(segments[i:run_end])
                    i = run_end
                segments = deduped

            if not segments:
                return {"text": None, "segments": [], "duration_seconds": duration_seconds,
                        "detected_language": detected_language,
                        "detected_language_probability": detected_language_probability}

            transcript = " ".join(s.text.strip() for s in segments)
            return {
                "text": transcript.strip() or None,
                "segments": [
                    {"text": s.text.strip(), "start": s.t0 / 100.0, "end": s.t1 / 100.0}
                    for s in segments if s.text.strip()
                ],
                "duration_seconds": duration_seconds,
                "detected_language": detected_language,
                "detected_language_probability": detected_language_probability,
            }
        finally:
            if cleanup_converted and converted_path.exists():
                try:
                    converted_path.unlink()
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # Public batch API (back-compat with the whisper-era surface).
    # ------------------------------------------------------------------

    def transcribe_audio(
        self,
        audio_filepath: Path,
        language: str = "en",
        _preprocessed: bool = False,
    ) -> Optional[dict]:
        """Transcribe a single-channel (or mono-mixed) audio file.

        Returns ``None`` if the file is missing or too small to transcribe;
        otherwise a dict with ``text`` / ``segments`` / ``duration_seconds`` /
        ``detected_language`` / ``detected_language_probability``.

        ``_preprocessed`` marks input that is already cleaned (the diarised
        path's split channels are 16 kHz mono + high-passed by the split
        ffmpeg pass) so the mono pre-processing pass isn't applied twice.
        """
        if not audio_filepath.exists():
            logger.error(f"Audio file not found: {audio_filepath}")
            return None

        preprocess_temp: Optional[Path] = None
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

            transcribe_path = audio_filepath
            if not _preprocessed:
                transcribe_path, is_temp = self._preprocess_audio(audio_filepath)
                if is_temp:
                    preprocess_temp = transcribe_path

            try:
                result = self._run_backend(transcribe_path, language)
                result.setdefault("engine", self.backend)
            except Exception as primary_error:
                # A mid-inference crash (e.g. an MLX metal abort) on the
                # primary engine. Retry ONCE on whisper.cpp — but only when
                # the weight is already installed (_build_whisper_fallback
                # never triggers a download). Otherwise re-raise into the
                # honest transcription_failed path below.
                if not self._build_whisper_fallback():
                    raise
                logger.warning(
                    "Primary engine crashed (%s); retrying once on whisper.cpp",
                    primary_error,
                )
                result = self._run_whisper_cpp(transcribe_path, language)
                result["engine"] = "whisper.cpp-fallback"

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
            # A crash here (e.g. an MLX metal::malloc OOM on a long file) is NOT
            # silence. Return a tagged dict so callers can preserve the audio and
            # surface a real, reprocessable error instead of saving a fake-empty
            # meeting. `None` stays reserved for the missing-file case above so
            # existing "None means no file" callers are unchanged.
            return {
                "text": None,
                "segments": [],
                "duration_seconds": None,
                "detected_language": None,
                "detected_language_probability": None,
                "transcription_failed": True,
                "error": str(e),
            }
        finally:
            if preprocess_temp is not None:
                try:
                    preprocess_temp.unlink()
                except OSError:
                    pass

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
                # High-pass only on the diarised path — deliberately NO
                # per-channel loudnorm: normalising each channel separately
                # would erase the relative-RMS difference that
                # _drop_per_segment_bleed uses to tell the direct signal
                # from its attenuated echo on the other channel.
                result = subprocess.run(
                    [ffmpeg, '-y', '-i', str(audio_filepath),
                     '-af', f'pan=mono|c0=c{ch_idx},highpass=f={AUDIO_HIGHPASS_HZ}',
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
            engine = None
            channel_failed = False
            channel_error: Optional[str] = None

            # Split channels are already 16 kHz mono + high-passed by the
            # split ffmpeg pass above — skip the mono pre-processing pass.
            if mic_has_audio:
                logger.info("Transcribing mic channel (You)...")
                mic_result = self.transcribe_audio(mic_path, language, _preprocessed=True)
                if mic_result and mic_result.get("transcription_failed"):
                    channel_failed = True
                    channel_error = channel_error or mic_result.get("error")
                elif mic_result and mic_result.get("text"):
                    mic_segments = mic_result.get("segments") or []
                    if not detected_language and mic_result.get("detected_language"):
                        detected_language = mic_result["detected_language"]
                        detected_language_probability = mic_result.get("detected_language_probability")
                    if not engine:
                        engine = mic_result.get("engine")
            else:
                logger.info("Mic channel is silent, skipping")

            if system_has_audio:
                logger.info("Transcribing system channel (Others)...")
                sys_result = self.transcribe_audio(system_path, language, _preprocessed=True)
                if sys_result and sys_result.get("transcription_failed"):
                    channel_failed = True
                    channel_error = channel_error or sys_result.get("error")
                elif sys_result and sys_result.get("text"):
                    system_segments = sys_result.get("segments") or []
                    if not detected_language and sys_result.get("detected_language"):
                        detected_language = sys_result["detected_language"]
                        detected_language_probability = sys_result.get("detected_language_probability")
                    if not engine:
                        engine = sys_result.get("engine")
            else:
                logger.info("System channel is silent, skipping")

            # A crash on either channel is not silence. Bail before assembling a
            # transcript so the caller preserves the audio and surfaces a real
            # error instead of saving a partial/fake-empty meeting.
            if channel_failed:
                logger.error("Diarised transcription failed on a channel: %s", channel_error)
                return {
                    "text": None,
                    "diarised_text": None,
                    "is_diarised": False,
                    "duration_seconds": duration,
                    "detected_language": detected_language,
                    "detected_language_probability": detected_language_probability,
                    "transcription_failed": True,
                    "error": channel_error or "transcription failed",
                }

            # Speaker-bleed correction runs in two passes:
            #
            # 1. Per-segment: drop the bleed-echo side of each Jaccard-
            #    matched (mic, system) pair. Decides which side is the
            #    echo by comparing per-segment RMS on the split channel
            #    WAVs — the channel with higher RMS holds the direct
            #    signal. Without that RMS step we'd always drop system,
            #    which is wrong in the headphone-less case where the
            #    mic is the one picking up the echo of Others' speech.
            # 2. Whole-transcript: if what's LEFT of the system channel
            #    still overlaps mic >= BLEED_JACCARD_THRESHOLD, the
            #    remaining content is also bleed — collapse to mic-only.
            #    The first pass usually handles things and this is a
            #    backstop for catastrophic bleed.
            if mic_segments and system_segments:
                mic_segments, system_segments = _drop_per_segment_bleed(
                    mic_segments, system_segments,
                    mic_path=mic_path, system_path=system_path,
                )
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
                "engine": engine or self.backend,
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

        Thin wrapper around ``_run_backend`` — Parakeet returns AlignedSentence
        timings directly; whisper.cpp segments expose t0/t1 in centiseconds
        which the backend's normaliser converts.
        """
        if not audio_filepath.exists():
            logger.error(f"Audio file not found: {audio_filepath}")
            return None

        try:
            logger.info(f"Transcribing audio file with timestamps: {audio_filepath}")
            result = self._run_backend(audio_filepath, language="auto")
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
