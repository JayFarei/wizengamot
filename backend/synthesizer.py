"""Synthesizer mode: Generate Zettelkasten notes from content."""

import re
import logging
from typing import List, Dict, Any, Optional

from .openrouter import query_model, query_models_parallel
from .settings import get_synthesizer_model, get_council_models
from .prompts import get_prompt

logger = logging.getLogger(__name__)


async def generate_zettels_single(
    content: str,
    system_prompt: str,
    model: Optional[str] = None,
    user_comment: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate Zettels using a single model.

    Args:
        content: Source content (transcript or article markdown)
        system_prompt: Zettel system prompt
        model: Model to use (defaults to synthesizer_model setting)
        user_comment: Optional user guidance/comment

    Returns:
        {
            "notes": List of Zettel dicts,
            "raw_response": str,
            "model": str
        }
    """
    if model is None:
        model = get_synthesizer_model()

    # Build user message with content and optional comment
    user_message = f"Generate Zettelkasten notes from the following content:\n\n{content}"
    if user_comment:
        user_message += f"\n\n---\nUser guidance: {user_comment}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message}
    ]

    logger.info(f"Generating Zettels with model: {model}")
    response = await query_model(model, messages, timeout=180.0)

    if response is None:
        logger.error(f"Model {model} failed to respond")
        return {
            "notes": [],
            "raw_response": "Error: Model failed to respond",
            "model": model
        }

    raw_response = response.get("content", "")
    notes = parse_zettels(raw_response)

    logger.info(f"Generated {len(notes)} Zettel notes")

    return {
        "notes": notes,
        "raw_response": raw_response,
        "model": model
    }


async def generate_zettels_council(
    content: str,
    system_prompt: str,
    council_models: Optional[List[str]] = None,
    user_comment: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate Zettels using multiple models, then merge results.

    Each model generates notes independently. Results are combined
    with source model attribution.

    Args:
        content: Source content (transcript or article markdown)
        system_prompt: Zettel system prompt
        council_models: Models to use (defaults to council_models setting)
        user_comment: Optional user guidance/comment

    Returns:
        {
            "notes": Combined list of Zettel dicts with source_model,
            "model_responses": List of per-model results,
            "models": List of models used
        }
    """
    if council_models is None:
        council_models = get_council_models()

    # Build user message
    user_message = f"Generate Zettelkasten notes from the following content:\n\n{content}"
    if user_comment:
        user_message += f"\n\n---\nUser guidance: {user_comment}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message}
    ]

    logger.info(f"Generating Zettels with council: {council_models}")

    # Query all models in parallel
    responses = await query_models_parallel(council_models, messages)

    # Collect all notes from all models
    all_notes = []
    model_responses = []
    note_counter = 1

    for model, response in responses.items():
        if response is not None:
            raw = response.get("content", "")
            notes = parse_zettels(raw)

            # Re-number notes and add source model
            for note in notes:
                note["id"] = f"note-{note_counter}"
                note["source_model"] = model
                note_counter += 1

            all_notes.extend(notes)
            model_responses.append({
                "model": model,
                "notes_count": len(notes),
                "raw": raw
            })
            logger.info(f"Model {model} generated {len(notes)} notes")
        else:
            model_responses.append({
                "model": model,
                "notes_count": 0,
                "raw": "Error: Model failed to respond"
            })
            logger.warning(f"Model {model} failed to respond")

    logger.info(f"Council generated {len(all_notes)} total notes")

    return {
        "notes": all_notes,
        "model_responses": model_responses,
        "models": council_models
    }


def parse_zettels(raw_text: str) -> List[Dict[str, Any]]:
    """
    Parse Zettel notes from LLM response.

    Expected format per note:
    # Title here

    #tag1 #tag2

    Body paragraph (around 100 words)...

    Args:
        raw_text: Raw LLM response text

    Returns:
        List of note dicts with id, title, tags, body
    """
    notes = []

    # Split by lines starting with "# " (title marker)
    # Be careful to not match hashtags (which start with "#" but no space after)
    sections = re.split(r'\n(?=# [^#\n])', raw_text)

    for section in sections:
        section = section.strip()
        if not section:
            continue

        # Must start with title
        if not section.startswith('# '):
            continue

        lines = section.split('\n')

        # Extract title (first line starting with '# ')
        title_line = lines[0]
        title = title_line[2:].strip()

        if not title:
            continue

        # Find tags line (line with only hashtags)
        tags = []
        body_start = 1

        for i, line in enumerate(lines[1:], start=1):
            line = line.strip()
            if not line:
                continue

            # Check if this is a tags-only line
            words = line.split()
            if all(word.startswith('#') and len(word) > 1 for word in words):
                tags = words
                body_start = i + 1
            else:
                # First non-empty, non-tag line is the start of body
                body_start = i
            break

        # Rest is body
        body_lines = []
        for line in lines[body_start:]:
            line = line.strip()
            # Stop if we hit another title (shouldn't happen but safety)
            if line.startswith('# ') and not line.startswith('##'):
                break
            if line:
                body_lines.append(line)

        body = ' '.join(body_lines)

        # Only add if we have a title and body
        if title and body:
            notes.append({
                "id": f"note-{len(notes) + 1}",
                "title": title,
                "tags": tags,
                "body": body
            })

    return notes


async def get_synthesizer_prompt_content(prompt_filename: Optional[str] = None) -> str:
    """
    Get the system prompt content for synthesizer.

    Args:
        prompt_filename: Specific prompt file, or None for default zettel.md

    Returns:
        System prompt content
    """
    if prompt_filename is None:
        prompt_filename = "zettel.md"

    prompt = get_prompt(prompt_filename)
    if prompt is None:
        # Fallback default prompt
        return """You are generating atomic Zettelkasten notes.

Each note should:
1. Start with a title as "# Title" (under 6 words)
2. Include 1-2 hashtags on their own line
3. Have a body paragraph of ~100 words

Generate as many notes as needed to capture all key concepts from the content."""

    return prompt.get("content", "")
