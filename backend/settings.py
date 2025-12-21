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


# =============================================================================
# Visualiser Settings
# =============================================================================

DEFAULT_VISUALISER_MODEL = "google/gemini-2.5-flash-image"


def get_visualiser_model() -> str:
    """
    Get the default visualiser model.
    Priority: settings file > default
    """
    settings = load_settings()
    return settings.get("visualiser_model", DEFAULT_VISUALISER_MODEL)


def set_visualiser_model(model: str) -> None:
    """Set the default visualiser model."""
    settings = load_settings()
    settings["visualiser_model"] = model
    save_settings(settings)


# Default diagram styles - these are the initial styles available
DEFAULT_DIAGRAM_STYLES = {
    "bento": {
        "name": "Bento",
        "description": "Modular dashboard layout with cards",
        "prompt": """Create an infographic for the context below.
Creative process:
- First, identify the key pieces of information, concepts, or data points in this content. What are the distinct chunks that can each live in their own card or widget? How do they relate to each other?
Visual approach:
- Bento overview layout: modular cards and widgets arranged in a grid
- Each card contains one piece of information — a concept, a fact, a label, a small visualization
- Mix of card sizes: some large/hero, some small/supporting
- Clean, modern UI aesthetic — rounded corners, subtle shadows, clear hierarchy
- Typography-forward: key words and concepts displayed prominently, large and bold
- Color palette: dark mode (dark background, colored cards) — cohesive and considered
- Can include simple icons, small charts, or visual elements within cards
- Information should be scannable — this is a dashboard, not a document
- Text should be real, pulled from the content — not placeholder
The best result feels like a beautifully designed app interface — information architecture made visual. Each card earns its place.
Context for the infographic:"""
    },
    "whiteboard": {
        "name": "Whiteboard",
        "description": "Hand-drawn explanation style",
        "prompt": """Create an infographic for the context below.
Creative process:
- First, identify the core concept or process being explained. How would a teacher or professor sketch this out to help someone understand? What are the key elements, relationships, and flow?
Visual approach:
- Whiteboard/dry-erase aesthetic: hand-drawn feel, sketchy lines, marker texture
- Background: white or off-white, like an actual whiteboard or paper
- Hand-drawn diagrams, arrows, boxes, circles, and connectors
- Mix of simple illustrations and text labels
- Casual, spontaneous energy — like someone explaining in real-time
- Can include small doodles, underlines, emphasis marks, asterisks
- Color palette: marker colors — black as primary, with red, blue, green, orange as accents
- Text should look handwritten or marker-style, not typeset
- Arrows and flow lines connect ideas
- Imperfect and human — not polished, but clear
The best result feels like walking up to a whiteboard after a great explanation — you can trace the thinking, see the connections, understand the concept at a glance.
Context for the infographic:"""
    },
    "system_diagram": {
        "name": "System Diagram",
        "description": "Technical reference poster",
        "prompt": """Create an infographic for the context below.
Creative process:
- First, extract the essential knowledge from this content. What are the key concepts, rules, patterns, or principles? Then think: how can each concept be visualized, even simply? How can text and visuals work together?
Visual approach:
- Icons or simple visuals for each concept — every idea gets a small visual representation
- Text and visuals interact: annotations point to things, labels explain visuals, examples sit next to principles
- Organized but not rigid — clear sections and groupings, but varied layouts within
- Monochrome base (black/grey on white) with one accent color for emphasis and organization
- Dense with information but clear hierarchy — headers, labels, annotations at different scales
- Mix of elements: icons, small diagrams, text blocks, callouts, examples
- Clean, modern aesthetic — simple geometric icons, clean typography
- Designed to be scanned and studied — reward both glancing and close reading
- The whole thing feels like a reference poster you'd want on your wall
The best result feels like knowledge made visible — every concept crystallized into icon and label, organized so you can find anything and understand it at a glance.
Context for the infographic:"""
    },
    "napkin": {
        "name": "Napkin Sketch",
        "description": "Simple conceptual sketch",
        "prompt": """Create an infographic for the context below.
Creative process:
- First, deeply understand the content. What is the core insight or relationship?
- Then ask: what is the *shape* of this idea?
  - Is it a tension between two things? → two ends of a line, a tug-of-war
  - Is it a progression? → a curve, a path, an arrow
  - Is it a cycle? → a spiral, a loop
  - Is it a tradeoff? → two axes, a quadrant
  - Is it a transformation? → before/after, diverging paths
  - Is it layers? → concentric circles, a stack
- Find the ONE visual that captures the idea's structure. Then strip away everything else.
Visual approach:
- One simple conceptual sketch — a graph, curve, spiral, quadrant, axes, Venn, or simple shapes
- Truly hand-drawn: wobbly lines, imperfect circles, raw and unpolished
- Handwritten labels — messy, quick, like actual pen on paper
- Black or dark ink only
- Background: white with subtle paper or napkin texture — tactile, organic
- NO icons, NO illustrations, NO people, NO detailed drawings
- Just: lines, shapes, arrows, and handwritten words
- The kind of sketch you'd make in 30 seconds to land an idea
The best result looks like a brilliant napkin sketch — the moment an idea became clear, captured in pen.
Context for the infographic:"""
    },
    "cheatsheet": {
        "name": "Cheatsheet",
        "description": "Dense reference card",
        "prompt": """Create an infographic for the context below.
Creative process:
- First, extract the essential knowledge from this content. What are the key concepts, rules, patterns, shortcuts, or principles someone needs to remember? Organize them into logical groups or categories.
Visual approach:
- Modern, sleek design — clean lines, refined typography, polished and professional
- Dark mode aesthetic: dark charcoal or near-black background with crisp white and one accent color
- Clear sections and groupings — related information clustered together with clear hierarchy
- Typography-forward: bold headers, clean body text, excellent readability
- Dense but not cluttered — information-rich, but with breathing room
- Simple visual elements to aid scanning: divider lines, subtle boxes, numbered items, clean icons if helpful
- Designed to be saved, shared, printed — something you'd want to post or send to someone
- One accent color used consistently for emphasis and organization
- The whole thing feels like a high-quality reference card from a design-forward company
The best result is something you'd screenshot and send to a friend — essential knowledge, beautifully organized, instantly useful.
Context for the infographic:"""
    },
    "cartoon": {
        "name": "Cartoon",
        "description": "Comic book style illustration",
        "prompt": """Create an infographic for the context below.
Creative process:
- First, understand the key concepts or message in this content. Then ask: how can these ideas become characters, scenes, or moments? What's the drama, the conflict, the transformation? Make the abstract feel alive and dynamic.
Visual approach:
- Superhero comic book aesthetic: bold lines, dynamic poses, dramatic angles, vibrant colors
- Strong black outlines, cel-shaded coloring, action energy
- Characters or figures that represent concepts — ideas personified, not just illustrated
- Speech bubbles, captions, or callouts containing real insights from the content
- Can be single dramatic scene or 2-4 panel sequence
- Visual metaphors: concepts as heroes, challenges as villains, transformations as superpowers
- Bold, punchy typography — comic book style headers and labels
- Bright, saturated color palette — primary colors, high contrast
- The information is real and valuable — the style just makes it memorable
The best result feels like a comic book panel that actually teaches you something — dramatic, fun, and genuinely insightful.
Context for the infographic:"""
    },
}


