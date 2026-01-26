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


# =============================================================================
# Crawl4AI Settings (Self-hosted Web Scraper)
# =============================================================================

DEFAULT_CRAWL4AI_URL = "http://localhost:11235"


def get_crawl4ai_url() -> str:
    """
    Get Crawl4AI service URL.
    Priority: settings file > environment variable > default
    """
    settings = load_settings()
    if settings.get("crawl4ai_url"):
        return settings["crawl4ai_url"]
    return os.getenv("CRAWL4AI_URL", DEFAULT_CRAWL4AI_URL)


def set_crawl4ai_url(url: str) -> None:
    """Set Crawl4AI service URL in settings file."""
    settings = load_settings()
    settings["crawl4ai_url"] = url.rstrip("/")
    save_settings(settings)


def get_crawler_provider() -> str:
    """
    Get the current crawler provider.
    Returns: 'crawl4ai' or 'firecrawl'
    Default is 'crawl4ai' if the service is available.
    """
    settings = load_settings()
    return settings.get("crawler_provider", "crawl4ai")


def set_crawler_provider(provider: str) -> None:
    """
    Set the crawler provider ('crawl4ai' or 'firecrawl').
    """
    if provider not in ("crawl4ai", "firecrawl"):
        raise ValueError("Crawler provider must be 'crawl4ai' or 'firecrawl'")
    settings = load_settings()
    settings["crawler_provider"] = provider
    save_settings(settings)


def is_crawl4ai_enabled() -> bool:
    """Check if Crawl4AI is the selected crawler provider."""
    return get_crawler_provider() == "crawl4ai"


def get_crawler_auto_fallback() -> bool:
    """Check if auto-fallback to Firecrawl is enabled."""
    settings = load_settings()
    return settings.get("crawler_auto_fallback", True)


def set_crawler_auto_fallback(enabled: bool) -> None:
    """Set whether to auto-fallback to Firecrawl if Crawl4AI fails."""
    settings = load_settings()
    settings["crawler_auto_fallback"] = enabled
    save_settings(settings)


def get_crawler_settings() -> Dict[str, Any]:
    """
    Get all crawler settings for frontend display.

    Returns:
        Dict with provider, crawl4ai_url, firecrawl status, etc.
    """
    return {
        "provider": get_crawler_provider(),
        "crawl4ai_url": get_crawl4ai_url(),
        "firecrawl_configured": has_firecrawl_configured(),
        "firecrawl_source": get_firecrawl_source(),
        "auto_fallback": get_crawler_auto_fallback(),
    }


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
# Podcast Settings (Voice Service)
# =============================================================================

# Default system prompts for host and expert roles
DEFAULT_HOST_SYSTEM_PROMPT = """You are the host of an engaging podcast. Your role is to:
- Ask thoughtful questions that draw out insights from the expert
- Keep the conversation flowing naturally
- Summarize key points for the audience
- Show genuine curiosity and enthusiasm
- Use phrases like "That's fascinating!", "Tell me more about...", "So what you're saying is..."
- Keep your responses concise to let the expert shine"""

DEFAULT_EXPERT_SYSTEM_PROMPT = """You are the expert guest on a podcast. Your role is to:
- Explain complex topics in an accessible, engaging way
- Share insights and unique perspectives on the material
- Use concrete examples and analogies to illustrate points
- Build on the host's questions to deepen understanding
- Be authoritative but not condescending
- Use phrases like "The key insight here is...", "What's really interesting is...", "Let me break this down..."
- Provide depth while keeping explanations clear"""


def get_host_voice_config() -> Dict[str, Any]:
    """
    Get host voice configuration.

    Returns:
        Dict with system_prompt for host role
    """
    settings = load_settings()
    return {
        "system_prompt": settings.get("host_system_prompt") or DEFAULT_HOST_SYSTEM_PROMPT,
    }


def set_host_voice_config(
    system_prompt: Optional[str] = None,
    **kwargs,
) -> None:
    """Set host voice configuration."""
    settings = load_settings()
    if system_prompt is not None:
        settings["host_system_prompt"] = system_prompt
    save_settings(settings)


def get_expert_voice_config() -> Dict[str, Any]:
    """
    Get expert voice configuration.

    Returns:
        Dict with system_prompt for expert role
    """
    settings = load_settings()
    return {
        "system_prompt": settings.get("expert_system_prompt") or DEFAULT_EXPERT_SYSTEM_PROMPT,
    }


