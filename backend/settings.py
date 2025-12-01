"""
Runtime settings management for LLM Council.
Allows updating configuration (like API keys) without restarting the container.
"""
import json
import os
from pathlib import Path
from typing import Optional, Dict, Any

# Config directory - defaults to data/config in Docker
CONFIG_DIR = Path(os.getenv("CONFIG_DIR", "data/config"))
SETTINGS_FILE = CONFIG_DIR / "settings.json"


def ensure_config_dir():
    """Ensure the config directory exists."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_settings() -> Dict[str, Any]:
    """Load settings from file."""
    ensure_config_dir()

    if not SETTINGS_FILE.exists():
        return {}

    try:
        return json.loads(SETTINGS_FILE.read_text())
    except (json.JSONDecodeError, IOError):
        return {}


def save_settings(settings: Dict[str, Any]) -> None:
    """Save settings to file."""
    ensure_config_dir()
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2))


def get_openrouter_api_key() -> Optional[str]:
    """
    Get OpenRouter API key.
    Priority: settings file > environment variable
    """
    settings = load_settings()

    # Check settings file first (allows runtime updates)
    if settings.get("openrouter_api_key"):
        return settings["openrouter_api_key"]

    # Fall back to environment variable
    return os.getenv("OPENROUTER_API_KEY")


def set_openrouter_api_key(api_key: str) -> None:
    """Set OpenRouter API key in settings file."""
    settings = load_settings()
    settings["openrouter_api_key"] = api_key
    save_settings(settings)


def get_setting(key: str, default: Any = None) -> Any:
    """Get a specific setting."""
    settings = load_settings()
    return settings.get(key, default)


def set_setting(key: str, value: Any) -> None:
    """Set a specific setting."""
    settings = load_settings()
    settings[key] = value
    save_settings(settings)


def has_api_key_configured() -> bool:
    """Check if an API key is configured (either in settings or env)."""
    return get_openrouter_api_key() is not None


def get_api_key_source() -> str:
    """Return where the API key is coming from."""
    settings = load_settings()
    if settings.get("openrouter_api_key"):
        return "settings"
    if os.getenv("OPENROUTER_API_KEY"):
        return "environment"
    return "none"
