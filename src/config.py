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

    # Supported models with metadata (organized by parameter size, ascending)
    SUPPORTED_MODELS = {
        "llama3.2:3b": {
            "name": "Llama 3.2 3B",
            "size": "2GB",
            "params": "3B",
            "description": "Fastest option for quick meetings (default)",
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
        "qwen3:8b": {
            "name": "Qwen 3 8B",
            "size": "4.7GB",
            "params": "8B",
            "description": "Excellent at structured output and action items",
            "speed": "fast",
            "quality": "excellent"
        },
        "deepseek-r1:8b": {
            "name": "DeepSeek R1 8B",
            "size": "4.7GB",
            "params": "8B",
            "description": "Strong reasoning and analysis capabilities",
            "speed": "medium",
            "quality": "excellent"
        }
    }

    # Supported languages for transcription and summarization
    SUPPORTED_LANGUAGES = {
        "en": "English",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "pt": "Portuguese",
        "ja": "Japanese",
        "zh": "Chinese",
        "ko": "Korean",
        "hi": "Hindi",
        "ar": "Arabic",
    }

    def __init__(self, config_path: Optional[Path] = None):
        """
        Initialize configuration manager.

        Args:
            config_path: Path to config file. If None, uses default location.
        """
        if config_path is None:
            # Use same directory logic as recorder state
            if "StenoAI.app" in str(Path(__file__)) or "Applications" in str(Path(__file__)):
                # Production: ~/Library/Application Support/stenoai
                base_dir = Path.home() / "Library" / "Application Support" / "stenoai"
            else:
                # Development: project root
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
            "anonymous_id": str(uuid.uuid4()),
            "storage_path": "",
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
        storage_path = storage_path.strip()

        if storage_path:
            sp = Path(storage_path)
            if not sp.is_absolute():
                logger.error(f"Storage path must be absolute: {storage_path}")
                return False
            # Create subdirectories at the new location
            for subdir in ("recordings", "transcripts", "output"):
                (sp / subdir).mkdir(parents=True, exist_ok=True)

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
        return self.SUPPORTED_LANGUAGES.get(language_code, "Unknown")

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

    if custom:
        base = Path(custom)
    elif "StenoAI.app" in str(Path(__file__)) or "Applications" in str(Path(__file__)):
        base = Path.home() / "Library" / "Application Support" / "stenoai"
    else:
        base = Path(__file__).parent.parent  # project root in dev

    dirs = {
        "recordings": base / "recordings",
        "transcripts": base / "transcripts",
        "output": base / "output",
    }

    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)

    return dirs
