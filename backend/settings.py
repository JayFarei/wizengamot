"""
Runtime settings management for LLM Council.
Allows updating configuration (like API keys) without restarting the container.
"""
import json
import os
from pathlib import Path
from typing import Optional, Dict, Any, List

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


# Default model pool - these are the models available for selection
DEFAULT_MODEL_POOL = [
    "openai/gpt-5.1",
    "google/gemini-3-pro-preview",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-4.1-fast",
    "moonshotai/kimi-k2-thinking",
]

DEFAULT_CHAIRMAN_MODEL = "google/gemini-3-pro-preview"


def get_model_pool() -> List[str]:
    """
    Get the available model pool.
    Priority: settings file > defaults
    """
    settings = load_settings()
    return settings.get("model_pool", DEFAULT_MODEL_POOL)


def set_model_pool(models: List[str]) -> None:
    """Set the available model pool in settings file."""
    settings = load_settings()
    settings["model_pool"] = models
    save_settings(settings)


def get_council_models() -> List[str]:
    """
    Get the default council models.
    Priority: settings file > model pool (all enabled by default)
    """
    settings = load_settings()
    return settings.get("council_models", get_model_pool())


def set_council_models(models: List[str]) -> None:
    """Set the default council models in settings file."""
    settings = load_settings()
    settings["council_models"] = models
    save_settings(settings)


def get_chairman_model() -> str:
    """
    Get the default chairman model.
    Priority: settings file > default
    """
    settings = load_settings()
    return settings.get("chairman_model", DEFAULT_CHAIRMAN_MODEL)


def set_chairman_model(model: str) -> None:
    """Set the default chairman model in settings file."""
    settings = load_settings()
    settings["chairman_model"] = model
    save_settings(settings)


def get_default_prompt() -> Optional[str]:
    """Get the default system prompt filename."""
    settings = load_settings()
    return settings.get("default_prompt")


def set_default_prompt(prompt_filename: Optional[str]) -> None:
    """Set the default system prompt filename."""
    settings = load_settings()
    if prompt_filename:
        settings["default_prompt"] = prompt_filename
    elif "default_prompt" in settings:
        del settings["default_prompt"]
    save_settings(settings)


# =============================================================================
# Synthesizer Settings
# =============================================================================

def get_firecrawl_api_key() -> Optional[str]:
    """
    Get Firecrawl API key.
    Priority: settings file > environment variable
    """
    settings = load_settings()
    if settings.get("firecrawl_api_key"):
        return settings["firecrawl_api_key"]
    return os.getenv("FIRECRAWL_API_KEY")


def set_firecrawl_api_key(api_key: str) -> None:
    """Set Firecrawl API key in settings file."""
    settings = load_settings()
    settings["firecrawl_api_key"] = api_key
    save_settings(settings)


def clear_firecrawl_api_key() -> None:
    """Clear Firecrawl API key from settings file."""
    settings = load_settings()
    if "firecrawl_api_key" in settings:
        del settings["firecrawl_api_key"]
    save_settings(settings)


def has_firecrawl_configured() -> bool:
    """Check if Firecrawl API key is configured."""
    return get_firecrawl_api_key() is not None


def get_firecrawl_source() -> str:
    """Return where the Firecrawl API key is coming from."""
    settings = load_settings()
    if settings.get("firecrawl_api_key"):
        return "settings"
    if os.getenv("FIRECRAWL_API_KEY"):
        return "environment"
    return "none"


DEFAULT_SYNTHESIZER_MODEL = "anthropic/claude-sonnet-4.5"


def get_synthesizer_model() -> str:
    """
    Get the default synthesizer model.
    Priority: settings file > default
    """
    settings = load_settings()
    return settings.get("synthesizer_model", DEFAULT_SYNTHESIZER_MODEL)


def set_synthesizer_model(model: str) -> None:
    """Set the default synthesizer model."""
    settings = load_settings()
    settings["synthesizer_model"] = model
    save_settings(settings)


def get_synthesizer_mode() -> str:
    """
    Get the synthesizer generation mode.
    Returns: 'single' or 'council'
    """
    settings = load_settings()
    return settings.get("synthesizer_mode", "single")


def set_synthesizer_mode(mode: str) -> None:
    """Set the synthesizer generation mode ('single' or 'council')."""
    if mode not in ("single", "council"):
        raise ValueError("Synthesizer mode must be 'single' or 'council'")
    settings = load_settings()
    settings["synthesizer_mode"] = mode
    save_settings(settings)


def get_synthesizer_prompt() -> Optional[str]:
    """Get the default synthesizer prompt filename."""
    settings = load_settings()
    return settings.get("synthesizer_prompt", "summarizer.md")


def set_synthesizer_prompt(prompt_filename: Optional[str]) -> None:
    """Set the default synthesizer prompt filename."""
    settings = load_settings()
    if prompt_filename:
        settings["synthesizer_prompt"] = prompt_filename
    elif "synthesizer_prompt" in settings:
        del settings["synthesizer_prompt"]
    save_settings(settings)