def get_diagram_styles() -> Dict[str, Dict[str, str]]:
    """
    Get all available diagram styles.
    Priority: settings file > defaults

    Returns:
        Dict mapping style_id to {name, description, prompt}
    """
    settings = load_settings()
    return settings.get("diagram_styles", DEFAULT_DIAGRAM_STYLES)


def set_diagram_styles(styles: Dict[str, Dict[str, str]]) -> None:
    """Set all diagram styles."""
    settings = load_settings()
    settings["diagram_styles"] = styles
    save_settings(settings)


def get_diagram_style(style_id: str) -> Optional[Dict[str, str]]:
    """
    Get a specific diagram style by ID.

    Returns:
        Dict with name, description, prompt or None if not found
    """
    styles = get_diagram_styles()
    return styles.get(style_id)


def update_diagram_style(style_id: str, name: str, description: str, prompt: str) -> None:
    """Update an existing diagram style."""
    settings = load_settings()
    styles = settings.get("diagram_styles", DEFAULT_DIAGRAM_STYLES.copy())
    styles[style_id] = {
        "name": name,
        "description": description,
        "prompt": prompt
    }
    settings["diagram_styles"] = styles
    save_settings(settings)


def create_diagram_style(style_id: str, name: str, description: str, prompt: str) -> bool:
    """
    Create a new diagram style.

    Returns:
        True if created, False if style_id already exists
    """
    settings = load_settings()
    styles = settings.get("diagram_styles", DEFAULT_DIAGRAM_STYLES.copy())

    if style_id in styles:
        return False

    styles[style_id] = {
        "name": name,
        "description": description,
        "prompt": prompt
    }
    settings["diagram_styles"] = styles
    save_settings(settings)
    return True


