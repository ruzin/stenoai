"""
Configuration management for StenoAI.

Handles storing and loading user preferences like model selection.
"""

import copy
import json
import logging
import os
import platform
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional, Dict, Any

import filelock

from src.whisper_models import SUPPORTED_WHISPER_MODELS as _WHISPER_REGISTRY
from src import templates as _templates

logger = logging.getLogger(__name__)


def _atomic_write_json(path: Path, payload) -> None:
    """Write `payload` as JSON to `path` atomically.

    The shared atomic writer for every JSON file the CLI persists —
    config.json here, recorder_state.json and the final summary JSON via
    the re-export in simple_recorder. tempfile + os.replace in the same
    directory keeps the rename a single filesystem operation on POSIX and
    Windows, so a crash mid-write leaves the prior file intact rather
    than a half-written one. config.json in particular is read by many
    concurrent CLI subprocesses; a plain truncate-and-rewrite lets a
    reader see a torn file, fall back to defaults, and (pre-fix) persist
    those defaults over the user's real settings.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(
        mode='w',
        dir=str(path.parent),
        prefix=f'.{path.name}.',
        suffix='.tmp',
        delete=False,
        encoding='utf-8',
    )
    try:
        json.dump(payload, tmp, indent=2)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp.close()
        # Windows can transiently refuse the replace while another
        # process holds the destination open for read; a couple of
        # short retries cover that without a platform gate.
        for attempt in range(3):
            try:
                os.replace(tmp.name, path)
                return
            except PermissionError:
                if attempt == 2:
                    raise
                time.sleep(0.05)
    except Exception:
        try:
            tmp.close()
        except Exception:
            pass
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise


def get_user_data_dir() -> Path:
    """Per-OS user data directory for stenoai when running as a frozen bundle.

    macOS:   ~/Library/Application Support/stenoai
    Windows: %APPDATA%/stenoai  (Roaming)
    Linux:   $XDG_DATA_HOME/stenoai or ~/.local/share/stenoai
    """
    # E2E isolation: a per-test temp dir set via STENOAI_USER_DATA_DIR wins for
    # the backend child too (the Electron parent propagates it via the inherited
    # env). Symmetric with app/main.js getUserDataDir(). Inert in production.
    override = os.environ.get("STENOAI_USER_DATA_DIR")
    if override:
        return Path(override)
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "stenoai"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        return (Path(base) if base else Path.home() / "AppData" / "Roaming") / "stenoai"
    base = os.environ.get("XDG_DATA_HOME")
    return (Path(base) if base else Path.home() / ".local" / "share") / "stenoai"


def is_bundled() -> bool:
    """True when running from a PyInstaller-frozen bundle.

    The legacy "StenoAI.app"/"Applications" string check was a mac-only safety
    net; sys.frozen is the canonical PyInstaller marker on every platform, with
    the path check kept as a belt-and-braces for mac-source-in-Applications.
    """
    if getattr(sys, "frozen", False):
        return True
    path = str(Path(__file__))
    return "StenoAI.app" in path or "Applications" in path


def is_apple_silicon() -> bool:
    """True on macOS running on Apple Silicon (arm64/aarch64).

    The single gate for every Ollama-MLX-tag decision in this module — no
    other function should re-derive this check.
    """
    return sys.platform == "darwin" and platform.machine() in ("arm64", "aarch64")


class Config:
    """Manages application configuration with file persistence."""

    DEFAULT_MODEL = "gemma4:e2b-it-qat"

    # Supported models with metadata. Active models first (roughly ascending by
    # capability/size, default first), deprecated models last — the Settings UI
    # tucks deprecated entries into a collapsed, dimmed section and only surfaces
    # one if it's still the user's current model. Deprecated (rather than removed)
    # so a user already on the model keeps a recognised selection; fully retired
    # models are dropped from this dict.
    SUPPORTED_MODELS = {
        "gemma4:e2b-it-qat": {
            "name": "Gemma 4 E2B (QAT)",
            "size": "4.3GB",
            "params": "2B",
            "description": "Lightest Gemma 4, quantization-aware, real 128K context (default)",
            "speed": "fast",
            "quality": "good"
        },
        "gemma4:e4b-it-qat": {
            "name": "Gemma 4 E4B (QAT)",
            "size": "6.1GB",
            "params": "4B",
            "description": "Quantization-aware E4B — higher quality than E2B at a modest footprint",
            "speed": "medium",
            "quality": "excellent"
        },
        "llama3.2:3b": {
            "name": "Llama 3.2 3B",
            "size": "2GB",
            "params": "3B",
            "description": "Replaced by Gemma 4 E2B",
            "speed": "very fast",
            "quality": "good",
            "deprecated": True
        },
        "qwen3.5:9b": {
            "name": "Qwen 3.5 9B",
            "size": "6.6GB",
            "params": "9B",
            "description": "Excellent at structured output and action items",
            "speed": "medium",
            "quality": "excellent"
        },
        "gemma4:12b-it-qat": {
            "name": "Gemma 4 12B (QAT)",
            "size": "7.2GB",
            "params": "12B",
            "description": "Large 256K context, quantization-aware - best for long meetings",
            "speed": "medium",
            "quality": "excellent"
        },
        "gpt-oss:20b": {
            "name": "GPT-OSS 20B",
            "size": "14GB",
            "params": "20B",
            "description": "OpenAI open-weight model with reasoning capabilities",
            "speed": "medium",
            "quality": "excellent"
        },
    }


    # Single source of truth for the curated Whisper model lineup is
    # src/whisper_models.py — that module owns display names, sizes,
    # descriptions, and the installed-status check the UI cards consume.
    # The list form here is what the validation paths (set_whisper_model,
    # get_whisper_model fallback) compare against. Re-derive on import so
    # adding a model in whisper_models.py automatically widens validation.
    SUPPORTED_WHISPER_MODELS = list(_WHISPER_REGISTRY.keys())

    # Languages shown in the settings dropdown (curated/tested)
    SUPPORTED_LANGUAGES = {
        "auto": "Auto (detect)",
        "en": "English",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "nl": "Dutch",
        "pt": "Portuguese",
        "ja": "Japanese",
        "zh": "Chinese",
        "ko": "Korean",
        "hi": "Hindi",
        "ar": "Arabic",
    }

    # Full ISO 639-1 language names for auto-detect passthrough.
    # Whisper supports 99 languages; this maps codes to display names
    # so the summarizer prompt gets a proper language name (e.g. "Polish")
    # rather than just a code (e.g. "pl").
    _LANGUAGE_NAMES = {
        "af": "Afrikaans", "am": "Amharic", "ar": "Arabic", "as": "Assamese",
        "az": "Azerbaijani", "ba": "Bashkir", "be": "Belarusian", "bg": "Bulgarian",
        "bn": "Bengali", "bo": "Tibetan", "br": "Breton", "bs": "Bosnian",
        "ca": "Catalan", "cs": "Czech", "cy": "Welsh", "da": "Danish",
        "de": "German", "el": "Greek", "en": "English", "es": "Spanish",
        "et": "Estonian", "eu": "Basque", "fa": "Persian", "fi": "Finnish",
        "fo": "Faroese", "fr": "French", "gl": "Galician", "gu": "Gujarati",
        "ha": "Hausa", "haw": "Hawaiian", "he": "Hebrew", "hi": "Hindi",
        "hr": "Croatian", "ht": "Haitian Creole", "hu": "Hungarian", "hy": "Armenian",
        "id": "Indonesian", "is": "Icelandic", "it": "Italian", "ja": "Japanese",
        "jw": "Javanese", "ka": "Georgian", "kk": "Kazakh", "km": "Khmer",
        "kn": "Kannada", "ko": "Korean", "la": "Latin", "lb": "Luxembourgish",
        "ln": "Lingala", "lo": "Lao", "lt": "Lithuanian", "lv": "Latvian",
        "mg": "Malagasy", "mi": "Maori", "mk": "Macedonian", "ml": "Malayalam",
        "mn": "Mongolian", "mr": "Marathi", "ms": "Malay", "mt": "Maltese",
        "my": "Myanmar", "ne": "Nepali", "nl": "Dutch", "nn": "Nynorsk",
        "no": "Norwegian", "oc": "Occitan", "pa": "Punjabi", "pl": "Polish",
        "ps": "Pashto", "pt": "Portuguese", "ro": "Romanian", "ru": "Russian",
        "sa": "Sanskrit", "sd": "Sindhi", "si": "Sinhala", "sk": "Slovak",
        "sl": "Slovenian", "sn": "Shona", "so": "Somali", "sq": "Albanian",
        "sr": "Serbian", "su": "Sundanese", "sv": "Swedish", "sw": "Swahili",
        "ta": "Tamil", "te": "Telugu", "tg": "Tajik", "th": "Thai",
        "tk": "Turkmen", "tl": "Tagalog", "tr": "Turkish", "tt": "Tatar",
        "uk": "Ukrainian", "ur": "Urdu", "uz": "Uzbek", "vi": "Vietnamese",
        "yi": "Yiddish", "yo": "Yoruba", "zh": "Chinese",
    }

    VALID_TRANSCRIPTION_ENGINES = ("parakeet", "whisper")

    def __init__(self, config_path: Optional[Path] = None):
        """
        Initialize configuration manager.

        Args:
            config_path: Path to config file. If None, uses default location.
        """
        if config_path is None:
            # STENOAI_USER_DATA_DIR forces the data dir even from source (e2e
            # isolation), so the override in get_user_data_dir() is authoritative
            # whether the backend runs frozen or from source.
            if is_bundled() or os.environ.get("STENOAI_USER_DATA_DIR"):
                base_dir = get_user_data_dir()
            else:
                # Source dev: project root
                base_dir = Path(__file__).parent.parent

            base_dir.mkdir(parents=True, exist_ok=True)
            self.config_path = base_dir / "config.json"
        else:
            self.config_path = config_path

        # Captured before _load() because _load() returns defaults silently
        # when the file is missing — by the time migrations run we can't tell
        # "fresh install" from "loaded existing file" by inspecting self._config
        # alone (whisper_model and friends are in the defaults dict).
        self._existed_at_load = self.config_path.exists()
        # Set by _load() when an existing config file could not be parsed.
        # Migrations check it so a corrupt (or torn, mid-write) read never
        # gets its in-memory defaults persisted over the recoverable file.
        self._load_failed = False
        self._config: Dict[str, Any] = self._load()
        # Snapshot of exactly what was read from disk (or the defaults on a
        # fresh/corrupt load). _save() diffs self._config against this to write
        # back ONLY the keys this process actually changed, so a concurrent
        # writer's unrelated keys aren't clobbered (the lost-update fix).
        self._snapshot: Dict[str, Any] = copy.deepcopy(self._config)
        self._migrate_cloud_model_map()
        self._migrate_whisper_model()
        self._migrate_summary_model()
        self._migrate_transcription_engine()
        self._normalize_templates()
        self._seed_sample_template()

    def _migrate_transcription_engine(self) -> None:
        """Decide the active ASR engine on first launch of a version that has
        this field.

        New installs default to Parakeet. Existing users (config.json existed
        before this launch) stay on Whisper so their muscle memory and any
        Asian-language workflows aren't silently swapped under them; the
        Settings → Transcribe tab is how they opt into Parakeet.
        """
        if self._load_failed:
            return  # never persist defaults over a corrupt-but-recoverable file
        if self._config.get("transcription_engine") in self.VALID_TRANSCRIPTION_ENGINES:
            return
        self._config["transcription_engine"] = (
            "whisper" if self._existed_at_load else "parakeet"
        )
        self._save()

    def _migrate_whisper_model(self) -> None:
        """Map any out-of-current-list whisper model to the supported one.

        The curated lineup is now a single tier (large-v3-turbo), so any
        previously-supported but now-retired tier (tiny/base/small/medium/
        large/large-v3) migrates to it.
        """
        if self._load_failed:
            return  # never persist defaults over a corrupt-but-recoverable file
        current = self._config.get("whisper_model")
        if current is None or current in self.SUPPORTED_WHISPER_MODELS:
            return
        self._config["whisper_model"] = "large-v3-turbo"
        self._save()

    # Summary-model ids we renamed in place — a user pinned to the old tag is
    # moved to the equivalent, better-quantized build so they keep the model
    # they chose (rather than being dropped to the default). The new tag is a
    # different Ollama model, so the next summarisation pulls it on demand.
    _RENAMED_SUMMARY_MODELS = {
        "gemma4:4b": "gemma4:e4b-it-qat",
        "gemma4:12b": "gemma4:12b-it-qat",
    }

    # The three curated Gemma 4 QAT models' NVFP4/MLX-engine equivalents,
    # adopted on Apple Silicon for a large generation-speed win (Ollama's MLX
    # engine is GA there). Deliberately NOT applied to llama3.2:3b/qwen3.5:9b/
    # gpt-oss:20b — Ollama does not ship MLX builds of those.
    _MLX_EQUIVALENTS = {
        "gemma4:e2b-it-qat": "gemma4:e2b-nvfp4",
        "gemma4:e4b-it-qat": "gemma4:e4b-nvfp4",
        "gemma4:12b-it-qat": "gemma4:12b-nvfp4",
    }
    _MLX_TO_GGUF = {mlx_tag: gguf_id for gguf_id, mlx_tag in _MLX_EQUIVALENTS.items()}

    # NVFP4 blobs are a different quantization than their GGUF counterpart in
    # SUPPORTED_MODELS and can be meaningfully larger -- shown instead of the
    # GGUF size whenever the NVFP4 tag is what's actually installed or (on a
    # fresh pull) what "Select" will actually download. Keyed by the NVFP4
    # tag, not the GGUF id, matching how it's looked up in list_models().
    _MLX_SIZES = {
        "gemma4:e2b-nvfp4": "6.5GB",
        "gemma4:e4b-nvfp4": "8.8GB",
        "gemma4:12b-nvfp4": "7.7GB",
    }

    # Curated models we retired — a user pinned to one is migrated to the
    # default on load. Deliberately a specific allow-list, NOT "anything not in
    # SUPPORTED_MODELS": set_model intentionally allows arbitrary user-pulled
    # Ollama models (e.g. llama3.2:1b), and those must NOT be clobbered.
    _RETIRED_SUMMARY_MODELS = {"gemma3:4b", "deepseek-r1:14b"}

    def _migrate_summary_model(self) -> None:
        """Migrate a renamed or retired summary model on load.

        Renamed ids (gemma4:4b -> gemma4:e4b-it-qat, gemma4:12b ->
        gemma4:12b-it-qat) move to the equivalent quantization-aware build, so
        the user keeps their chosen model; the new tag is pulled on demand.
        Retired ids (gemma3:4b, deepseek-r1:14b) reset to the default. Only
        these specific ids migrate — custom/self-pulled models and the
        deprecated-but-kept llama3.2:3b are left alone.
        """
        if self._load_failed:
            return  # never persist defaults over a corrupt-but-recoverable file
        current = self._config.get("model")
        if current in self._RENAMED_SUMMARY_MODELS:
            self._config["model"] = self._RENAMED_SUMMARY_MODELS[current]
            self._save()
        elif current in self._RETIRED_SUMMARY_MODELS:
            self._config["model"] = self.DEFAULT_MODEL
            self._save()

    def _migrate_cloud_model_map(self) -> None:
        """One-shot migration from legacy single 'cloud_model' to per-provider
        'cloud_models' map. Runs at load time (before any setters can change
        the provider) so the legacy value is correctly attributed to whichever
        provider was active when it was last saved."""
        if self._load_failed:
            # _load() returned defaults for a corrupt-but-present file. The
            # defaults carry a legacy 'cloud_model', so without this guard the
            # migration below would _save() and overwrite the recoverable file.
            self._config["cloud_models"] = {}
            return
        if isinstance(self._config.get("cloud_models"), dict):
            return  # Already migrated.
        legacy = self._config.get("cloud_model")
        has_legacy_value = isinstance(legacy, str) and legacy.strip()
        if not has_legacy_value:
            # Nothing to migrate; don't write just to persist an empty map.
            self._config["cloud_models"] = {}
            return
        current_provider = self._config.get("cloud_provider", "openai")
        if current_provider not in self.VALID_CLOUD_PROVIDERS:
            current_provider = "openai"
        self._config["cloud_models"] = {current_provider: legacy.strip()}
        self._save()

    def _load(self) -> Dict[str, Any]:
        """Load configuration from file.

        A parse failure on an existing file is retried once (a torn read
        racing a writer heals in milliseconds). If it still fails, the
        corrupt file is backed up to config.json.corrupt and we run on
        in-memory defaults with self._load_failed set — migrations skip
        writing so the original on disk stays recoverable.
        """
        if not self.config_path.exists():
            logger.info(f"Config file not found, creating default at {self.config_path}")
            return self._get_default_config()

        last_error = None
        for attempt in range(2):
            try:
                with open(self.config_path, 'r') as f:
                    config = json.load(f)
                    if not isinstance(config, dict):
                        # `null` / `[]` parse fine but crash every get/set
                        # later; route them through the corrupt-file path.
                        raise ValueError("config.json root is not an object")
                    logger.info(f"Loaded config from {self.config_path}")
                    return config
            except Exception as e:
                last_error = e
                if attempt == 0:
                    time.sleep(0.2)

        self._load_failed = True
        backup_path = self.config_path.with_name(self.config_path.name + ".corrupt")
        try:
            shutil.copy2(self.config_path, backup_path)
            logger.error(
                f"Error loading config: {last_error}. Using defaults in memory; "
                f"corrupt file backed up to {backup_path}"
            )
        except Exception as backup_error:
            logger.error(
                f"Error loading config: {last_error}. Using defaults in memory; "
                f"backup to {backup_path} also failed: {backup_error}"
            )
        return self._get_default_config()

    # Seconds to wait for the cross-process config lock before giving up and
    # falling back to an unlocked write. Generous enough to cover a normal
    # save on a busy disk, short enough that a truly stuck lock never blocks
    # the CLI for long.
    _SAVE_LOCK_TIMEOUT = 10

    def _read_disk_for_merge(self) -> Optional[Dict[str, Any]]:
        """Re-read config.json fresh for use as the merge base. Returns the
        parsed dict, or None if the file is missing / unparseable / not a dict
        (in which case the caller writes its own config wholesale). Must be
        called under the file lock so the read reflects any concurrent writer's
        just-completed atomic replace."""
        if not self.config_path.exists():
            return None
        try:
            with open(self.config_path, 'r') as f:
                data = json.load(f)
        except Exception:
            return None
        return data if isinstance(data, dict) else None

    @classmethod
    def _apply_changes(
        cls, base: Dict[str, Any], current: Dict[str, Any], snapshot: Any
    ) -> Dict[str, Any]:
        """Overlay onto `base` (fresh from disk) only the changes between
        `snapshot` (what we loaded) and `current` (our in-memory dict).

        Recurses into dict-valued keys so two processes editing DIFFERENT
        sub-keys of the SAME nested dict (e.g. per-provider `cloud_models`, or
        `template_overrides`) don't clobber each other — we assert only the
        sub-keys THIS process actually touched and keep the concurrent writer's
        sub-keys straight from disk. Scalars and lists are overlaid wholesale
        (a list has no clean per-element three-way merge, so last-writer-wins,
        matching the design's genuine-conflict stance). A key whose type
        changed between dict and non-dict also falls back to a wholesale
        overlay. Nested deletions (config's only deletion path, reset_template
        dropping a `template_overrides` entry) are propagated too.

        Returns a new dict; does not mutate `base`, `current`, or `snapshot`."""
        result = dict(base)
        snap = snapshot if isinstance(snapshot, dict) else {}
        for key, cur_val in current.items():
            if key in snap and snap[key] == cur_val:
                continue  # unchanged by us — keep disk's (possibly newer) value
            base_val = result.get(key)
            if isinstance(cur_val, dict) and isinstance(base_val, dict):
                result[key] = cls._apply_changes(base_val, cur_val, snap.get(key))
            else:
                result[key] = cur_val
        # Propagate keys we removed since load (present in our load snapshot,
        # gone from current). Our removal wins over a concurrent edit, symmetric
        # with how our edits overlay theirs.
        for key in snap:
            if key not in current:
                result.pop(key, None)
        return result

    def _merge_for_save(self) -> Dict[str, Any]:
        """Build the dict to persist: a fresh on-disk read with only the
        changes this process made since load overlaid on top (recursively for
        nested dicts — see _apply_changes).

        Diffing against self._snapshot (what we loaded) rather than writing
        self._config wholesale is what prevents the lost update — a concurrent
        writer's unrelated keys, present in the fresh read but untouched by us,
        survive. Must be called under the file lock."""
        base = self._read_disk_for_merge()
        if base is None:
            # Missing / corrupt / non-dict on disk: write our own config
            # wholesale. Preserves the corrupt-file recovery semantics — a
            # set() after a corrupt load still lays down a valid file.
            return dict(self._config)
        return self._apply_changes(base, self._config, self._snapshot)

    def _save(self) -> bool:
        """Save configuration to disk without clobbering concurrent writers.

        The app spawns a fresh CLI subprocess per operation (no daemon), so two
        near-simultaneous writers each do load-whole-config -> mutate one key ->
        write-whole-file and silently revert each other's unrelated keys
        (classic lost update). _atomic_write_json fixes torn files but not this.

        Fix: under a cross-process file lock (filelock: fcntl on POSIX / msvcrt
        on Windows, auto-released if a holder crashes) re-read config.json fresh
        as the merge base and overlay only the top-level keys this process
        changed. On lock timeout, degrade to a plain unlocked atomic write of
        our own config — a stuck lock must never block saves or raise.
        """
        lock_path = str(self.config_path) + ".lock"
        try:
            # filelock is NOT reentrant: _save() must never be called while
            # already holding this lock (no current path does).
            with filelock.FileLock(lock_path, timeout=self._SAVE_LOCK_TIMEOUT):
                merged = self._merge_for_save()
                _atomic_write_json(self.config_path, merged)
                # Adopt the merged result so a second _save() in this process
                # diffs against what we just wrote, not the stale load snapshot.
                self._config = merged
                self._snapshot = copy.deepcopy(merged)
                logger.info(f"Saved config to {self.config_path}")
                return True
        except filelock.Timeout:
            logger.warning(
                f"Timed out acquiring config lock at {lock_path}; "
                f"falling back to an unlocked atomic write"
            )
            try:
                _atomic_write_json(self.config_path, self._config)
                # Keep the snapshot consistent with what we just wrote so a
                # later save on this instance diffs correctly.
                self._snapshot = copy.deepcopy(self._config)
                return True
            except Exception as e:
                logger.error(f"Error saving config: {e}")
                return False
        except Exception as e:
            logger.error(f"Error saving config: {e}")
            return False

    def _get_default_config(self) -> Dict[str, Any]:
        """Get default configuration."""
        return {
            "model": self.DEFAULT_MODEL,
            "notifications_enabled": True,
            "telemetry_enabled": True,
            # Default ON on macOS — CoreAudio Process Tap captures system
            # audio alongside the mic on macOS 14.4+. Older macOS auto-falls
            # back to mic-only via main.js's loadSystemAudioEnabled() OS gate.
            # Default OFF on Windows/Linux: the cross-platform loopback path
            # (electron-audio-loopback / Chromium WASAPI) works but is still
            # pending hardware verification, so it ships opt-in/experimental —
            # users enable it explicitly in Settings.
            "system_audio_enabled": sys.platform == "darwin",
            # Default ON — surfaces a "Meeting detected" notification when
            # any non-Steno app starts capturing the mic. Helper is gated
            # to macOS 14+ in main.js; users can flip off in Settings.
            "auto_detect_meetings_enabled": True,
            "language": "en",
            "ai_provider": "local",
            "remote_ollama_url": "",
            "cloud_api_url": "",
            "cloud_provider": "openai",
            "cloud_model": "gpt-4o-mini",
            "anonymous_id": str(uuid.uuid4()),
            "storage_path": "",
            "keep_recordings": False,
            "whisper_model": "large-v3-turbo",
            "transcription_engine": "parakeet",
            "version": "1.0"
        }

    def get_storage_path(self) -> str:
        """Get the custom storage path. Empty string means use default."""
        return self._config.get("storage_path", "")

    def set_storage_path(self, storage_path: str) -> bool:
        """
        Set custom storage path for recordings/transcripts/output.

        Args:
            storage_path: Absolute path to storage directory, or empty string to reset to default.

        Returns:
            True if saved successfully, False otherwise.
        """
        if storage_path is None:
            storage_path = ""
        storage_path = storage_path.strip()

        if storage_path:
            sp = Path(storage_path)
            if not sp.is_absolute():
                logger.error(f"Storage path must be absolute: {storage_path}")
                return False
            # Create subdirectories at the new location. If this fails
            # (for example due to permissions), keep existing config unchanged.
            try:
                for subdir in ("recordings", "transcripts", "output"):
                    (sp / subdir).mkdir(parents=True, exist_ok=True)
            except Exception as e:
                logger.error(f"Failed to initialize storage path {storage_path}: {e}")
                return False

        self._config["storage_path"] = storage_path
        return self._save()

    def get_model(self) -> str:
        """Get the configured model name."""
        return self._config.get("model", self.DEFAULT_MODEL)

    def set_model(self, model_name: str) -> bool:
        """
        Set the model to use for summarization.

        Args:
            model_name: Name of the model (e.g., "llama3.1:8b")

        Returns:
            True if saved successfully, False otherwise
        """
        # Validate model name
        if model_name not in self.SUPPORTED_MODELS:
            logger.warning(f"Model {model_name} not in supported list, but allowing anyway")

        self._config["model"] = model_name
        return self._save()

    # --- Report templates ---------------------------------------------------
    def _normalize_templates(self) -> None:
        """Coerce persisted template state into the shapes the CRUD/merge code
        assumes — on EVERY load, not gated behind `templates_seeded`.

        A malformed-but-parseable config (`custom_templates` as a non-list or a
        list with non-dict entries, or `template_overrides` as a non-dict) would
        otherwise survive past first-run seeding and crash later template reads
        (`merge_templates`) and writes (`save_template`/`delete_template`). The
        repair is in-memory; it persists on the next `_save()`.
        """
        if self._load_failed:
            return
        custom_raw = self._config.get("custom_templates", [])
        self._config["custom_templates"] = (
            [t for t in custom_raw if isinstance(t, dict)]
            if isinstance(custom_raw, list)
            else []
        )
        overrides_raw = self._config.get("template_overrides")
        self._config["template_overrides"] = (
            {k: v for k, v in overrides_raw.items() if isinstance(v, dict)}
            if isinstance(overrides_raw, dict)
            else {}
        )

    def _seed_sample_template(self) -> None:
        """Seed the editable 'Shareable summary' sample once, on fresh configs.

        Guarded by `templates_seeded` so deleting the sample doesn't re-add it.
        Assumes `_normalize_templates` has already coerced `custom_templates`
        into a list of dicts.
        """
        if self._load_failed:
            return
        if self._config.get("templates_seeded"):
            return
        custom = self._config.setdefault("custom_templates", [])
        if not any(t.get("id") == _templates.SAMPLE_TEMPLATE["id"] for t in custom):
            custom.append(dict(_templates.SAMPLE_TEMPLATE))
        self._config["templates_seeded"] = True
        self._save()

    def get_templates(self) -> list:
        """Merged template list: built-ins (with overrides) then custom."""
        return _templates.merge_templates(
            overrides=self._config.get("template_overrides", {}) or {},
            custom=self._config.get("custom_templates", []) or [],
        )

    def get_template(self, template_id: str) -> Optional[dict]:
        """Return the template with the given id, or None if not found."""
        return next((t for t in self.get_templates() if t["id"] == template_id), None)

    def get_default_template_id(self) -> str:
        return self._config.get("default_template_id", _templates.STANDARD_TEMPLATE_ID)

    def set_default_template(self, template_id: str) -> bool:
        if template_id not in {t["id"] for t in self.get_templates()}:
            logger.error(f"Unknown template id: {template_id}")
            return False
        self._config["default_template_id"] = template_id
        return self._save()

    def save_template(self, t: dict) -> tuple:
        """Upsert a template. Returns (ok, error, saved_template)."""
        if not isinstance(t, dict):
            return False, "Invalid template payload", {}
        valid_langs = set(self.SUPPORTED_LANGUAGES.keys()) | {"auto"}
        ok, err = _templates.validate_template(t, valid_langs)
        if not ok:
            return False, err, {}

        tid = t.get("id")
        # Built-in id -> store as an override (Standard is locked: no prompt edit).
        if tid in _templates.BUILTIN_TEMPLATES:
            if _templates.BUILTIN_TEMPLATES[tid].get("locked"):
                return False, "This template is locked and cannot be edited", {}
            overrides = self._config.setdefault("template_overrides", {})
            overrides[tid] = {k: t[k] for k in ("name", "icon", "prompt", "language") if k in t}
            if not self._save():
                return False, "Failed to save config", {}
            return True, "", {**_templates.BUILTIN_TEMPLATES[tid], **overrides[tid]}

        custom = self._config.setdefault("custom_templates", [])
        existing = next((c for c in custom if c.get("id") == tid), None)
        if existing is not None:
            existing.update({k: t[k] for k in ("name", "icon", "prompt", "language", "format")
                             if k in t})
            saved = dict(existing)
        else:
            new_id = _templates.new_template_id(
                t["name"], {c.get("id") for c in custom} | set(_templates.BUILTIN_TEMPLATES)
            )
            saved = {
                "id": new_id,
                "name": t["name"],
                "icon": t.get("icon", "doc"),
                "prompt": t["prompt"],
                "language": t.get("language", "auto"),
                "format": t.get("format", "markdown"),
            }
            custom.append(saved)
        if not self._save():
            return False, "Failed to save config", {}
        return True, "", dict(saved)

    def delete_template(self, template_id: str) -> bool:
        custom = self._config.get("custom_templates", [])
        remaining = [c for c in custom if c.get("id") != template_id]
        if len(remaining) == len(custom):
            return False  # not a custom template (or doesn't exist)
        self._config["custom_templates"] = remaining
        if self._config.get("default_template_id") == template_id:
            self._config["default_template_id"] = _templates.STANDARD_TEMPLATE_ID
        return self._save()

    def reset_template(self, template_id: str) -> bool:
        overrides = self._config.get("template_overrides", {})
        if template_id not in overrides:
            return True  # already at shipped default — no-op success
        del overrides[template_id]
        return self._save()

    def get_model_info(self, model_name: str) -> Optional[Dict[str, str]]:
        """
        Get metadata about a specific model.

        Args:
            model_name: Name of the model

        Returns:
            Dictionary with model metadata or None if not found
        """
        return self.SUPPORTED_MODELS.get(model_name)

    def list_supported_models(self) -> Dict[str, Dict[str, str]]:
        """Get all supported models with their metadata."""
        return self.SUPPORTED_MODELS.copy()

    def get_notifications_enabled(self) -> bool:
        """Get whether desktop notifications are enabled."""
        return self._config.get("notifications_enabled", True)

    def set_notifications_enabled(self, enabled: bool) -> bool:
        """
        Set whether desktop notifications are enabled.

        Args:
            enabled: True to enable notifications, False to disable

        Returns:
            True if saved successfully, False otherwise
        """
        self._config["notifications_enabled"] = enabled
        return self._save()

    def get_telemetry_enabled(self) -> bool:
        """Get whether anonymous usage analytics are enabled."""
        return self._config.get("telemetry_enabled", True)

    def set_telemetry_enabled(self, enabled: bool) -> bool:
        """
        Set whether anonymous usage analytics are enabled.

        Args:
            enabled: True to enable telemetry, False to disable

        Returns:
            True if saved successfully, False otherwise
        """
        self._config["telemetry_enabled"] = enabled
        return self._save()

    def get_hide_dock_icon(self) -> bool:
        """Get whether the dock icon should be hidden (menu bar only mode)."""
        return self._config.get("hide_dock_icon", False)

    def set_hide_dock_icon(self, enabled: bool) -> bool:
        """
        Set whether the dock icon should be hidden.

        Args:
            enabled: True to hide dock icon (menu bar only), False to show

        Returns:
            True if saved successfully, False otherwise
        """
        self._config["hide_dock_icon"] = enabled
        return self._save()

    def get_org_auto_backup_enabled(self) -> bool:
        """Get whether new notes should auto-upload to the org adapter (S3)
        once summarization finishes. Only takes effect when the user is signed
        in to the enterprise adapter."""
        return self._config.get("org_auto_backup_enabled", True)

    def set_org_auto_backup_enabled(self, enabled: bool) -> bool:
        self._config["org_auto_backup_enabled"] = enabled
        return self._save()

    def seed_org_auto_backup_default(self, default: bool) -> bool:
        """Seed the auto-backup preference from the enterprise adapter's
        `auto_share_default` policy, but ONLY if the user has no stored
        preference yet. This is the "set the default only" contract: the
        org decides the initial on/off state for a brand-new user, after
        which any explicit toggle by the user wins and is never clobbered
        by a later sign-in. Returns the effective value."""
        if "org_auto_backup_enabled" not in self._config:
            self._config["org_auto_backup_enabled"] = bool(default)
            self._save()
        return self._config["org_auto_backup_enabled"]


    def get_keep_recordings(self) -> bool:
        """Get whether audio recordings should be kept after processing."""
        return self._config.get("keep_recordings", False)

    def set_keep_recordings(self, enabled: bool) -> bool:
        """Set whether audio recordings should be kept after processing."""
        self._config["keep_recordings"] = enabled
        return self._save()

    def get_silence_auto_stop_enabled(self) -> bool:
        """Get whether recordings auto-stop after a stretch of silence on
        both the mic and system-audio streams. Default on — the primary
        use case is "I forgot to stop a meeting" where doing nothing
        leaves a multi-hour zombie recording."""
        return self._config.get("silence_auto_stop_enabled", True)

    def set_silence_auto_stop_enabled(self, enabled: bool) -> bool:
        self._config["silence_auto_stop_enabled"] = enabled
        return self._save()

    SUPPORTED_SILENCE_AUTO_STOP_MINUTES = (2, 5, 10, 15, 30)

    def get_silence_auto_stop_minutes(self) -> int:
        """Minutes of bilateral silence before auto-stop fires. Default 15
        to match the Granola convention; constrained to the supported set
        so the Settings dropdown stays in sync with persisted values."""
        value = self._config.get("silence_auto_stop_minutes", 15)
        if value in self.SUPPORTED_SILENCE_AUTO_STOP_MINUTES:
            return value
        logger.warning(
            f"Invalid silence_auto_stop_minutes in config: {value}; falling back to 15"
        )
        return 15

    def set_silence_auto_stop_minutes(self, minutes: int) -> bool:
        if minutes not in self.SUPPORTED_SILENCE_AUTO_STOP_MINUTES:
            return False
        self._config["silence_auto_stop_minutes"] = minutes
        return self._save()


    def get_transcription_engine(self) -> str:
        """Return the active ASR engine ('parakeet' or 'whisper').

        Falls back to 'parakeet' for unknown values. The renderer's
        Settings → Transcribe tab writes this; the live VAD pipeline reads
        it to pick which transcribe_samples() implementation to import.
        """
        value = self._config.get("transcription_engine", "parakeet")
        return value if value in self.VALID_TRANSCRIPTION_ENGINES else "parakeet"

    def set_transcription_engine(self, engine: str) -> bool:
        """Persist the active ASR engine. Validates against
        VALID_TRANSCRIPTION_ENGINES."""
        if engine not in self.VALID_TRANSCRIPTION_ENGINES:
            logger.error(
                f"Invalid transcription engine: {engine}. "
                f"Must be one of {self.VALID_TRANSCRIPTION_ENGINES}"
            )
            return False
        self._config["transcription_engine"] = engine
        return self._save()

    def get_whisper_model(self) -> str:
        """Get the configured Whisper model size."""
        model = self._config.get("whisper_model", "large-v3-turbo")
        if model not in self.SUPPORTED_WHISPER_MODELS:
            logger.warning(f"Invalid Whisper model in config: {model}; falling back to large-v3-turbo")
            return "large-v3-turbo"
        return model

    def set_whisper_model(self, model_size: str) -> bool:
        """Set the Whisper model size."""
        if model_size not in self.SUPPORTED_WHISPER_MODELS:
            logger.error(f"Unsupported Whisper model: {model_size}")
            return False
        self._config["whisper_model"] = model_size
        return self._save()

    def get_system_audio_enabled(self) -> bool:
        """Get whether system audio capture is enabled."""
        return self._config.get("system_audio_enabled", True)

    def set_system_audio_enabled(self, enabled: bool) -> bool:
        """
        Set whether system audio capture is enabled.

        Args:
            enabled: True to enable system audio capture, False to disable

        Returns:
            True if saved successfully, False otherwise
        """
        self._config["system_audio_enabled"] = enabled
        return self._save()

    def get_auto_detect_meetings_enabled(self) -> bool:
        """Get whether auto-detect meetings is enabled."""
        return self._config.get("auto_detect_meetings_enabled", True)

    def set_auto_detect_meetings_enabled(self, enabled: bool) -> bool:
        """Set whether auto-detect meetings is enabled."""
        self._config["auto_detect_meetings_enabled"] = enabled
        return self._save()

    def get_language(self) -> str:
        """Get the configured language code for transcription and summarization."""
        return self._config.get("language", "en")

    def set_language(self, language_code: str) -> bool:
        """
        Set the language for transcription and summarization.

        Args:
            language_code: Language code (e.g., "en", "de", "auto")

        Returns:
            True if saved successfully, False otherwise
        """
        if language_code not in self.SUPPORTED_LANGUAGES:
            logger.error(f"Unsupported language code: {language_code}")
            return False

        self._config["language"] = language_code
        return self._save()

    def get_language_name(self, language_code: Optional[str] = None) -> str:
        """Get the display name for a language code."""
        if language_code is None:
            language_code = self.get_language()
        return (
            self.SUPPORTED_LANGUAGES.get(language_code)
            or self._LANGUAGE_NAMES.get(language_code)
            or (language_code.upper() if language_code else "Unknown")
        )

    # --- AI provider settings ---

    VALID_AI_PROVIDERS = ("local", "remote", "cloud", "adapter")
    VALID_CLOUD_PROVIDERS = ("openai", "anthropic", "bedrock", "custom")

    # AWS Bedrock has ~30 regions; we surface the common ones in the UI but
    # accept any value as set_bedrock_region trusts the caller. Defaulting to
    # us-east-1 because that's where new Bedrock features land first and the
    # widest model selection lives.
    DEFAULT_BEDROCK_REGION = "us-east-1"

    # Claude on Bedrock — curated dropdown for the Settings UI. Bedrock model
    # IDs are versioned (`:0`, `:1`, …) and prefixed with the model provider
    # (`anthropic.`); cross-region inference profiles override these at call
    # time when set. Keep this list small and current; users who want a model
    # not on the list can paste it into the "Custom…" entry.
    SUPPORTED_BEDROCK_MODELS = (
        "anthropic.claude-sonnet-4-5-20250929-v2:0",
        "anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-opus-4-1-20250805-v1:0",
        "anthropic.claude-3-5-sonnet-20241022-v2:0",
        "anthropic.claude-3-5-haiku-20241022-v1:0",
    )

    def get_ai_provider(self) -> str:
        """Get the configured AI provider ('local', 'remote', 'cloud', or
        'adapter'). 'adapter' routes AI requests through a signed-in org's
        adapter so the desktop never sees the provider key — see
        get_adapter_url / get_adapter_token below for how the desktop's
        Electron main passes the session into the Python subprocess."""
        value = self._config.get("ai_provider", "local")
        return value if value in self.VALID_AI_PROVIDERS else "local"

    def set_ai_provider(self, provider: str) -> bool:
        """Set the AI provider mode."""
        if provider not in self.VALID_AI_PROVIDERS:
            logger.error(f"Invalid AI provider: {provider}. Must be one of {self.VALID_AI_PROVIDERS}")
            return False
        self._config["ai_provider"] = provider
        return self._save()

    def get_remote_ollama_url(self) -> str:
        """Get the remote Ollama server URL."""
        return self._config.get("remote_ollama_url", "")

    def set_remote_ollama_url(self, url: str) -> bool:
        """Set the remote Ollama server URL."""
        self._config["remote_ollama_url"] = url.strip()
        return self._save()

    def get_cloud_api_url(self) -> str:
        """Get the cloud API URL."""
        return self._config.get("cloud_api_url", "")

    def set_cloud_api_url(self, url: str) -> bool:
        """Set the cloud API URL."""
        self._config["cloud_api_url"] = url.strip()
        return self._save()

    def get_cloud_api_key(self) -> str:
        """Get the cloud API key from env var (set by Electron via safeStorage)."""
        import os
        return os.environ.get("STENOAI_CLOUD_API_KEY", "")

    def get_adapter_url(self) -> str:
        """Get the org adapter base URL (set by Electron when a session is
        active). The summariser uses this when ai_provider == 'adapter' to
        route AI requests through the customer's adapter instead of touching
        a provider key directly."""
        import os
        return os.environ.get("STENOAI_ADAPTER_URL", "").rstrip("/")

    def get_adapter_token(self) -> str:
        """Get the org adapter JWT (set by Electron from the persisted session)."""
        import os
        return os.environ.get("STENOAI_ADAPTER_TOKEN", "")

    # Per-provider sensible defaults. Used when the user switches provider for
    # the first time and we have no remembered model for that provider yet.
    CLOUD_MODEL_DEFAULTS = {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-haiku-4-5-20251001",
        "bedrock": "anthropic.claude-haiku-4-5-20251001-v1:0",
        "custom": "gpt-4o-mini",
    }

    def get_cloud_provider(self) -> str:
        """Get the cloud provider type. One of VALID_CLOUD_PROVIDERS; falls
        back to 'openai' for unknown values (e.g. config from a future
        version with a provider this build doesn't know about)."""
        value = self._config.get("cloud_provider", "openai")
        return value if value in self.VALID_CLOUD_PROVIDERS else "openai"

    # --- Bedrock-specific knobs ---
    # Stored as plain config (not env-var-secret like the API key) because
    # region + inference profile are not credentials. The API key still
    # flows through STENOAI_CLOUD_API_KEY exactly like the other providers.

    def get_bedrock_region(self) -> str:
        """AWS region used as the Bedrock endpoint host. Defaults to us-east-1
        when unset. Cross-region inference profiles override which regions
        actually serve traffic but the request still has to land somewhere."""
        value = self._config.get("bedrock_region")
        if not isinstance(value, str) or not value.strip():
            return self.DEFAULT_BEDROCK_REGION
        return value.strip()

    def set_bedrock_region(self, region: str) -> bool:
        """Persist the AWS region. Accepts any non-empty string — Bedrock
        validates the region on the wire, so a typo surfaces as a clear
        404 / DNS error at request time rather than silently here."""
        cleaned = (region or "").strip()
        if not cleaned:
            logger.error("Bedrock region cannot be empty")
            return False
        self._config["bedrock_region"] = cleaned
        return self._save()

    def get_bedrock_inference_profile(self) -> str:
        """Optional cross-region inference profile ID, e.g.
        'us.anthropic.claude-haiku-4-5-20251001-v1:0'. When set this is used
        as the modelId in the Converse URL path so Bedrock routes the
        request across the profile's regions instead of pinning to one.
        Empty means 'use the bare model id'.

        Stripped on read so a whitespace-only stored value (e.g. from a
        hand-edited config.json) doesn't survive the `target = profile or
        model_id` check in _bedrock_chat and produce a URL with `%20`s in
        place of the model id."""
        value = self._config.get("bedrock_inference_profile", "")
        if not isinstance(value, str):
            return ""
        return value.strip()

    def set_bedrock_inference_profile(self, profile: str) -> bool:
        """Persist the inference profile. Empty string clears it — equivalent
        to 'use the bare model id'."""
        self._config["bedrock_inference_profile"] = (profile or "").strip()
        return self._save()

    def set_cloud_provider(self, provider: str) -> bool:
        """Set the cloud provider type."""
        if provider not in self.VALID_CLOUD_PROVIDERS:
            logger.error(f"Invalid cloud provider: {provider}. Must be one of {self.VALID_CLOUD_PROVIDERS}")
            return False
        self._config["cloud_provider"] = provider
        return self._save()

    def _get_cloud_models_map(self) -> dict:
        """Per-provider model store. Migration is handled in __init__ so this
        just returns the dict (or empty)."""
        models = self._config.get("cloud_models")
        if not isinstance(models, dict):
            models = {}
            self._config["cloud_models"] = models
        return models

    def get_cloud_model(self) -> str:
        """Get the cloud model for the currently selected provider. Each
        provider has its own remembered model so switching providers doesn't
        carry an incompatible model name across (e.g. a Claude model into
        OpenAI). Falls back to the per-provider default on first use."""
        provider = self.get_cloud_provider()
        models = self._get_cloud_models_map()
        if provider in models and isinstance(models[provider], str) and models[provider].strip():
            return models[provider]
        return self.CLOUD_MODEL_DEFAULTS.get(provider, "gpt-4o-mini")

    def set_cloud_model(self, model: str) -> bool:
        """Set the cloud model for the currently selected provider."""
        provider = self.get_cloud_provider()
        models = self._get_cloud_models_map()
        models[provider] = model.strip()
        self._config["cloud_models"] = models
        # Mirror to legacy 'cloud_model' so any code still reading the flat
        # field sees the active provider's choice. Safe to remove once no
        # consumers reference it.
        self._config["cloud_model"] = model.strip()
        return self._save()

    def get_user_name(self) -> str:
        """Get the user's first name (for greetings). Empty string when unset."""
        value = self._config.get("user_name")
        if not isinstance(value, str):
            return ""
        return value.strip()

    def set_user_name(self, name: str) -> bool:
        """Persist the user's first name. Trims whitespace; an empty name
        clears the field."""
        cleaned = (name or "").strip()
        # Cap to a sane length so a paste of someone's whole bio doesn't end
        # up in the greeting.
        if len(cleaned) > 60:
            cleaned = cleaned[:60]
        self._config["user_name"] = cleaned
        return self._save()

    def get_anonymous_id(self) -> str:
        """Get the anonymous telemetry ID, generating one if missing."""
        anon_id = self._config.get("anonymous_id")
        if not anon_id:
            anon_id = str(uuid.uuid4())
            self._config["anonymous_id"] = anon_id
            self._save()
        return anon_id

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self._config.get(key, default)

    def set(self, key: str, value: Any) -> bool:
        """Set a configuration value and save."""
        self._config[key] = value
        return self._save()


# Global config instance
_config_instance: Optional[Config] = None


def get_config() -> Config:
    """Get the global config instance (singleton pattern)."""
    global _config_instance
    if _config_instance is None:
        _config_instance = Config()
    return _config_instance


def get_data_dirs() -> Dict[str, Path]:
    """
    Centralised path resolution for recordings, transcripts, and output.

    Returns dict with keys: recordings, transcripts, output.
    Uses custom storage_path from config if set, otherwise falls back to
    the per-OS user data dir (see get_user_data_dir) when bundled, or the
    repo root when running from source.
    """
    config = get_config()
    custom = config.get_storage_path()

    if os.environ.get("STENOAI_USER_DATA_DIR"):
        # Keystone: the e2e isolation dir is the hardest override — it must beat
        # a user's custom storage_path too, so a test can never escape the temp
        # dir to a real configured recordings/transcripts location.
        base = get_user_data_dir()
    elif custom:
        base = Path(custom)
    elif is_bundled():
        base = get_user_data_dir()
    else:
        base = Path(__file__).parent.parent  # project root in dev (source)

    dirs = {
        "recordings": base / "recordings",
        "transcripts": base / "transcripts",
        "output": base / "output",
    }

    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)

    return dirs


def resolve_runtime_tag(model_id: str) -> str:
    """Map a canonical GGUF model id to its NVFP4/MLX-engine tag on Apple
    Silicon; a no-op everywhere else (including for models with no MLX
    equivalent, e.g. llama3.2:3b).

    This is the ONLY place a GGUF id is ever translated to an NVFP4 tag.
    config.json, SUPPORTED_MODELS, and every migration/validation path keep
    using the canonical GGUF id — callers must call this at the point a
    literal Ollama model string is about to be sent, not before.
    """
    if not is_apple_silicon():
        return model_id
    return Config._MLX_EQUIVALENTS.get(model_id, model_id)
