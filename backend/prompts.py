"""
Prompt management for system prompts stored as markdown files.
"""
import os
from pathlib import Path
from typing import List, Dict, Optional

# Prompts directory - configurable for Docker
PROMPTS_DIR = Path(os.getenv("PROMPTS_DIR", "prompts"))

def ensure_prompts_dir():
    """Ensure the prompts directory exists."""
    PROMPTS_DIR.mkdir(exist_ok=True)

def extract_title_from_markdown(content: str) -> str:
    """Extract title from markdown content (first # heading)."""
    for line in content.strip().split('\n'):
        line = line.strip()
        if line.startswith('# '):
            return line[2:].strip()
    return "Untitled"

def get_prompt_filename(title: str) -> str:
    """Convert title to filename (lowercase, hyphens, .md extension)."""
    filename = title.lower().replace(' ', '-')
    # Remove special characters
    filename = ''.join(c for c in filename if c.isalnum() or c == '-')
    if not filename.endswith('.md'):
        filename += '.md'
    return filename

def list_prompts() -> List[Dict[str, str]]:
    """
    List all available prompts.
    Returns list of dicts with 'filename', 'title', and 'content'.
    """
    ensure_prompts_dir()
    prompts = []

    for filepath in sorted(PROMPTS_DIR.glob("*.md")):
        try:
            content = filepath.read_text(encoding='utf-8')
            title = extract_title_from_markdown(content)
            prompts.append({
                "filename": filepath.name,
                "title": title,
                "content": content
            })
        except Exception as e:
            print(f"Error reading prompt {filepath}: {e}")
            continue

    return prompts

def get_prompt(filename: str) -> Optional[Dict[str, str]]:
    """
    Get a specific prompt by filename.
    Returns dict with 'filename', 'title', and 'content', or None if not found.
    """
    ensure_prompts_dir()
    filepath = PROMPTS_DIR / filename

    if not filepath.exists() or not filepath.is_file():
        return None

    try:
        content = filepath.read_text(encoding='utf-8')
        title = extract_title_from_markdown(content)
        return {
            "filename": filename,
            "title": title,
            "content": content
        }
    except Exception as e:
        print(f"Error reading prompt {filepath}: {e}")
        return None

def create_prompt(title: str, content: str) -> Dict[str, str]:
    """
    Create a new prompt file.
    Returns dict with 'filename', 'title', and 'content'.
    Raises ValueError if file already exists.
    """
    ensure_prompts_dir()

    # Ensure content starts with title as H1
    if not content.strip().startswith(f"# {title}"):
        content = f"# {title}\n\n{content.strip()}"

    filename = get_prompt_filename(title)
    filepath = PROMPTS_DIR / filename

    if filepath.exists():
        raise ValueError(f"Prompt file '{filename}' already exists")

    filepath.write_text(content, encoding='utf-8')

    return {
        "filename": filename,
        "title": title,
        "content": content
    }

def update_prompt(filename: str, content: str) -> Dict[str, str]:
    """
    Update an existing prompt file.
    Returns dict with 'filename', 'title', and 'content'.
    Raises ValueError if file doesn't exist.
    """
    ensure_prompts_dir()
    filepath = PROMPTS_DIR / filename

    if not filepath.exists():
        raise ValueError(f"Prompt file '{filename}' does not exist")

    filepath.write_text(content, encoding='utf-8')
    title = extract_title_from_markdown(content)

    return {
        "filename": filename,
        "title": title,
        "content": content
    }

def delete_prompt(filename: str) -> bool:
    """
    Delete a prompt file.
    Returns True if successful, raises ValueError if file doesn't exist.
    """
    ensure_prompts_dir()
    filepath = PROMPTS_DIR / filename

    if not filepath.exists():
        raise ValueError(f"Prompt file '{filename}' does not exist")

    filepath.unlink()
    return True