def delete_diagram_style(style_id: str) -> bool:
    """
    Delete a diagram style.

    Returns:
        True if deleted, False if not found or is the last style
    """
    settings = load_settings()
    styles = settings.get("diagram_styles", DEFAULT_DIAGRAM_STYLES.copy())

    if style_id not in styles:
        return False

    # Don't allow deleting the last style
    if len(styles) <= 1:
        return False

    del styles[style_id]
    settings["diagram_styles"] = styles
    save_settings(settings)
    return True


def get_visualiser_settings() -> Dict[str, Any]:
    """
    Get all visualiser settings.

    Returns:
        Dict with default_model and diagram_styles
    """
    return {
        "default_model": get_visualiser_model(),
        "diagram_styles": get_diagram_styles()
    }


# =============================================================================
# Model Testing and Dependencies
# =============================================================================

def get_model_dependencies(model_id: str) -> Dict[str, Any]:
    """
    Check which features use a specific model.

    Args:
        model_id: The model identifier to check

    Returns:
        Dict with dependencies info and whether model can be removed
    """
    settings = load_settings()

    deps = {
        "council_members": model_id in settings.get("council_models", get_model_pool()),
        "chairman": settings.get("chairman_model", DEFAULT_CHAIRMAN_MODEL) == model_id,
        "synthesizer": settings.get("synthesizer_model", DEFAULT_SYNTHESIZER_MODEL) == model_id,
        "visualiser": settings.get("visualiser_model", DEFAULT_VISUALISER_MODEL) == model_id,
    }

    active = [k for k, v in deps.items() if v]
    return {
        "model": model_id,
        "dependencies": deps,
        "can_remove": len(active) == 0,
        "replacement_required": active
    }


def replace_model(old_model: str, new_model: str, remove_old: bool = True) -> Dict[str, Any]:
    """
    Replace a model with another across all its usages.

    Args:
        old_model: Model to replace
        new_model: Model to use instead
        remove_old: Whether to remove old model from pool after replacement

    Returns:
        Dict with replacement results
    """
    settings = load_settings()
    pool = settings.get("model_pool", DEFAULT_MODEL_POOL)
    replaced_in = []

    # Ensure new model is in pool
    if new_model not in pool:
        pool.append(new_model)
        settings["model_pool"] = pool

    # Replace in council models
    council_models = settings.get("council_models", pool.copy())
    if old_model in council_models:
        council_models = [new_model if m == old_model else m for m in council_models]
        # Remove duplicates while preserving order
        seen = set()
        council_models = [m for m in council_models if not (m in seen or seen.add(m))]
        settings["council_models"] = council_models
        replaced_in.append("council_members")

    # Replace chairman
    if settings.get("chairman_model", DEFAULT_CHAIRMAN_MODEL) == old_model:
        settings["chairman_model"] = new_model
        replaced_in.append("chairman")

    # Replace synthesizer
    if settings.get("synthesizer_model", DEFAULT_SYNTHESIZER_MODEL) == old_model:
        settings["synthesizer_model"] = new_model
        replaced_in.append("synthesizer")

    # Replace visualiser
    if settings.get("visualiser_model", DEFAULT_VISUALISER_MODEL) == old_model:
        settings["visualiser_model"] = new_model
        replaced_in.append("visualiser")

    # Remove old model from pool if requested
    if remove_old and old_model in pool:
        pool = [m for m in pool if m != old_model]
        settings["model_pool"] = pool

    save_settings(settings)

    return {
        "old_model": old_model,
        "new_model": new_model,
        "replaced_in": replaced_in,
        "removed_from_pool": remove_old
    }


