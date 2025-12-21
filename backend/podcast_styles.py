"""
Podcast narration style management.
Stores styles as markdown files with YAML frontmatter.
"""
import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Any

# Prompts directory - configurable for Docker
PROMPTS_DIR = Path(os.getenv("PROMPTS_DIR", "prompts"))
STYLES_DIR = PROMPTS_DIR / "podcast"


def ensure_styles_dir():
    """Ensure the podcast styles directory exists."""
    STYLES_DIR.mkdir(parents=True, exist_ok=True)


def parse_frontmatter(content: str) -> tuple[Dict[str, str], str]:
    """
    Parse YAML frontmatter from markdown content.

    Expected format:
    ---
    name: Style Name
    description: Short description for UI
    ---

    Full prompt content here...

    Returns:
        Tuple of (frontmatter_dict, body_content)
    """
    frontmatter = {}
    body = content

    # Match frontmatter block
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)$', content, re.DOTALL)
    if match:
        fm_text, body = match.groups()
        # Parse simple key: value pairs
        for line in fm_text.strip().split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                frontmatter[key.strip()] = value.strip()

    return frontmatter, body.strip()


def format_style_file(name: str, description: str, prompt: str) -> str:
    """
    Format a podcast style as markdown with frontmatter.

    Args:
        name: Display name
        description: Short description for UI
        prompt: The full generation prompt

    Returns:
        Formatted markdown string
    """
    return f"""---
name: {name}
description: {description}
---

{prompt}
"""


def list_podcast_styles() -> Dict[str, Dict[str, str]]:
    """
    List all available podcast narration styles.

    Returns:
        Dict mapping style_id to {name, description, prompt}
    """
    ensure_styles_dir()
    styles = {}

    for filepath in sorted(STYLES_DIR.glob("*.md")):
        try:
            content = filepath.read_text(encoding='utf-8')
            frontmatter, prompt = parse_frontmatter(content)

            style_id = filepath.stem  # filename without extension

            # If no frontmatter, try to extract from markdown header
            if not frontmatter.get("name"):
                # Look for first # heading as name
                header_match = re.match(r'^#\s+(.+?)(?:\n|$)', prompt)
                if header_match:
                    frontmatter["name"] = header_match.group(1).strip()
                else:
                    frontmatter["name"] = style_id.replace("-", " ").replace("_", " ").title()

            if not frontmatter.get("description"):
                # Look for first non-header paragraph
                lines = prompt.split('\n')
                for line in lines:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        frontmatter["description"] = line[:100]
                        break

            styles[style_id] = {
                "name": frontmatter.get("name", style_id),
                "description": frontmatter.get("description", ""),
                "prompt": prompt
            }
        except Exception as e:
            print(f"Error reading podcast style {filepath}: {e}")
            continue

    return styles


def get_podcast_style(style_id: str) -> Optional[Dict[str, str]]:
    """
    Get a specific podcast style by ID.

    Args:
        style_id: Style identifier (filename without .md)

    Returns:
        Dict with name, description, prompt or None if not found
    """
    ensure_styles_dir()
    filepath = STYLES_DIR / f"{style_id}.md"

    if not filepath.exists():
        return None

    try:
        content = filepath.read_text(encoding='utf-8')
        frontmatter, prompt = parse_frontmatter(content)

        # Fallback for files without frontmatter
        if not frontmatter.get("name"):
            header_match = re.match(r'^#\s+(.+?)(?:\n|$)', prompt)
            if header_match:
                frontmatter["name"] = header_match.group(1).strip()
            else:
                frontmatter["name"] = style_id.replace("-", " ").replace("_", " ").title()

        return {
            "name": frontmatter.get("name", style_id),
            "description": frontmatter.get("description", ""),
            "prompt": prompt
        }
    except Exception as e:
        print(f"Error reading podcast style {filepath}: {e}")
        return None


def create_podcast_style(style_id: str, name: str, description: str, prompt: str) -> bool:
    """
    Create a new podcast style.

    Args:
        style_id: Unique identifier (will become filename)
        name: Display name
        description: Short description
        prompt: The full generation prompt

    Returns:
        True if created, False if style_id already exists
    """
    ensure_styles_dir()
    filepath = STYLES_DIR / f"{style_id}.md"

    if filepath.exists():
        return False

    content = format_style_file(name, description, prompt)
    filepath.write_text(content, encoding='utf-8')
    return True


def update_podcast_style(style_id: str, name: str, description: str, prompt: str) -> bool:
    """
    Update an existing podcast style.

    Returns:
        True if updated, False if not found
    """
    ensure_styles_dir()
    filepath = STYLES_DIR / f"{style_id}.md"

    if not filepath.exists():
        return False

    content = format_style_file(name, description, prompt)
    filepath.write_text(content, encoding='utf-8')
    return True


def delete_podcast_style(style_id: str) -> bool:
    """
    Delete a podcast style.

    Returns:
        True if deleted, False if not found or is the last style
    """
    ensure_styles_dir()
    filepath = STYLES_DIR / f"{style_id}.md"

    if not filepath.exists():
        return False

    # Don't allow deleting the last style
    remaining = list(STYLES_DIR.glob("*.md"))
    if len(remaining) <= 1:
        return False

    filepath.unlink()
    return True


def get_style_prompt(style_id: str) -> Optional[str]:
    """
    Get just the prompt for a style (for use in podcast generation).

    Returns:
        The prompt string or None if not found
    """
    style = get_podcast_style(style_id)
    return style["prompt"] if style else None