def set_expert_voice_config(
    system_prompt: Optional[str] = None,
    **kwargs,
) -> None:
    """Set expert voice configuration."""
    settings = load_settings()
    if system_prompt is not None:
        settings["expert_system_prompt"] = system_prompt
    save_settings(settings)


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
    """Check if podcast mode is fully configured (TTS service is local)."""
    return True


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
        Dict with configuration status for podcast mode
    """
    host_config = get_host_voice_config()
    expert_config = get_expert_voice_config()

    return {
        "voice_cloning_available": True,
        "tts_service": "qwen3-tts",
        "host": {
            "system_prompt": host_config["system_prompt"],
        },
        "expert": {
            "system_prompt": expert_config["system_prompt"],
        },
        "podcast_configured": has_podcast_configured(),
        "cover_prompt": get_podcast_cover_prompt(),
        "cover_model": get_podcast_cover_model(),
    }


# =============================================================================
# Knowledge Graph Settings
# =============================================================================

# Model defaults
DEFAULT_KG_ENTITY_MODEL = "google/gemini-2.0-flash-001"
DEFAULT_KG_DISCOVERY_MODEL = "anthropic/claude-opus-4-20250514"
DEFAULT_KG_CHAT_MODEL = "anthropic/claude-sonnet-4-20250514"

# Entity Extraction defaults
DEFAULT_KG_MAX_ENTITIES = 5
DEFAULT_KG_MAX_RELATIONSHIPS = 3
DEFAULT_KG_SIMILARITY_THRESHOLD = 0.85

# Visualization defaults
DEFAULT_KG_NODE_SIZE_SOURCE = 8
DEFAULT_KG_NODE_SIZE_ENTITY_MIN = 4
DEFAULT_KG_NODE_SIZE_ENTITY_MAX = 9
DEFAULT_KG_NODE_SIZE_NOTE = 6
DEFAULT_KG_LINK_WIDTH_MANUAL = 2.0
DEFAULT_KG_LINK_WIDTH_SEQUENTIAL = 1.5
DEFAULT_KG_LINK_WIDTH_SHARED_TAG = 1.0
DEFAULT_KG_LINK_WIDTH_MENTIONS = 0.5
DEFAULT_KG_LABEL_ZOOM_THRESHOLD = 1.5

# Search defaults
DEFAULT_KG_SEARCH_DEBOUNCE_MS = 200
DEFAULT_KG_SEARCH_MIN_QUERY_LENGTH = 3
DEFAULT_KG_SEARCH_RESULTS_LIMIT = 20

# Chat defaults
DEFAULT_KG_CHAT_CONTEXT_MAX_LENGTH = 8000
DEFAULT_KG_CHAT_HISTORY_LIMIT = 20
DEFAULT_KG_CHAT_SIMILARITY_WEIGHT = 0.7
DEFAULT_KG_CHAT_MENTION_WEIGHT = 0.3

# Sleep Time Compute defaults
DEFAULT_KG_SLEEP_COMPUTE_DEPTH = 2
DEFAULT_KG_SLEEP_COMPUTE_MAX_NOTES = 30
DEFAULT_KG_SLEEP_COMPUTE_TURNS = 3


# -------------------------
# Model Settings
# -------------------------

def get_knowledge_graph_model() -> str:
    """
    Get the model used for entity extraction.
    Priority: settings file > default
    """
    settings = load_settings()
    return settings.get("knowledge_graph_model", DEFAULT_KG_ENTITY_MODEL)


def set_knowledge_graph_model(model: str) -> None:
    """Set the model used for entity extraction."""
    settings = load_settings()
    settings["knowledge_graph_model"] = model
    save_settings(settings)


def get_kg_discovery_model() -> str:
    """Get the model used for knowledge graph discovery."""
    settings = load_settings()
    return settings.get("kg_discovery_model", DEFAULT_KG_DISCOVERY_MODEL)


def set_kg_discovery_model(model: str) -> None:
    """Set the model used for knowledge graph discovery."""
    settings = load_settings()
    settings["kg_discovery_model"] = model
    save_settings(settings)


def get_kg_chat_model() -> str:
    """Get the model used for knowledge graph chat (RAG)."""
    settings = load_settings()
    return settings.get("kg_chat_model", DEFAULT_KG_CHAT_MODEL)


def set_kg_chat_model(model: str) -> None:
    """Set the model used for knowledge graph chat."""
    settings = load_settings()
    settings["kg_chat_model"] = model
    save_settings(settings)


def get_kg_model_settings() -> Dict[str, str]:
    """Get all knowledge graph model settings."""
    return {
        "entity_extraction_model": get_knowledge_graph_model(),
        "discovery_model": get_kg_discovery_model(),
        "chat_model": get_kg_chat_model(),
    }


def set_kg_model_settings(
    entity_extraction_model: Optional[str] = None,
    discovery_model: Optional[str] = None,
    chat_model: Optional[str] = None,
) -> Dict[str, str]:
    """Set knowledge graph model settings."""
    if entity_extraction_model is not None:
        set_knowledge_graph_model(entity_extraction_model)
    if discovery_model is not None:
        set_kg_discovery_model(discovery_model)
    if chat_model is not None:
        set_kg_chat_model(chat_model)
    return get_kg_model_settings()


# -------------------------
# Entity Extraction Settings
# -------------------------

def get_kg_entity_extraction_settings() -> Dict[str, Any]:
    """Get entity extraction settings."""
    settings = load_settings()
    return {
        "max_entities": settings.get("kg_max_entities", DEFAULT_KG_MAX_ENTITIES),
        "max_relationships": settings.get("kg_max_relationships", DEFAULT_KG_MAX_RELATIONSHIPS),
        "similarity_threshold": settings.get("kg_similarity_threshold", DEFAULT_KG_SIMILARITY_THRESHOLD),
    }


def set_kg_entity_extraction_settings(
    max_entities: Optional[int] = None,
    max_relationships: Optional[int] = None,
    similarity_threshold: Optional[float] = None,
) -> Dict[str, Any]:
    """Set entity extraction settings."""
    settings = load_settings()
    if max_entities is not None:
        settings["kg_max_entities"] = max_entities
    if max_relationships is not None:
        settings["kg_max_relationships"] = max_relationships
    if similarity_threshold is not None:
        settings["kg_similarity_threshold"] = similarity_threshold
    save_settings(settings)
    return get_kg_entity_extraction_settings()


# -------------------------
# Visualization Settings
# -------------------------

def get_kg_visualization_settings() -> Dict[str, Any]:
    """Get visualization settings for the knowledge graph."""
    settings = load_settings()
    return {
        "node_sizes": {
            "source": settings.get("kg_node_size_source", DEFAULT_KG_NODE_SIZE_SOURCE),
            "entity_min": settings.get("kg_node_size_entity_min", DEFAULT_KG_NODE_SIZE_ENTITY_MIN),
            "entity_max": settings.get("kg_node_size_entity_max", DEFAULT_KG_NODE_SIZE_ENTITY_MAX),
            "note": settings.get("kg_node_size_note", DEFAULT_KG_NODE_SIZE_NOTE),
        },
        "link_widths": {
            "manual": settings.get("kg_link_width_manual", DEFAULT_KG_LINK_WIDTH_MANUAL),
            "sequential": settings.get("kg_link_width_sequential", DEFAULT_KG_LINK_WIDTH_SEQUENTIAL),
            "shared_tag": settings.get("kg_link_width_shared_tag", DEFAULT_KG_LINK_WIDTH_SHARED_TAG),
            "mentions": settings.get("kg_link_width_mentions", DEFAULT_KG_LINK_WIDTH_MENTIONS),
        },
        "label_zoom_threshold": settings.get("kg_label_zoom_threshold", DEFAULT_KG_LABEL_ZOOM_THRESHOLD),
    }


def set_kg_visualization_settings(
    node_sizes: Optional[Dict[str, float]] = None,
    link_widths: Optional[Dict[str, float]] = None,
    label_zoom_threshold: Optional[float] = None,
) -> Dict[str, Any]:
    """Set visualization settings."""
    settings = load_settings()
    if node_sizes is not None:
        if "source" in node_sizes:
            settings["kg_node_size_source"] = node_sizes["source"]
        if "entity_min" in node_sizes:
            settings["kg_node_size_entity_min"] = node_sizes["entity_min"]
        if "entity_max" in node_sizes:
            settings["kg_node_size_entity_max"] = node_sizes["entity_max"]
        if "note" in node_sizes:
            settings["kg_node_size_note"] = node_sizes["note"]
    if link_widths is not None:
        if "manual" in link_widths:
            settings["kg_link_width_manual"] = link_widths["manual"]
        if "sequential" in link_widths:
            settings["kg_link_width_sequential"] = link_widths["sequential"]
        if "shared_tag" in link_widths:
            settings["kg_link_width_shared_tag"] = link_widths["shared_tag"]
        if "mentions" in link_widths:
            settings["kg_link_width_mentions"] = link_widths["mentions"]
    if label_zoom_threshold is not None:
        settings["kg_label_zoom_threshold"] = label_zoom_threshold
    save_settings(settings)
    return get_kg_visualization_settings()


# -------------------------
# Search Settings
# -------------------------

def get_kg_search_settings() -> Dict[str, Any]:
    """Get search settings for the knowledge graph."""
    settings = load_settings()
    return {
        "debounce_ms": settings.get("kg_search_debounce_ms", DEFAULT_KG_SEARCH_DEBOUNCE_MS),
        "min_query_length": settings.get("kg_search_min_query_length", DEFAULT_KG_SEARCH_MIN_QUERY_LENGTH),
        "results_limit": settings.get("kg_search_results_limit", DEFAULT_KG_SEARCH_RESULTS_LIMIT),
    }


def set_kg_search_settings(
    debounce_ms: Optional[int] = None,
    min_query_length: Optional[int] = None,
    results_limit: Optional[int] = None,
) -> Dict[str, Any]:
    """Set search settings."""
    settings = load_settings()
    if debounce_ms is not None:
        settings["kg_search_debounce_ms"] = debounce_ms
    if min_query_length is not None:
        settings["kg_search_min_query_length"] = min_query_length
    if results_limit is not None:
        settings["kg_search_results_limit"] = results_limit
    save_settings(settings)
    return get_kg_search_settings()


# -------------------------
# Chat Settings
# -------------------------

def get_kg_chat_settings() -> Dict[str, Any]:
    """Get chat/RAG settings for the knowledge graph."""
    settings = load_settings()
    return {
        "context_max_length": settings.get("kg_chat_context_max_length", DEFAULT_KG_CHAT_CONTEXT_MAX_LENGTH),
        "history_limit": settings.get("kg_chat_history_limit", DEFAULT_KG_CHAT_HISTORY_LIMIT),
        "similarity_weight": settings.get("kg_chat_similarity_weight", DEFAULT_KG_CHAT_SIMILARITY_WEIGHT),
        "mention_weight": settings.get("kg_chat_mention_weight", DEFAULT_KG_CHAT_MENTION_WEIGHT),
    }


def set_kg_chat_settings(
    context_max_length: Optional[int] = None,
    history_limit: Optional[int] = None,
    similarity_weight: Optional[float] = None,
    mention_weight: Optional[float] = None,
) -> Dict[str, Any]:
    """Set chat/RAG settings."""
    settings = load_settings()
    if context_max_length is not None:
        settings["kg_chat_context_max_length"] = context_max_length
    if history_limit is not None:
        settings["kg_chat_history_limit"] = history_limit
    if similarity_weight is not None:
        settings["kg_chat_similarity_weight"] = similarity_weight
    if mention_weight is not None:
        settings["kg_chat_mention_weight"] = mention_weight
    save_settings(settings)
    return get_kg_chat_settings()


# -------------------------
# Sleep Time Compute Settings
# -------------------------

def get_kg_sleep_compute_settings() -> Dict[str, Any]:
    """Get sleep time compute default settings."""
    settings = load_settings()
    return {
        "default_depth": settings.get("kg_sleep_compute_depth", DEFAULT_KG_SLEEP_COMPUTE_DEPTH),
        "default_max_notes": settings.get("kg_sleep_compute_max_notes", DEFAULT_KG_SLEEP_COMPUTE_MAX_NOTES),
        "default_turns": settings.get("kg_sleep_compute_turns", DEFAULT_KG_SLEEP_COMPUTE_TURNS),
        "model": settings.get("kg_sleep_compute_model", None),
    }


def set_kg_sleep_compute_settings(
    default_depth: Optional[int] = None,
    default_max_notes: Optional[int] = None,
    default_turns: Optional[int] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Set sleep time compute default settings."""
    settings = load_settings()
    if default_depth is not None:
        settings["kg_sleep_compute_depth"] = default_depth
    if default_max_notes is not None:
        settings["kg_sleep_compute_max_notes"] = default_max_notes
    if default_turns is not None:
        settings["kg_sleep_compute_turns"] = default_turns
    if model is not None:
        settings["kg_sleep_compute_model"] = model
    save_settings(settings)
    return get_kg_sleep_compute_settings()


# -------------------------
# Comprehensive Settings Getter
# -------------------------

def get_knowledge_graph_settings() -> Dict[str, Any]:
    """Get all knowledge graph settings."""
    return {
        "models": get_kg_model_settings(),
        "entity_extraction": get_kg_entity_extraction_settings(),
        "visualization": get_kg_visualization_settings(),
        "search": get_kg_search_settings(),
        "chat": get_kg_chat_settings(),
        "sleep_compute": get_kg_sleep_compute_settings(),
    }