# =============================================================================
# Podcast Settings (ElevenLabs and LiveKit)
# =============================================================================

# ElevenLabs API Key
def get_elevenlabs_api_key() -> Optional[str]:
    """
    Get ElevenLabs API key for TTS.
    Priority: settings file > environment variable
    """
    settings = load_settings()
    if settings.get("elevenlabs_api_key"):
        return settings["elevenlabs_api_key"]
    return os.getenv("ELEVEN_API_KEY")


def set_elevenlabs_api_key(api_key: str) -> None:
    """Set ElevenLabs API key in settings file."""
    settings = load_settings()
    settings["elevenlabs_api_key"] = api_key
    save_settings(settings)


def clear_elevenlabs_api_key() -> None:
    """Clear ElevenLabs API key from settings file."""
    settings = load_settings()
    if "elevenlabs_api_key" in settings:
        del settings["elevenlabs_api_key"]
    save_settings(settings)


def has_elevenlabs_configured() -> bool:
    """Check if ElevenLabs API key is configured."""
    return get_elevenlabs_api_key() is not None


def get_elevenlabs_source() -> str:
    """Return where the ElevenLabs API key is coming from."""
    settings = load_settings()
    if settings.get("elevenlabs_api_key"):
        return "settings"
    if os.getenv("ELEVEN_API_KEY"):
        return "environment"
    return "none"


# ElevenLabs Voice Settings - Dual Speaker Configuration (Host + Expert)
DEFAULT_ELEVENLABS_MODEL = "eleven_turbo_v2_5"
DEFAULT_VOICE_SETTINGS = {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.3,
    "speed": 1.0
}

# Default host voice - friendly, engaging interviewer
DEFAULT_HOST_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"  # Sarah - American female
DEFAULT_HOST_SYSTEM_PROMPT = """You are the host of an engaging podcast. Your role is to:
- Ask thoughtful questions that draw out insights from the expert
- Keep the conversation flowing naturally
- Summarize key points for the audience
- Show genuine curiosity and enthusiasm
- Use phrases like "That's fascinating!", "Tell me more about...", "So what you're saying is..."
- Keep your responses concise to let the expert shine"""

# Default expert voice - authoritative, knowledgeable explainer
DEFAULT_EXPERT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"  # George - British male
DEFAULT_EXPERT_SYSTEM_PROMPT = """You are the expert guest on a podcast. Your role is to:
- Explain complex topics in an accessible, engaging way
- Share insights and unique perspectives on the material
- Use concrete examples and analogies to illustrate points
- Build on the host's questions to deepen understanding
- Be authoritative but not condescending
- Use phrases like "The key insight here is...", "What's really interesting is...", "Let me break this down..."
- Provide depth while keeping explanations clear"""

# Available voices for selection
ELEVENLABS_VOICES = {
    "JBFqnCBsd6RMkjVDRZzb": {"name": "George", "description": "British male, warm and authoritative"},
    "onwK4e9ZLuTAKqWW03F9": {"name": "Daniel", "description": "British male, professional and clear"},
    "ODq5zmih8GrVes37Dizd": {"name": "Patrick", "description": "American male, conversational"},
    "pNInz6obpgDQGcFmaJgB": {"name": "Adam", "description": "American male, deep and resonant"},
    "EXAVITQu4vr4xnSDxMaL": {"name": "Sarah", "description": "American female, professional and warm"},
    "21m00Tcm4TlvDq8ikWAM": {"name": "Rachel", "description": "American female, calm and clear"},
    "AZnzlk1XvdvUeBnXmlld": {"name": "Domi", "description": "American female, confident and direct"},
    "MF3mGyEYCl7XYWbV9V6O": {"name": "Elli", "description": "American female, youthful and expressive"},
}

# Available models for selection
ELEVENLABS_MODELS = {
    "eleven_turbo_v2_5": {"name": "Turbo v2.5", "description": "Fast, low latency (recommended)"},
    "eleven_multilingual_v2": {"name": "Multilingual v2", "description": "High quality, multi-language"},
    "eleven_flash_v2_5": {"name": "Flash v2.5", "description": "Ultra-fast, lowest latency"},
}


