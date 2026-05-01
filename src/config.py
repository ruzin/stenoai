"""
Configuration management for StenoAI.

Handles storing and loading user preferences like model selection.
"""

import json
import logging
import uuid
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class Config:
    """Manages application configuration with file persistence."""

    DEFAULT_MODEL = "llama3.2:3b"

    # HuggingFace GGUF mirrors for each supported model. Used as a fallback
    # when registry.ollama.ai is blocked (corporate VPNs, locked-down networks).
    # The huggingface.co host is more commonly reachable than registry.ollama.ai.
    # Only models with a verified bartowski (or equivalent) GGUF repo are listed;
    # models without an entry simply fail without fallback.
    HF_MIRRORS = {
        "llama3.2:3b": "hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M",
        "deepseek-r1:14b": "hf.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF:Q4_K_M",
        "gpt-oss:20b": "hf.co/bartowski/openai_gpt-oss-20b-GGUF:Q4_K_M",
        # NOTE: qwen3.5:9b and all gemma4 variants are deliberately omitted.
        # Both ship multimodal GGUFs (separate mmproj vision file) that
        # Ollama 0.17.x's runner can't load: pull succeeds but inference
        # returns 500 'unable to load model'. See
        # https://github.com/ollama/ollama/issues/14575 . Re-add when
        # upstream lands proper multimodal GGUF support.
        # NOTE: gemma3:4b deliberately omitted. The bartowski mirror trips
        # Ollama's auth-realm check (Gemma 3 is licence-gated and the HF
        # auth challenge points at huggingface.co while the original host
        # was hf.co). Needs HF token support to fix.
    }

    # Supported models with metadata (organized by parameter size, ascending).
    #
    # The ``backend`` field selects which local inference engine handles the
    # model. Default is ``"local-ollama"`` (the existing path). Models that
    # Ollama 0.17.x can't load — currently anything multimodal split-GGUF —
    # set ``backend = "local-llamacpp"`` and download directly from
    # HuggingFace via ``hf_repo`` + ``hf_filename``. The selection is
    # invisible to users; see ``Config.get_backend(model_id)``.
    SUPPORTED_MODELS = {
        "llama3.2:3b": {
            "name": "Llama 3.2 3B",
            "size": "2GB",
            "params": "3B",
            "description": "Fast and lightweight for quick meetings (default)",
            "speed": "very fast",
            "quality": "good",
            "backend": "local-ollama",
        },
        "gemma4:e2b": {
            "name": "Gemma 4 E2B",
            "size": "3.3GB",
            "params": "2.3B effective",
            "description": "Apache 2.0 multimodal (text-only mode in this app)",
            "speed": "fast",
            "quality": "good",
            "backend": "local-llamacpp",
            "hf_repo": "bartowski/google_gemma-4-E2B-it-GGUF",
            "hf_filename": "google_gemma-4-E2B-it-Q4_K_M.gguf",
        },
        "gemma4:e4b": {
            "name": "Gemma 4 E4B",
            "size": "5.5GB",
            "params": "4.5B effective",
            "description": "Larger Gemma 4 variant, better quality at ~5GB",
            "speed": "medium",
            "quality": "excellent",
            "backend": "local-llamacpp",
            "hf_repo": "bartowski/google_gemma-4-E4B-it-GGUF",
            "hf_filename": "google_gemma-4-E4B-it-Q4_K_M.gguf",
        },
        "qwen3.5:9b": {
            "name": "Qwen 3.5 9B",
            "size": "6.6GB",
            "params": "9B",
            "description": "Excellent at structured output and action items",
            "speed": "medium",
            "quality": "excellent",
            "backend": "local-llamacpp",
            "hf_repo": "bartowski/Qwen_Qwen3.5-9B-GGUF",
            "hf_filename": "Qwen_Qwen3.5-9B-Q4_K_M.gguf",
        },
        "deepseek-r1:14b": {
            "name": "DeepSeek R1 14B",
            "size": "9.0GB",
            "params": "14B",
            "description": "Strong reasoning and analysis capabilities",
            "speed": "fast",
            "quality": "excellent",
            "backend": "local-ollama",
        },
        "gpt-oss:20b": {
            "name": "GPT-OSS 20B",
            "size": "14GB",
            "params": "20B",
            "description": "OpenAI open-weight model with reasoning capabilities",
            "speed": "medium",
            "quality": "excellent",
            "backend": "local-ollama",
        },
        "gemma3:4b": {
            "name": "Gemma 3 4B",
            "size": "2.5GB",
            "params": "4B",
            "description": "Replaced by Gemma 4 E2B (Apache 2.0, no licence gate)",
            "speed": "fast",
            "quality": "good",
            "backend": "local-ollama",
            "deprecated": True,
        },
        "qwen3:8b": {
            "name": "Qwen 3 8B",
            "size": "4.7GB",
            "params": "8B",
            "description": "Replaced by Qwen 3.5 9B",
            "speed": "fast",
            "quality": "excellent",
            "backend": "local-ollama",
            "deprecated": True,
        },
        "deepseek-r1:8b": {
            "name": "DeepSeek R1 8B",
            "size": "4.7GB",
            "params": "8B",
            "description": "Replaced by DeepSeek R1 14B",
            "speed": "medium",
            "quality": "excellent",
            "backend": "local-ollama",
            "deprecated": True,
        },
    }

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

    def __init__(self, config_path: Optional[Path] = None):
        """
        Initialize configuration manager.

        Args:
            config_path: Path to config file. If None, uses default location.
        """
        if config_path is None:
            import sys as _sys
            if getattr(_sys, 'frozen', False) or "StenoAI.app" in str(Path(__file__)) or "Applications" in str(Path(__file__)):
                # Bundled (PyInstaller dev or production): ~/Library/Application Support/stenoai
                base_dir = Path.home() / "Library" / "Application Support" / "stenoai"
            else:
                # Source dev: project root
                base_dir = Path(__file__).parent.parent

            base_dir.mkdir(parents=True, exist_ok=True)
            self.config_path = base_dir / "config.json"
        else:
            self.config_path = config_path

        self._config: Dict[str, Any] = self._load()

    def _load(self) -> Dict[str, Any]:
        """Load configuration from file."""
        if not self.config_path.exists():
            logger.info(f"Config file not found, creating default at {self.config_path}")
            return self._get_default_config()

        try:
            with open(self.config_path, 'r') as f:
                config = json.load(f)
                logger.info(f"Loaded config from {self.config_path}")
                return config
        except Exception as e:
            logger.error(f"Error loading config: {e}, using defaults")
            return self._get_default_config()

    def _save(self) -> bool:
        """Save configuration to file."""
        try:
            with open(self.config_path, 'w') as f:
                json.dump(self._config, f, indent=2)
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
            "system_audio_enabled": False,
            "language": "en",
            "ai_provider": "local",
            "remote_ollama_url": "",
            "cloud_api_url": "",
            "cloud_provider": "openai",
            "cloud_model": "gpt-4o-mini",
            "anonymous_id": str(uuid.uuid4()),
            "storage_path": "",
            "resolved_pull_tags": {},
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

    @classmethod
    def get_backend(cls, model_name: str) -> str:
        """
        Return the local inference backend for a model: ``"local-ollama"``
        or ``"local-llamacpp"``. Defaults to ``local-ollama`` for unknown
        models so existing behaviour is preserved.
        """
        meta = cls.SUPPORTED_MODELS.get(model_name)
        if meta is None:
            return "local-ollama"
        return meta.get("backend", "local-ollama")

    @classmethod
    def get_hf_repo_filename(cls, model_name: str):
        """
        Return ``(hf_repo, hf_filename)`` for llamacpp-routed models.
        Returns ``(None, None)`` for any other model. The downloader uses
        these to build a ``huggingface.co/<repo>/resolve/main/<file>`` URL.
        """
        meta = cls.SUPPORTED_MODELS.get(model_name)
        if meta is None:
            return None, None
        return meta.get("hf_repo"), meta.get("hf_filename")

    @classmethod
    def get_hf_mirror(cls, model_name: str) -> Optional[str]:
        """Return the HuggingFace mirror tag for an internal model ID, or None."""
        return cls.HF_MIRRORS.get(model_name)

    @classmethod
    def get_pull_candidates(cls, model_name: str) -> list:
        """
        Return ordered list of Ollama tags to try when pulling/checking a model.
        Internal ID first, HF mirror second (if known).
        """
        candidates = [model_name]
        mirror = cls.HF_MIRRORS.get(model_name)
        if mirror and mirror not in candidates:
            candidates.append(mirror)
        return candidates

    def get_resolved_pull_tag(self, model_name: str) -> Optional[str]:
        """
        Get the actual Ollama tag a model was pulled as.
        When the registry pull fails and we fall back to the HF mirror, the model
        is tagged under the hf.co/... name. This stores that mapping so later
        ollama.chat / ollama.list lookups resolve correctly.
        """
        resolved = self._config.get("resolved_pull_tags", {}) or {}
        return resolved.get(model_name)

    def set_resolved_pull_tag(self, model_name: str, actual_tag: str) -> bool:
        """Persist the actual tag a model was pulled as."""
        resolved = self._config.get("resolved_pull_tags", {}) or {}
        resolved[model_name] = actual_tag
        self._config["resolved_pull_tags"] = resolved
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

    def get_system_audio_enabled(self) -> bool:
        """Get whether system audio capture is enabled."""
        return self._config.get("system_audio_enabled", False)

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

    VALID_AI_PROVIDERS = ("local", "remote", "cloud")
    VALID_CLOUD_PROVIDERS = ("openai", "anthropic", "custom")

    def get_ai_provider(self) -> str:
        """Get the configured AI provider ('local', 'remote', or 'cloud')."""
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

    def get_cloud_provider(self) -> str:
        """Get the cloud provider type ('openai' or 'custom')."""
        value = self._config.get("cloud_provider", "openai")
        return value if value in self.VALID_CLOUD_PROVIDERS else "openai"

    def set_cloud_provider(self, provider: str) -> bool:
        """Set the cloud provider type."""
        if provider not in self.VALID_CLOUD_PROVIDERS:
            logger.error(f"Invalid cloud provider: {provider}. Must be one of {self.VALID_CLOUD_PROVIDERS}")
            return False
        self._config["cloud_provider"] = provider
        return self._save()

    def get_cloud_model(self) -> str:
        """Get the cloud model name."""
        return self._config.get("cloud_model", "gpt-4o-mini")

    def set_cloud_model(self, model: str) -> bool:
        """Set the cloud model name."""
        self._config["cloud_model"] = model.strip()
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
    production (~/Library/Application Support/stenoai/) or development paths.
    """
    config = get_config()
    custom = config.get_storage_path()

    import sys as _sys
    if custom:
        base = Path(custom)
    elif getattr(_sys, 'frozen', False) or "StenoAI.app" in str(Path(__file__)) or "Applications" in str(Path(__file__)):
        base = Path.home() / "Library" / "Application Support" / "stenoai"
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
