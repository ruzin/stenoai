"""
Configuration management for StenoAI.

Handles storing and loading user preferences like model selection.
"""

import json
import logging
import os
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional, Dict, Any

from src.whisper_models import SUPPORTED_WHISPER_MODELS as _WHISPER_REGISTRY

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


class Config:
    """Manages application configuration with file persistence."""

    DEFAULT_MODEL = "llama3.2:3b"

    # Supported models with metadata (organized by parameter size, ascending)
    SUPPORTED_MODELS = {
        "llama3.2:3b": {
            "name": "Llama 3.2 3B",
            "size": "2GB",
            "params": "3B",
            "description": "Fast and lightweight for quick meetings (default)",
            "speed": "very fast",
            "quality": "good"
        },
        "gemma3:4b": {
            "name": "Gemma 3 4B",
            "size": "2.5GB",
            "params": "4B",
            "description": "Lightweight and efficient",
            "speed": "fast",
            "quality": "good"
        },
        "qwen3.5:9b": {
            "name": "Qwen 3.5 9B",
            "size": "6.6GB",
            "params": "9B",
            "description": "Excellent at structured output and action items",
            "speed": "medium",
            "quality": "excellent"
        },
        "deepseek-r1:14b": {
            "name": "DeepSeek R1 14B",
            "size": "9.0GB",
            "params": "14B",
            "description": "Strong reasoning and analysis capabilities",
            "speed": "fast",
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
        "qwen3:8b": {
            "name": "Qwen 3 8B",
            "size": "4.7GB",
            "params": "8B",
            "description": "Replaced by Qwen 3.5 9B",
            "speed": "fast",
            "quality": "excellent",
            "deprecated": True
        },
        "deepseek-r1:8b": {
            "name": "DeepSeek R1 8B",
            "size": "4.7GB",
            "params": "8B",
            "description": "Replaced by DeepSeek R1 14B",
            "speed": "medium",
            "quality": "excellent",
            "deprecated": True
        }
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
            if is_bundled():
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
        self._migrate_cloud_model_map()
        self._migrate_whisper_model()
        self._migrate_transcription_engine()

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
        """Map any out-of-current-list whisper model to a supported one.

        - 'large' (invalid pywhispercpp name — crashes the native loader) →
          'large-v3-turbo' (closest current-list match).
        - Any other previously-supported but now-retired tier
          (tiny/base/medium/large-v3) → 'small' (the safe default).
        """
        if self._load_failed:
            return  # never persist defaults over a corrupt-but-recoverable file
        current = self._config.get("whisper_model")
        if current is None or current in self.SUPPORTED_WHISPER_MODELS:
            return
        if current == "large":
            self._config["whisper_model"] = "large-v3-turbo"
        else:
            self._config["whisper_model"] = "small"
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

    def _save(self) -> bool:
        """Save configuration to file (atomic tempfile + os.replace)."""
        try:
            _atomic_write_json(self.config_path, self._config)
            logger.info(f"Saved config to {self.config_path}")
            return True
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
            "whisper_model": "small",
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
        model = self._config.get("whisper_model", "small")
        if model not in self.SUPPORTED_WHISPER_MODELS:
            logger.warning(f"Invalid Whisper model in config: {model}; falling back to small")
            return "small"
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

    if custom:
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