def get_host_voice_config() -> Dict[str, Any]:
    """
    Get host voice configuration.

    Returns:
        Dict with voice_id, model, voice_settings, and system_prompt
    """
    settings = load_settings()
    return {
        "voice_id": settings.get("host_voice_id") or DEFAULT_HOST_VOICE_ID,
        "model": settings.get("host_model") or DEFAULT_ELEVENLABS_MODEL,
        "voice_settings": settings.get("host_voice_settings") or DEFAULT_VOICE_SETTINGS.copy(),
        "system_prompt": settings.get("host_system_prompt") or DEFAULT_HOST_SYSTEM_PROMPT,
    }


def set_host_voice_config(
    voice_id: Optional[str] = None,
    model: Optional[str] = None,
    voice_settings: Optional[Dict[str, float]] = None,
    system_prompt: Optional[str] = None,
) -> None:
    """Set host voice configuration."""
    settings = load_settings()
    if voice_id is not None:
        settings["host_voice_id"] = voice_id
    if model is not None:
        settings["host_model"] = model
    if voice_settings is not None:
        settings["host_voice_settings"] = voice_settings
    if system_prompt is not None:
        settings["host_system_prompt"] = system_prompt
    save_settings(settings)


def get_expert_voice_config() -> Dict[str, Any]:
    """
    Get expert voice configuration.

    Returns:
        Dict with voice_id, model, voice_settings, and system_prompt
    """
    settings = load_settings()
    return {
        "voice_id": settings.get("expert_voice_id") or DEFAULT_EXPERT_VOICE_ID,
        "model": settings.get("expert_model") or DEFAULT_ELEVENLABS_MODEL,
        "voice_settings": settings.get("expert_voice_settings") or DEFAULT_VOICE_SETTINGS.copy(),
        "system_prompt": settings.get("expert_system_prompt") or DEFAULT_EXPERT_SYSTEM_PROMPT,
    }


def set_expert_voice_config(
    voice_id: Optional[str] = None,
    model: Optional[str] = None,
    voice_settings: Optional[Dict[str, float]] = None,
    system_prompt: Optional[str] = None,
) -> None:
    """Set expert voice configuration."""
    settings = load_settings()
    if voice_id is not None:
        settings["expert_voice_id"] = voice_id
    if model is not None:
        settings["expert_model"] = model
    if voice_settings is not None:
        settings["expert_voice_settings"] = voice_settings
    if system_prompt is not None:
        settings["expert_system_prompt"] = system_prompt
    save_settings(settings)


# Legacy function for backwards compatibility
def get_elevenlabs_voice_settings() -> Dict[str, Any]:
    """
    Get ElevenLabs voice configuration (legacy, returns host config).

    Returns:
        Dict with voice_id, model, and voice_settings
    """
    host_config = get_host_voice_config()
    return {
        "voice_id": host_config["voice_id"],
        "model": host_config["model"],
        "voice_settings": host_config["voice_settings"],
    }


def set_elevenlabs_voice_settings(
    voice_id: Optional[str] = None,
    model: Optional[str] = None,
    voice_settings: Optional[Dict[str, float]] = None
) -> None:
    """
    Set ElevenLabs voice configuration (legacy, updates host config).
    """
    set_host_voice_config(voice_id=voice_id, model=model, voice_settings=voice_settings)


def get_available_voices() -> Dict[str, Dict[str, str]]:
    """Get available ElevenLabs voices."""
    return ELEVENLABS_VOICES


def get_available_models() -> Dict[str, Dict[str, str]]:
    """Get available ElevenLabs models."""
    return ELEVENLABS_MODELS


# OpenAI API Key (for TTS in podcast mode)
def get_openai_api_key() -> Optional[str]:
    """
    Get OpenAI API key for TTS.
    Priority: settings file > environment variable
    """
    settings = load_settings()
    if settings.get("openai_api_key"):
        return settings["openai_api_key"]
    return os.getenv("OPENAI_API_KEY")


