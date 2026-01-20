"""Knowledge Graph mode for Synthesizer: Generate notes with awareness of existing knowledge base."""

import json
import logging
import re
from typing import List, Dict, Any, Optional

from .openrouter import query_model
from .settings import get_synthesizer_model, get_knowledge_graph_model
from .graph_search import search_knowledge_graph
from .knowledge_graph import build_graph, load_entities
from .synthesizer import parse_zettels

logger = logging.getLogger(__name__)

# Prompt for extracting topics from source content (first pass)
TOPIC_EXTRACTION_PROMPT = """Analyze the following content and extract the key topics and entities.

Content:
{content}

Return a JSON object with:
- "topics": List of 5-10 main topics/concepts discussed
- "entities": List of specific named entities (people, organizations, technologies, products)
- "domain": The general domain/field this content belongs to (e.g., "machine learning", "finance", "philosophy")

Return ONLY valid JSON, no additional text:
{{"topics": [...], "entities": [...], "domain": "..."}}"""


async def extract_topics_from_content(
    content: str,
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    First pass: Quick topic/entity extraction from source content.

    Args:
        content: Source content (transcript or article)
        model: Model to use (defaults to knowledge_graph_model)

    Returns:
        Dict with topics, entities, and domain
    """
    if model is None:
        model = get_knowledge_graph_model()

    # Truncate content for topic extraction (we don't need the full text)
    truncated = content[:8000] if len(content) > 8000 else content

    prompt = TOPIC_EXTRACTION_PROMPT.format(content=truncated)
    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(model, messages, timeout=30.0)

        if response is None:
            logger.warning("Failed to extract topics from content")
            return {"topics": [], "entities": [], "domain": "general"}

        content_text = response.get("content", "").strip()

        # Handle potential markdown code blocks
        if content_text.startswith("```"):
            content_text = re.sub(r'^```(?:json)?\n?', '', content_text)
            content_text = re.sub(r'\n?```$', '', content_text)

        result = json.loads(content_text)

        return {
            "topics": result.get("topics", [])[:10],
            "entities": result.get("entities", [])[:10],
            "domain": result.get("domain", "general")
        }

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse topic extraction JSON: {e}")
        return {"topics": [], "entities": [], "domain": "general"}
    except Exception as e:
        logger.error(f"Error extracting topics: {e}")
        return {"topics": [], "entities": [], "domain": "general"}


async def get_related_notes_for_topics(
    topics: List[str],
    entities: List[str],
    domain: str,
    max_notes: int = 7
) -> List[Dict[str, Any]]:
    """
    Query knowledge graph for related notes using extracted topics.

    Args:
        topics: List of topics from first pass
        entities: List of entities from first pass
        domain: Domain/field from first pass
        max_notes: Maximum notes to retrieve

    Returns:
        List of related notes with metadata
    """
    if not topics and not entities:
        return []

    # Build search query from topics and entities
    search_terms = topics[:5] + entities[:3]
    if domain and domain != "general":
        search_terms.append(domain)

    search_query = " ".join(search_terms)

    # Search for related notes
    try:
        results = search_knowledge_graph(
            query=search_query,
            node_types=["note"],
            limit=max_notes * 2  # Get more than needed, will filter
        )

        # Filter and format results
        related_notes = []
        seen_titles = set()

        for result in results:
            if result.get("type") != "note":
                continue

            title = result.get("name", "")
            if title in seen_titles:
                continue
            seen_titles.add(title)

            # Get full note data from the graph
            note_data = _get_note_details(result.get("id", ""))
            if note_data:
                related_notes.append({
                    "id": result.get("id"),
                    "title": note_data.get("title", title),
                    "tags": note_data.get("tags", result.get("tags", [])),
                    "body": note_data.get("body", "")[:500],  # Truncate for context
                    "relevance_score": result.get("score", 0)
                })

            if len(related_notes) >= max_notes:
                break

        return related_notes

    except Exception as e:
        logger.error(f"Error searching knowledge graph: {e}")
        return []


def _get_note_details(note_id: str) -> Optional[Dict[str, Any]]:
    """Get full note details from the knowledge graph."""
    try:
        graph = build_graph()
        for node in graph.get("nodes", []):
            if node.get("id") == note_id and node.get("type") == "note":
                return node
        return None
    except Exception as e:
        logger.error(f"Error getting note details: {e}")
        return None


def format_context_notes_for_prompt(notes: List[Dict[str, Any]]) -> str:
    """Format related notes for inclusion in the prompt."""
    if not notes:
        return "No existing related notes found in your knowledge base."

    formatted = []
    for i, note in enumerate(notes, 1):
        tags_str = " ".join(note.get("tags", [])) if note.get("tags") else "(no tags)"
        formatted.append(f"""### Note {i}: {note.get('title', 'Untitled')}
Tags: {tags_str}
{note.get('body', '')}
""")

    return "\n---\n".join(formatted)


def get_existing_tags() -> List[str]:
    """Get all existing tags from the knowledge graph for consistency."""
    try:
        graph = build_graph()
        all_tags = set()

        for node in graph.get("nodes", []):
            if node.get("type") == "note":
                for tag in node.get("tags", []):
                    all_tags.add(tag.lower())

        return sorted(list(all_tags))[:50]  # Return top 50 most common

    except Exception as e:
        logger.error(f"Error getting existing tags: {e}")
        return []


async def generate_zettels_knowledge_graph(
    content: str,
    system_prompt: str,
    model: Optional[str] = None,
    user_comment: Optional[str] = None,
    max_context_notes: int = 7
) -> Dict[str, Any]:
    """
    Main function for Knowledge Graph mode.

    1. Extract topics (first pass)
    2. Retrieve related notes
    3. Generate notes with context (second pass)

    Args:
        content: Source content (transcript or article markdown)
        system_prompt: Base Zettel system prompt
        model: Model to use (defaults to synthesizer_model setting)
        user_comment: Optional user guidance/comment
        max_context_notes: Maximum related notes to include as context

    Returns:
        Dict with notes, raw_response, model, context_notes, topics_extracted
    """
    if model is None:
        model = get_synthesizer_model()

    generation_ids = []

    # =========================================================================
    # STEP 1: Extract topics from source content (first pass)
    # =========================================================================
    logger.info("Knowledge Graph Mode: Extracting topics from content")

    topics_result = await extract_topics_from_content(content)
    topics_extracted = {
        "topics": topics_result.get("topics", []),
        "entities": topics_result.get("entities", []),
        "domain": topics_result.get("domain", "general")
    }

    logger.info(f"Extracted {len(topics_extracted['topics'])} topics, {len(topics_extracted['entities'])} entities")

    # =========================================================================
    # STEP 2: Retrieve related notes from knowledge graph
    # =========================================================================
    logger.info("Knowledge Graph Mode: Retrieving related notes")

    context_notes = await get_related_notes_for_topics(
        topics=topics_extracted["topics"],
        entities=topics_extracted["entities"],
        domain=topics_extracted["domain"],
        max_notes=max_context_notes
    )

    logger.info(f"Retrieved {len(context_notes)} related notes from knowledge graph")

    # Get existing tags for consistency
    existing_tags = get_existing_tags()

    # =========================================================================
    # STEP 3: Generate notes with knowledge graph context (second pass)
    # =========================================================================
    logger.info(f"Knowledge Graph Mode: Generating notes with model {model}")

    # Format context notes for the prompt
    context_notes_text = format_context_notes_for_prompt(context_notes)

    # Format existing tags
    existing_tags_text = ", ".join(existing_tags[:30]) if existing_tags else "(no existing tags yet)"

    # Build enhanced system prompt with knowledge graph context
    kg_system_prompt = f"""{system_prompt}

## Your Knowledge Graph Context

The following notes already exist in the knowledge base and are relevant to the content you're processing:

{context_notes_text}

## Existing Tags in Your Knowledge Base
{existing_tags_text}

## Knowledge Graph Integration Guidelines
1. **Consistency**: Use terminology, tags, and concepts that align with existing notes
2. **Avoid Redundancy**: If a concept is already well-covered in existing notes, reference it briefly rather than duplicating
3. **Fill Gaps**: Focus on new insights not already captured
4. **Natural Connections**: Write notes that will naturally connect via shared tags and concepts
5. **Tag Reuse**: Prefer existing tags where relevant to strengthen the knowledge graph"""

    # Build user message with content and optional comment
    user_message = f"Generate Zettelkasten notes from the following content:\n\n{content}"
    if user_comment:
        user_message += f"\n\n---\nUser guidance: {user_comment}"

    messages = [
        {"role": "system", "content": kg_system_prompt},
        {"role": "user", "content": user_message}
    ]

    response = await query_model(model, messages, timeout=180.0)

    if response is None:
        logger.error(f"Model {model} failed to respond in KG mode")
        return {
            "notes": [],
            "raw_response": "Error: Model failed to respond",
            "model": model,
            "generation_id": None,
            "context_notes": context_notes,
            "topics_extracted": topics_extracted
        }

    raw_response = response.get("content", "")
    generation_id = response.get("generation_id")
    if generation_id:
        generation_ids.append(generation_id)

    notes = parse_zettels(raw_response)

    logger.info(f"Knowledge Graph Mode: Generated {len(notes)} notes")

    return {
        "notes": notes,
        "raw_response": raw_response,
        "model": model,
        "generation_id": generation_id,
        "generation_ids": generation_ids,
        "context_notes": context_notes,
        "topics_extracted": topics_extracted
    }
