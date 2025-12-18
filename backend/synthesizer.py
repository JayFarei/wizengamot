"""Synthesizer mode: Generate Zettelkasten notes from content."""

import re
import logging
from typing import List, Dict, Any, Optional

from .openrouter import query_model, query_models_parallel
from .settings import get_synthesizer_model, get_council_models, get_chairman_model
from .prompts import get_prompt
from .council import parse_ranking_from_text, calculate_aggregate_rankings
from .synthesizer_stage_prompts import get_synth_ranking_prompt_content, get_synth_chairman_prompt_content

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
            "model": model,
            "generation_id": None
        }

    raw_response = response.get("content", "")
    generation_id = response.get("generation_id")
    notes = parse_zettels(raw_response)

    logger.info(f"Generated {len(notes)} Zettel notes")

    return {
        "notes": notes,
        "raw_response": raw_response,
        "model": model,
        "generation_id": generation_id
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
    generation_ids = []
    note_counter = 1

    for model, response in responses.items():
        if response is not None:
            raw = response.get("content", "")
            gen_id = response.get("generation_id")
            if gen_id:
                generation_ids.append(gen_id)
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
        "models": council_models,
        "generation_ids": generation_ids
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


async def generate_zettels_deliberation(
    content: str,
    system_prompt: str,
    council_models: Optional[List[str]] = None,
    chairman_model: Optional[str] = None,
    user_comment: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate Zettels using full 3-stage council deliberation.

    Stage 1: Each model generates notes independently (parallel)
    Stage 2: Each model ranks all note sets with access to original content
    Stage 3: Chairman synthesizes best elements into final notes

    Args:
        content: Source content (transcript or article markdown)
        system_prompt: Zettel system prompt for Stage 1
        council_models: Models to use (defaults to council_models setting)
        chairman_model: Chairman model (defaults to chairman_model setting)
        user_comment: Optional user guidance/comment

    Returns:
        {
            "notes": Final merged Zettel notes,
            "deliberation": {
                "stage1": List of per-model results with notes,
                "stage2": List of rankings with parsed_ranking,
                "label_to_model": Mapping for de-anonymization,
                "aggregate_rankings": Sorted rankings by avg position
            },
            "stage3_raw": Chairman's raw response,
            "models": List of models used,
            "chairman_model": Chairman model used,
            "generation_ids": List of all generation IDs for cost tracking
        }
    """
    if council_models is None:
        council_models = get_council_models()
    if chairman_model is None:
        chairman_model = get_chairman_model()

    generation_ids = []

    # =========================================================================
    # STAGE 1: Parallel note generation from each model
    # =========================================================================
    logger.info(f"Stage 1: Generating notes with council models: {council_models}")

    # Build user message
    user_message = f"Generate Zettelkasten notes from the following content:\n\n{content}"
    if user_comment:
        user_message += f"\n\n---\nUser guidance: {user_comment}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message}
    ]

    # Query all models in parallel
    stage1_responses = await query_models_parallel(council_models, messages)

    # Process Stage 1 results
    stage1_results = []
    for model, response in stage1_responses.items():
        if response is not None:
            raw = response.get("content", "")
            gen_id = response.get("generation_id")
            if gen_id:
                generation_ids.append(gen_id)
            notes = parse_zettels(raw)

            stage1_results.append({
                "model": model,
                "notes": notes,
                "raw": raw
            })
            logger.info(f"Stage 1: Model {model} generated {len(notes)} notes")
        else:
            stage1_results.append({
                "model": model,
                "notes": [],
                "raw": "Error: Model failed to respond"
            })
            logger.warning(f"Stage 1: Model {model} failed to respond")

    # If no models responded, return error
    if not any(r["notes"] for r in stage1_results):
        logger.error("Stage 1: All models failed to generate notes")
        return {
            "notes": [],
            "deliberation": {"stage1": stage1_results, "stage2": [], "label_to_model": {}, "aggregate_rankings": []},
            "stage3_raw": "Error: All models failed to generate notes",
            "models": council_models,
            "chairman_model": chairman_model,
            "generation_ids": generation_ids
        }

    # =========================================================================
    # STAGE 2: Anonymized peer review with rankings
    # =========================================================================
    logger.info("Stage 2: Collecting peer rankings")

    # Create anonymized labels
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }

    # Build responses text with notes from each model
    responses_parts = []
    for label, result in zip(labels, stage1_results):
        notes_text = result['raw'] if result['raw'] else "(No notes generated)"
        responses_parts.append(f"Response {label}:\n{notes_text}")
    responses_text = "\n\n---\n\n".join(responses_parts)

    # Truncate source content if too long (keep first 10000 chars for context)
    truncated_content = content[:10000] + "..." if len(content) > 10000 else content

    # Get ranking prompt and format it
    ranking_template = get_synth_ranking_prompt_content()
    ranking_prompt = ranking_template.format(
        source_content=truncated_content,
        responses_text=responses_text
    )

    ranking_messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel
    stage2_responses = await query_models_parallel(council_models, ranking_messages)

    # Process Stage 2 results
    stage2_results = []
    for model, response in stage2_responses.items():
        if response is not None:
            full_text = response.get('content', '')
            gen_id = response.get('generation_id')
            if gen_id:
                generation_ids.append(gen_id)
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed
            })
            logger.info(f"Stage 2: Model {model} provided ranking: {parsed}")
        else:
            stage2_results.append({
                "model": model,
                "ranking": "Error: Model failed to respond",
                "parsed_ranking": []
            })
            logger.warning(f"Stage 2: Model {model} failed to respond")

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
    logger.info(f"Aggregate rankings: {aggregate_rankings}")

    # =========================================================================
    # STAGE 3: Chairman synthesis
    # =========================================================================
    logger.info(f"Stage 3: Chairman {chairman_model} synthesizing final notes")

    # Build Stage 1 text for chairman
    stage1_text_parts = []
    for label, result in zip(labels, stage1_results):
        model_name = result['model']
        notes_text = result['raw'] if result['raw'] else "(No notes generated)"
        stage1_text_parts.append(f"Model: {model_name} (anonymized as Response {label})\nNotes:\n{notes_text}")
    stage1_text = "\n\n---\n\n".join(stage1_text_parts)

    # Build Stage 2 text for chairman
    stage2_text_parts = []
    for result in stage2_results:
        stage2_text_parts.append(f"Model: {result['model']}\nEvaluation:\n{result['ranking']}")
    stage2_text = "\n\n---\n\n".join(stage2_text_parts)

    # Get chairman prompt and format it
    chairman_template = get_synth_chairman_prompt_content()
    chairman_prompt = chairman_template.format(
        source_content=truncated_content,
        stage1_text=stage1_text,
        stage2_text=stage2_text
    )

    chairman_messages = [{"role": "user", "content": chairman_prompt}]

    # Query chairman
    chairman_response = await query_model(chairman_model, chairman_messages, timeout=180.0)

    if chairman_response is None:
        logger.error("Stage 3: Chairman failed to respond")
        stage3_raw = "Error: Chairman model failed to synthesize final notes"
        final_notes = []
    else:
        stage3_raw = chairman_response.get("content", "")
        gen_id = chairman_response.get("generation_id")
        if gen_id:
            generation_ids.append(gen_id)
        final_notes = parse_zettels(stage3_raw)
        logger.info(f"Stage 3: Chairman generated {len(final_notes)} final notes")

    # Assign IDs to final notes
    for i, note in enumerate(final_notes, start=1):
        note["id"] = f"note-{i}"

    return {
        "notes": final_notes,
        "deliberation": {
            "stage1": stage1_results,
            "stage2": stage2_results,
            "label_to_model": label_to_model,
            "aggregate_rankings": aggregate_rankings
        },
        "stage3_raw": stage3_raw,
        "models": council_models,
        "chairman_model": chairman_model,
        "generation_ids": generation_ids
    }