def set_openai_api_key(api_key: str) -> None:
    """Set OpenAI API key in settings file."""
    settings = load_settings()
    settings["openai_api_key"] = api_key
    save_settings(settings)


def clear_openai_api_key() -> None:
    """Clear OpenAI API key from settings file."""
    settings = load_settings()
    if "openai_api_key" in settings:
        del settings["openai_api_key"]
    save_settings(settings)


def has_openai_configured() -> bool:
    """Check if OpenAI API key is configured."""
    return get_openai_api_key() is not None


def get_openai_source() -> str:
    """Return where the OpenAI API key is coming from."""
    settings = load_settings()
    if settings.get("openai_api_key"):
        return "settings"
    if os.getenv("OPENAI_API_KEY"):
        return "environment"
    return "none"


def has_podcast_configured() -> bool:
    """Check if podcast mode is fully configured (only needs ElevenLabs now)."""
    return has_elevenlabs_configured()


# Default cover art prompt
DEFAULT_PODCAST_COVER_PROMPT = """Create a podcast cover art image for the episode described below.
Creative process:
- First, identify the core theme or topic from the content. What is the single most important concept or idea?
- What visual metaphor or abstract representation could capture this essence?
Visual approach:
- Square format (1:1 aspect ratio) optimized for podcast platforms
- Bold, striking design that works at small thumbnail sizes
- Abstract or stylized representation, not literal illustration
- Modern, professional aesthetic with strong visual impact
- Limited color palette (2-4 colors maximum) for cohesion
- Typography optional, if used should be minimal and impactful
- Avoid text-heavy designs, focus on visual storytelling
- Consider gradients, geometric shapes, or symbolic imagery
- Should feel like premium editorial design, not generic stock art
- Dark or moody color schemes work well for intellectual content
- Light, vibrant palettes suit conversational or uplifting content
The best result feels like album artwork for a thought-provoking podcast, immediately recognizable and visually memorable. It should make someone want to press play.
Content for the cover art:
"""


def get_podcast_cover_prompt() -> str:
    """Get the podcast cover art prompt from settings."""
    settings = load_settings()
    return settings.get("podcast_cover_prompt", DEFAULT_PODCAST_COVER_PROMPT)


def set_podcast_cover_prompt(prompt: str) -> None:
    """Set the podcast cover art prompt."""
    settings = load_settings()
    settings["podcast_cover_prompt"] = prompt
    save_settings(settings)


# Default model for podcast cover generation
DEFAULT_PODCAST_COVER_MODEL = "google/gemini-2.5-flash-image"


def get_podcast_cover_model() -> str:
    """Get the model used for podcast cover generation."""
    settings = load_settings()
    return settings.get("podcast_cover_model", DEFAULT_PODCAST_COVER_MODEL)


def set_podcast_cover_model(model: str) -> None:
    """Set the model used for podcast cover generation."""
    settings = load_settings()
    settings["podcast_cover_model"] = model
    save_settings(settings)


def get_podcast_settings() -> Dict[str, Any]:
    """
    Get all podcast-related settings.

    Returns:
        Dict with configuration status for podcast mode including dual speaker config
    """
    host_config = get_host_voice_config()
    expert_config = get_expert_voice_config()

    return {
        # ElevenLabs is required for TTS
        "elevenlabs_configured": has_elevenlabs_configured(),
        "elevenlabs_source": get_elevenlabs_source(),
        # Available options
        "available_voices": get_available_voices(),
        "available_models": get_available_models(),
        # Host configuration
        "host": {
            "voice_id": host_config["voice_id"],
            "model": host_config["model"],
            "voice_settings": host_config["voice_settings"],
            "system_prompt": host_config["system_prompt"],
        },
        # Expert configuration
        "expert": {
            "voice_id": expert_config["voice_id"],
            "model": expert_config["model"],
            "voice_settings": expert_config["voice_settings"],
            "system_prompt": expert_config["system_prompt"],
        },
        # Overall podcast readiness (only needs ElevenLabs now)
        "podcast_configured": has_podcast_configured(),
        # Cover art settings
        "cover_prompt": get_podcast_cover_prompt(),
        "cover_model": get_podcast_cover_model(),
    }
