"""Knowledge Graph module for connecting Synthesizer notes."""

import json
import os
import re
import uuid
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from difflib import SequenceMatcher

from .openrouter import query_model
from .storage import get_conversation, list_conversations
from .settings import get_knowledge_graph_model

logger = logging.getLogger(__name__)

# Data directory for knowledge graph storage
KNOWLEDGE_GRAPH_DIR = os.getenv("KNOWLEDGE_GRAPH_DIR", "data/knowledge_graph")


def ensure_kg_dir():
    """Ensure the knowledge graph directory exists."""
    Path(KNOWLEDGE_GRAPH_DIR).mkdir(parents=True, exist_ok=True)


def get_entities_path() -> str:
    """Get the path to the entities storage file."""
    return os.path.join(KNOWLEDGE_GRAPH_DIR, "entities.json")


def get_manual_links_path() -> str:
    """Get the path to the manual links storage file."""
    return os.path.join(KNOWLEDGE_GRAPH_DIR, "manual_links.json")


def load_entities() -> Dict[str, Any]:
    """Load entities from storage."""
    ensure_kg_dir()
    path = get_entities_path()

    if os.path.exists(path):
        with open(path, 'r') as f:
            data = json.load(f)
            # Ensure entity_relationships exists (migration)
            if "entity_relationships" not in data:
                data["entity_relationships"] = []
            return data

    return {
        "entities": {},
        "note_entities": {},
        "entity_relationships": [],
        "processed_conversations": [],
        "updated_at": None
    }


def save_entities(data: Dict[str, Any]):
    """Save entities to storage."""
    ensure_kg_dir()
    data["updated_at"] = datetime.utcnow().isoformat()

    path = get_entities_path()
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def load_manual_links() -> Dict[str, Any]:
    """Load manual links from storage."""
    ensure_kg_dir()
    path = get_manual_links_path()

    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)

    return {
        "manual_links": [],
        "entity_merges": [],
        "dismissed_links": [],
        "reviewed_entities": [],
        "updated_at": None
    }


def save_manual_links(data: Dict[str, Any]):
    """Save manual links to storage."""
    ensure_kg_dir()
    data["updated_at"] = datetime.utcnow().isoformat()

    path = get_manual_links_path()
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


# Entity extraction prompt
ENTITY_EXTRACTION_PROMPT = """Extract key entities from this knowledge note. Return a JSON array.

Title: {title}
Content: {body}

Return format (JSON array only, no other text):
[{{"name": "Entity Name", "type": "person|organization|concept|technology|event", "context": "brief context from the note"}}]

Rules:
- Extract only significant, reusable entities (not generic terms like "technology", "system", "data")
- Normalize names (e.g., "AI" not "artificial intelligence" if that's the common form)
- Type must be one of: person, organization, concept, technology, event
- Maximum 5 entities per note
- Return empty array [] if no significant entities found
- Return ONLY the JSON array, no explanation"""

# Entity relationship extraction prompt
RELATIONSHIP_EXTRACTION_PROMPT = """Given these entities extracted from the same note, identify conceptual relationships between them.

Entities: {entities}

Return format (JSON array only, no other text):
[{{"source": "Entity A name", "target": "Entity B name", "type": "relationship_type"}}]

Relationship types (choose the most appropriate):
- specialization_of: Source is a specific form/type of target (e.g., "Deep Learning" specialization_of "Machine Learning")
- enabled_by: Source is powered by or depends on target (e.g., "GPT-4" enabled_by "Transformers")
- builds_on: Source extends or is built upon target (e.g., "RAG" builds_on "Vector Search")
- contrasts_with: Source is an alternative or opposite of target (e.g., "Supervised Learning" contrasts_with "Unsupervised Learning")
- applies_to: Source is used in or applies to target domain (e.g., "NLP" applies_to "Chatbots")
- created_by: Source was created by target (e.g., "GPT-4" created_by "OpenAI")

Rules:
- Only identify meaningful, educational relationships that help connect concepts
- Maximum 3 relationships per set of entities
- Return empty array [] if no significant relationships exist
- Return ONLY the JSON array, no explanation"""


# Valid relationship types
VALID_RELATIONSHIP_TYPES = {
    "specialization_of",
    "enabled_by",
    "builds_on",
    "contrasts_with",
    "applies_to",
    "created_by"
}


async def extract_entities_from_note(
    note: Dict[str, Any],
    model: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Extract entities from a single note using LLM.

    Args:
        note: Note dict with title and body
        model: Model to use for extraction (defaults to settings)

    Returns:
        List of entity dicts with name, type, context
    """
    if model is None:
        model = get_knowledge_graph_model()

    prompt = ENTITY_EXTRACTION_PROMPT.format(
        title=note.get("title", ""),
        body=note.get("body", "")
    )

    messages = [
        {"role": "user", "content": prompt}
    ]

    try:
        response = await query_model(model, messages, timeout=30.0)

        if response is None:
            logger.warning(f"Failed to extract entities from note: {note.get('title', 'unknown')}")
            return []

        content = response.get("content", "").strip()

        # Parse JSON from response
        # Handle potential markdown code blocks
        if content.startswith("```"):
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)

        entities = json.loads(content)

        # Validate entity structure
        valid_entities = []
        valid_types = {"person", "organization", "concept", "technology", "event"}

        for entity in entities:
            if isinstance(entity, dict) and "name" in entity and "type" in entity:
                if entity["type"] in valid_types:
                    valid_entities.append({
                        "name": entity["name"].strip(),
                        "type": entity["type"],
                        "context": entity.get("context", "")
                    })

        return valid_entities[:5]  # Max 5 entities per note

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse entity JSON for note '{note.get('title', 'unknown')}': {e}")
        return []
    except Exception as e:
        logger.error(f"Error extracting entities: {e}")
        return []


async def extract_entity_relationships(
    entities: List[Dict[str, Any]],
    conversation_id: str,
    note_id: str,
    model: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Extract conceptual relationships between entities from the same note.

    Args:
        entities: List of entity dicts with name, type, context
        conversation_id: Source conversation ID
        note_id: Source note ID
        model: Model to use for extraction (defaults to settings)

    Returns:
        List of relationship dicts with source, target, type
    """
    # Need at least 2 entities to find relationships
    if len(entities) < 2:
        return []

    if model is None:
        model = get_knowledge_graph_model()

    # Format entities for the prompt
    entities_str = ", ".join([f'"{e["name"]}" ({e["type"]})' for e in entities])

    prompt = RELATIONSHIP_EXTRACTION_PROMPT.format(entities=entities_str)

    messages = [
        {"role": "user", "content": prompt}
    ]

    try:
        response = await query_model(model, messages, timeout=30.0)

        if response is None:
            logger.warning(f"Failed to extract relationships for note: {note_id}")
            return []

        content = response.get("content", "").strip()

        # Parse JSON from response
        if content.startswith("```"):
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)

        relationships_raw = json.loads(content)

        # Validate and format relationships
        valid_relationships = []
        entity_names = {e["name"].lower() for e in entities}

        for rel in relationships_raw:
            if not isinstance(rel, dict):
                continue

            source = rel.get("source", "").strip()
            target = rel.get("target", "").strip()
            rel_type = rel.get("type", "").strip()

            # Validate relationship type
            if rel_type not in VALID_RELATIONSHIP_TYPES:
                continue

            # Validate entities exist in our list (case-insensitive)
            if source.lower() not in entity_names or target.lower() not in entity_names:
                continue

            # Create relationship with unique ID
            valid_relationships.append({
                "id": f"rel_{uuid.uuid4().hex[:8]}",
                "source_entity": source,
                "target_entity": target,
                "type": rel_type,
                "bidirectional": rel_type == "contrasts_with",
                "source_note": f"note:{conversation_id}:{note_id}"
            })

        return valid_relationships[:3]  # Max 3 relationships per note

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse relationship JSON for note '{note_id}': {e}")
        return []
    except Exception as e:
        logger.error(f"Error extracting relationships: {e}")
        return []


def create_hierarchical_relationships(entities: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Find and create relationships between compound entities and their root entities.

    This function automatically detects compound entity names (e.g., "unix-philosophy",
    "machine-learning") and creates specialization_of relationships to root entities
    (e.g., "unix", "machine") if they exist.

    Args:
        entities: Dict of entity_id -> entity data

    Returns:
        List of new relationship dicts ready to be added to entity_relationships
    """
    relationships = []

    # Build a lookup of entity names to IDs (lowercase for matching)
    entity_name_to_id = {}
    for entity_id, entity in entities.items():
        name_lower = entity.get("name", "").lower().strip()
        if name_lower:
            entity_name_to_id[name_lower] = entity_id

    for entity_id, entity in entities.items():
        name = entity.get("name", "").lower().strip()
        if not name:
            continue

        # Split on common separators: hyphen, underscore, space
        parts = re.split(r'[-_\s]+', name)
        if len(parts) < 2:
            continue

        # Check if the first part (root term) exists as a separate entity
        root_term = parts[0]
        if root_term in entity_name_to_id and root_term != name:
            root_id = entity_name_to_id[root_term]
            root_entity = entities.get(root_id, {})

            relationships.append({
                "id": f"rel_hier_{uuid.uuid4().hex[:8]}",
                "source_entity_id": entity_id,
                "target_entity_id": root_id,
                "source_entity_name": entity.get("name", ""),
                "target_entity_name": root_entity.get("name", ""),
                "type": "specialization_of",
                "bidirectional": False,
                "auto_generated": True,
                "source_note": None  # Not from a specific note
            })

    return relationships


def run_hierarchical_normalization() -> Dict[str, Any]:
    """
    Run hierarchical entity normalization on all existing entities.

    Finds compound entities and creates specialization_of relationships
    to their root entities.

    Returns:
        Summary of relationships created
    """
    data = load_entities()
    entities = data.get("entities", {})
    existing_relationships = data.get("entity_relationships", [])

    # Find new hierarchical relationships
    new_relationships = create_hierarchical_relationships(entities)

    # Filter out duplicates (same source and target entity pair with same type)
    existing_pairs = set()
    for rel in existing_relationships:
        pair = (rel.get("source_entity_id"), rel.get("target_entity_id"), rel.get("type"))
        existing_pairs.add(pair)

    added_count = 0
    for rel in new_relationships:
        pair = (rel.get("source_entity_id"), rel.get("target_entity_id"), rel.get("type"))
        if pair not in existing_pairs:
            existing_relationships.append(rel)
            existing_pairs.add(pair)
            added_count += 1

    # Save if we added any new relationships
    if added_count > 0:
        data["entity_relationships"] = existing_relationships
        save_entities(data)

    return {
        "total_entities": len(entities),
        "new_relationships_created": added_count,
        "total_relationships": len(existing_relationships)
    }


def similarity_ratio(s1: str, s2: str) -> float:
    """Calculate similarity ratio between two strings."""
    return SequenceMatcher(None, s1.lower(), s2.lower()).ratio()


def find_similar_entity(
    name: str,
    existing_entities: Dict[str, Dict[str, Any]],
    threshold: float = 0.85
) -> Optional[str]:
    """
    Find an existing entity with similar name.

    Args:
        name: Entity name to match
        existing_entities: Dict of existing entities
        threshold: Similarity threshold (0-1)

    Returns:
        Entity ID if match found, None otherwise
    """
    name_lower = name.lower().strip()

    for entity_id, entity in existing_entities.items():
        existing_name = entity.get("name", "").lower().strip()

        # Exact match
        if name_lower == existing_name:
            return entity_id

        # Fuzzy match
        if similarity_ratio(name_lower, existing_name) >= threshold:
            return entity_id

        # Handle common variations
        # "OpenAI" vs "Open AI"
        if name_lower.replace(" ", "") == existing_name.replace(" ", ""):
            return entity_id

    return None


def standardize_entity(
    entity: Dict[str, Any],
    existing_entities: Dict[str, Dict[str, Any]],
    conversation_id: str,
    note_id: str
) -> str:
    """
    Standardize an entity by finding existing match or creating new.

    Args:
        entity: Entity dict with name, type, context
        existing_entities: Dict of existing entities
        conversation_id: Source conversation ID
        note_id: Source note ID

    Returns:
        Entity ID (existing or new)
    """
    name = entity["name"]

    # Check for existing similar entity
    existing_id = find_similar_entity(name, existing_entities)

    if existing_id:
        # Add mention to existing entity
        mention = {
            "conversation_id": conversation_id,
            "note_id": note_id,
            "context": entity.get("context", "")
        }

        if "mentions" not in existing_entities[existing_id]:
            existing_entities[existing_id]["mentions"] = []

        # Avoid duplicate mentions
        existing_mentions = existing_entities[existing_id]["mentions"]
        mention_key = f"{conversation_id}:{note_id}"
        if not any(m["conversation_id"] == conversation_id and m["note_id"] == note_id
                   for m in existing_mentions):
            existing_mentions.append(mention)

        return existing_id

    # Create new entity
    entity_id = str(uuid.uuid4())[:8]
    existing_entities[entity_id] = {
        "id": entity_id,
        "name": name,
        "type": entity["type"],
        "mentions": [{
            "conversation_id": conversation_id,
            "note_id": note_id,
            "context": entity.get("context", "")
        }]
    }

    return entity_id


async def extract_entities_for_conversation(
    conversation_id: str,
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Extract entities from all notes in a conversation.

    Args:
        conversation_id: Conversation ID
        model: Model to use for extraction (defaults to settings)

    Returns:
        Dict with extracted entity count and details
    """
    if model is None:
        model = get_knowledge_graph_model()

    conversation = get_conversation(conversation_id)

    if not conversation:
        return {"error": "Conversation not found", "count": 0}

    if conversation.get("mode") != "synthesizer":
        return {"error": "Not a synthesizer conversation", "count": 0}

    # Load existing entities
    data = load_entities()
    existing_entities = data.get("entities", {})
    note_entities = data.get("note_entities", {})
    entity_relationships = data.get("entity_relationships", [])

    total_extracted = 0
    total_relationships = 0
    notes_processed = 0

    # Process each message with notes
    for msg in conversation.get("messages", []):
        if msg.get("role") != "assistant":
            continue

        notes = msg.get("notes", [])

        for note in notes:
            note_key = f"{conversation_id}:{note['id']}"

            # Extract entities
            entities = await extract_entities_from_note(note, model)

            # Standardize and store
            entity_ids = []
            for entity in entities:
                entity_id = standardize_entity(
                    entity, existing_entities, conversation_id, note["id"]
                )
                entity_ids.append(entity_id)

            note_entities[note_key] = entity_ids
            total_extracted += len(entities)

            # Extract relationships between entities in this note
            if len(entities) >= 2:
                relationships = await extract_entity_relationships(
                    entities, conversation_id, note["id"], model
                )

                # Map entity names to IDs for storage
                name_to_id = {}
                for entity in entities:
                    entity_id = find_similar_entity(entity["name"], existing_entities)
                    if entity_id:
                        name_to_id[entity["name"].lower()] = entity_id

                # Store relationships with entity IDs
                for rel in relationships:
                    source_id = name_to_id.get(rel["source_entity"].lower())
                    target_id = name_to_id.get(rel["target_entity"].lower())

                    if source_id and target_id:
                        # Check for duplicate relationship
                        existing = any(
                            r["source_entity_id"] == source_id and
                            r["target_entity_id"] == target_id and
                            r["type"] == rel["type"]
                            for r in entity_relationships
                        )

                        if not existing:
                            entity_relationships.append({
                                "id": rel["id"],
                                "source_entity_id": source_id,
                                "target_entity_id": target_id,
                                "source_entity_name": rel["source_entity"],
                                "target_entity_name": rel["target_entity"],
                                "type": rel["type"],
                                "bidirectional": rel["bidirectional"],
                                "source_note": rel["source_note"]
                            })
                            total_relationships += 1

            notes_processed += 1

    # Mark conversation as processed
    processed = data.get("processed_conversations", [])
    if conversation_id not in processed:
        processed.append(conversation_id)

    # Save updated data
    data["entities"] = existing_entities
    data["note_entities"] = note_entities
    data["entity_relationships"] = entity_relationships
    data["processed_conversations"] = processed
    save_entities(data)

    return {
        "conversation_id": conversation_id,
        "notes_processed": notes_processed,
        "entities_extracted": total_extracted,
        "relationships_extracted": total_relationships,
        "unique_entities": len(existing_entities)
    }


def build_graph() -> Dict[str, Any]:
    """
    Build the complete knowledge graph from all data.

    Returns:
        Dict with nodes, links, and stats
    """
    data = load_entities()
    manual_links_data = load_manual_links()

    nodes = []
    links = []
    source_notes = {}  # Group notes by conversation (source)
    tag_index = {}  # Map tags to note IDs

    # Get all synthesizer conversations
    all_conversations = list_conversations()
    synth_conversations = [c for c in all_conversations if c.get("mode") == "synthesizer"]

    # Build nodes and collect source/tag information
    for conv in synth_conversations:
        conversation_id = conv["id"]
        full_conv = get_conversation(conversation_id)

        if not full_conv:
            continue

        # Get source info
        source_title = full_conv.get("title", "Untitled")
        source_url = None
        source_type = "article"

        # Find source info from first assistant message
        for msg in full_conv.get("messages", []):
            if msg.get("role") == "assistant":
                source_url = msg.get("source_url")
                source_type = msg.get("source_type", "article")
                if msg.get("source_title"):
                    source_title = msg["source_title"]
                break

        # Add source node
        source_node_id = f"source:{conversation_id}"
        nodes.append({
            "id": source_node_id,
            "type": "source",
            "title": source_title,
            "url": source_url,
            "sourceType": source_type,
            "conversationId": conversation_id
        })

        # Collect notes from this conversation
        conv_notes = []
        for msg in full_conv.get("messages", []):
            if msg.get("role") != "assistant":
                continue

            for note in msg.get("notes", []):
                conv_notes.append(note)

        source_notes[conversation_id] = conv_notes

        # Add note nodes with sequence
        for idx, note in enumerate(conv_notes):
            note_id = f"note:{conversation_id}:{note['id']}"

            nodes.append({
                "id": note_id,
                "type": "note",
                "title": note.get("title", ""),
                "tags": note.get("tags", []),
                "body": note.get("body", ""),  # Full body for detail panel
                "group": conversation_id,
                "sequence": idx + 1,
                "sourceId": source_node_id,
                "sourceUrl": source_url,  # URL of original source
                "sourceType": source_type,  # Type of source (youtube, podcast, pdf, article)
                "created_at": full_conv.get("created_at"),  # Conversation creation time
            })

            # Index tags for cross-source linking
            for tag in note.get("tags", []):
                tag_clean = tag.lower().strip()
                if tag_clean not in tag_index:
                    tag_index[tag_clean] = []
                tag_index[tag_clean].append(note_id)

            # Add sequential link within source
            if idx > 0:
                prev_note = conv_notes[idx - 1]
                prev_note_id = f"note:{conversation_id}:{prev_note['id']}"
                links.append({
                    "source": prev_note_id,
                    "target": note_id,
                    "type": "sequential",
                    "order": idx
                })

    # Add entity nodes and links
    entities = data.get("entities", {})
    note_entities = data.get("note_entities", {})

    for entity_id, entity in entities.items():
        # Only add entities that have at least 1 mention
        if not entity.get("mentions"):
            continue

        entity_node_id = f"entity:{entity_id}"
        nodes.append({
            "id": entity_node_id,
            "type": "entity",
            "name": entity.get("name", ""),
            "entityType": entity.get("type", "concept"),
            "mentionCount": len(entity.get("mentions", []))
        })

        # Add links from notes to entities
        for mention in entity.get("mentions", []):
            note_id = f"note:{mention['conversation_id']}:{mention['note_id']}"
            links.append({
                "source": note_id,
                "target": entity_node_id,
                "type": "mentions"
            })

    # Add cross-source tag links
    for tag, note_ids in tag_index.items():
        if len(note_ids) < 2:
            continue

        # Create links between notes sharing this tag (across different sources)
        seen_pairs = set()
        for i, note_id_1 in enumerate(note_ids):
            for note_id_2 in note_ids[i+1:]:
                # Extract conversation IDs
                conv1 = note_id_1.split(":")[1]
                conv2 = note_id_2.split(":")[1]

                # Only link across different sources
                if conv1 == conv2:
                    continue

                pair = tuple(sorted([note_id_1, note_id_2]))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)

                links.append({
                    "source": note_id_1,
                    "target": note_id_2,
                    "type": "shared_tag",
                    "value": tag
                })

    # Add manual links
    for manual_link in manual_links_data.get("manual_links", []):
        if manual_link["id"] not in manual_links_data.get("dismissed_links", []):
            links.append({
                "source": manual_link["source"],
                "target": manual_link["target"],
                "type": "manual",
                "label": manual_link.get("label", "related")
            })

    # Calculate stats
    note_count = sum(1 for n in nodes if n["type"] == "note")
    source_count = sum(1 for n in nodes if n["type"] == "source")
    entity_count = sum(1 for n in nodes if n["type"] == "entity")

    return {
        "nodes": nodes,
        "links": links,
        "stats": {
            "notes": note_count,
            "sources": source_count,
            "entities": entity_count,
            "connections": len(links),
            "processedConversations": len(data.get("processed_conversations", []))
        }
    }


def get_related_notes(note_id: str) -> Dict[str, Any]:
    """
    Get notes related to a specific note via the knowledge graph.

    Finds connections through:
    - Shared tags (cross-source)
    - Shared entities (direct)
    - Entity relationships (multi-hop via conceptual links)
    - Sequential notes (same source)
    - Same source

    Args:
        note_id: The full note ID (e.g., "note:conversation_id:note_id")

    Returns:
        Dict with related notes grouped by connection type, each with explanation
    """
    # Build the graph first (could cache this for performance)
    graph = build_graph()
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    data = load_entities()
    entity_relationships = data.get("entity_relationships", [])
    entities = data.get("entities", {})

    # Build lookups
    node_map = {n["id"]: n for n in nodes}
    entity_map = {f"entity:{eid}": e for eid, e in entities.items()}

    # Track found notes with their best connection info
    found_notes = {}  # note_id -> {note, connection_type, score, path_info}

    target_note = node_map.get(note_id)
    if not target_note:
        return {"error": "Note not found", "related": {
            "sequential": [], "shared_tag": [], "shared_entity": [], "same_source": []
        }}

    source_id = target_note.get("sourceId")

    # Helper to add a found note
    def add_found(nid: str, conn_type: str, score: int, path_info: Dict):
        if nid == note_id:
            return
        node = node_map.get(nid)
        if not node or node.get("type") != "note":
            return
        # Keep the highest score connection for each note
        if nid not in found_notes or found_notes[nid]["score"] < score:
            found_notes[nid] = {
                "note": node,
                "connectionType": conn_type,
                "score": score,
                "path_info": path_info
            }

    # 1. Find shared tag connections
    note_tags = set(t.lower() for t in target_note.get("tags", []))
    for link in links:
        if link.get("type") != "shared_tag":
            continue
        source = link.get("source")
        target = link.get("target")
        if isinstance(source, dict):
            source = source.get("id")
        if isinstance(target, dict):
            target = target.get("id")

        connected_id = None
        if source == note_id:
            connected_id = target
        elif target == note_id:
            connected_id = source

        if connected_id:
            connected_node = node_map.get(connected_id)
            if connected_node and connected_node.get("type") == "note":
                other_tags = set(t.lower() for t in connected_node.get("tags", []))
                shared_tags = list(note_tags & other_tags)
                # Cross-source tag sharing scores higher
                is_cross_source = connected_node.get("sourceId") != source_id
                score = 5 if is_cross_source else 2
                add_found(connected_id, "shared_tag", score, {"sharedTags": shared_tags})

    # 2. Find shared entity connections (direct)
    note_entity_ids = set()
    for link in links:
        if link.get("type") != "mentions":
            continue
        source = link.get("source")
        target = link.get("target")
        if isinstance(source, dict):
            source = source.get("id")
        if isinstance(target, dict):
            target = target.get("id")

        if source == note_id and target.startswith("entity:"):
            note_entity_ids.add(target)

    # Find other notes mentioning same entities
    for entity_id in note_entity_ids:
        entity_node = node_map.get(entity_id) or entity_map.get(entity_id)
        entity_name = entity_node.get("name") if entity_node else entity_id.split(":")[-1]

        for link in links:
            if link.get("type") != "mentions":
                continue
            source = link.get("source")
            target = link.get("target")
            if isinstance(source, dict):
                source = source.get("id")
            if isinstance(target, dict):
                target = target.get("id")

            if target == entity_id and source != note_id:
                add_found(source, "shared_entity", 10, {"sharedEntity": entity_name})

    # 3. Find multi-hop connections via entity relationships
    # For each entity this note mentions, find related entities and notes mentioning them
    for entity_node_id in note_entity_ids:
        entity_id = entity_node_id.replace("entity:", "")
        entity = entities.get(entity_id, {})
        entity_name = entity.get("name", "")

        # Find relationships where this entity is source or target
        for rel in entity_relationships:
            related_entity_id = None
            relationship_type = rel.get("type")
            is_source = rel.get("source_entity_id") == entity_id
            is_target = rel.get("target_entity_id") == entity_id

            if is_source:
                related_entity_id = rel.get("target_entity_id")
                related_entity_name = rel.get("target_entity_name")
            elif is_target:
                related_entity_id = rel.get("source_entity_id")
                related_entity_name = rel.get("source_entity_name")

            if not related_entity_id:
                continue

            # Find notes mentioning the related entity
            related_entity_node_id = f"entity:{related_entity_id}"
            for link in links:
                if link.get("type") != "mentions":
                    continue
                source = link.get("source")
                target = link.get("target")
                if isinstance(source, dict):
                    source = source.get("id")
                if isinstance(target, dict):
                    target = target.get("id")

                if target == related_entity_node_id and source != note_id:
                    path_info = {
                        "sourceEntity": entity_name,
                        "relationship": relationship_type,
                        "targetEntity": related_entity_name,
                        "isSource": is_source
                    }
                    add_found(source, "via_relationship", 7, path_info)

    # 4. Find sequential connections (same source, adjacent)
    for link in links:
        if link.get("type") != "sequential":
            continue
        source = link.get("source")
        target = link.get("target")
        if isinstance(source, dict):
            source = source.get("id")
        if isinstance(target, dict):
            target = target.get("id")

        connected_id = None
        if source == note_id:
            connected_id = target
        elif target == note_id:
            connected_id = source

        if connected_id:
            add_found(connected_id, "sequential", 3, {})

    # 5. Find same source notes (not already found)
    for node in nodes:
        if (node.get("type") == "note" and
            node.get("sourceId") == source_id and
            node["id"] != note_id and
            node["id"] not in found_notes):
            add_found(node["id"], "same_source", 2, {})

    # Group by connection type for backward compatibility
    related = {
        "sequential": [],
        "shared_tag": [],
        "shared_entity": [],
        "via_relationship": [],
        "same_source": [],
    }

    # Add explanation to each note
    for nid, data in found_notes.items():
        note_data = {
            **data["note"],
            "connectionType": data["connectionType"],
            "score": data["score"],
            "explanation": _explain_path(data["connectionType"], data["path_info"]),
            **data["path_info"]
        }

        conn_type = data["connectionType"]
        if conn_type in related:
            related[conn_type].append(note_data)
        else:
            related["shared_entity"].append(note_data)

    # Sort each category
    related["sequential"].sort(key=lambda x: x.get("sequence", 0))
    related["same_source"].sort(key=lambda x: x.get("sequence", 0))

    # Sort cross-source connections by score (descending)
    related["shared_tag"].sort(key=lambda x: -x.get("score", 0))
    related["shared_entity"].sort(key=lambda x: -x.get("score", 0))
    related["via_relationship"].sort(key=lambda x: -x.get("score", 0))

    return {
        "noteId": note_id,
        "note": target_note,
        "related": related,
        "totalConnections": sum(len(v) for v in related.values())
    }


def _explain_path(connection_type: str, path_info: Dict[str, Any]) -> str:
    """
    Generate a human-readable explanation for a connection path.

    Args:
        connection_type: Type of connection (shared_tag, shared_entity, etc.)
        path_info: Additional path information

    Returns:
        Human-readable explanation string
    """
    if connection_type == "shared_tag":
        tags = path_info.get("sharedTags", [])
        if len(tags) == 1:
            return f"Both tagged #{tags[0]}"
        elif len(tags) > 1:
            return f"Shares #{tags[0]} and #{tags[1]}" + (f" (+{len(tags)-2})" if len(tags) > 2 else "")
        return "Shares tags"

    if connection_type == "shared_entity":
        entity = path_info.get("sharedEntity", "")
        return f"Both discuss '{entity}'"

    if connection_type == "via_relationship":
        source_entity = path_info.get("sourceEntity", "")
        target_entity = path_info.get("targetEntity", "")
        relationship = path_info.get("relationship", "")
        is_source = path_info.get("isSource", True)

        templates = {
            "specialization_of": (
                f"'{source_entity}' is a form of '{target_entity}', explored here"
                if is_source else
                f"'{target_entity}' is a form of '{source_entity}', explored here"
            ),
            "enabled_by": (
                f"'{source_entity}' is powered by '{target_entity}', which this covers"
                if is_source else
                f"'{target_entity}' enables '{source_entity}', discussed here"
            ),
            "builds_on": (
                f"'{source_entity}' builds on '{target_entity}', foundational here"
                if is_source else
                f"'{target_entity}' extends '{source_entity}', covered here"
            ),
            "contrasts_with": f"'{source_entity}' contrasts with '{target_entity}', discussed here",
            "applies_to": (
                f"'{source_entity}' applies to '{target_entity}', the focus here"
                if is_source else
                f"'{target_entity}' applies to '{source_entity}', discussed here"
            ),
            "created_by": (
                f"'{source_entity}' was created by '{target_entity}', mentioned here"
                if is_source else
                f"'{target_entity}' created '{source_entity}', discussed here"
            ),
        }

        return templates.get(
            relationship,
            f"Connected: '{source_entity}' → '{target_entity}'"
        )

    if connection_type == "sequential":
        return "Next in source"

    if connection_type == "same_source":
        return "From the same source"

    return "Related"


def get_graph_stats() -> Dict[str, Any]:
    """Get statistics about the knowledge graph."""
    data = load_entities()
    manual_links_data = load_manual_links()

    entities = data.get("entities", {})

    # Count entities by type
    type_counts = {}
    for entity in entities.values():
        entity_type = entity.get("type", "unknown")
        type_counts[entity_type] = type_counts.get(entity_type, 0) + 1

    # Get all synthesizer conversations
    all_conversations = list_conversations()
    synth_conversations = [c for c in all_conversations if c.get("mode") == "synthesizer"]

    # Count notes
    total_notes = 0
    for conv in synth_conversations:
        full_conv = get_conversation(conv["id"])
        if full_conv:
            for msg in full_conv.get("messages", []):
                if msg.get("role") == "assistant":
                    total_notes += len(msg.get("notes", []))

    return {
        "total_notes": total_notes,
        "total_entities": len(entities),
        "entity_types": type_counts,
        "processed_conversations": len(data.get("processed_conversations", [])),
        "total_conversations": len(synth_conversations),
        "manual_links": len(manual_links_data.get("manual_links", [])),
        "reviewed_entities": len(manual_links_data.get("reviewed_entities", [])),
        "updated_at": data.get("updated_at")
    }


def get_note_entities(note_id: str) -> Dict[str, Any]:
    """
    Get entities extracted from a specific note.

    Args:
        note_id: Full note ID in format "note:conversation_id:note_id"

    Returns:
        Dict with entities list and extraction status
    """
    data = load_entities()
    entities = data.get("entities", {})
    note_entities = data.get("note_entities", {})
    processed_conversations = data.get("processed_conversations", [])
    entity_relationships = data.get("entity_relationships", [])

    # Parse note_id to get conversation_id
    # Format: "note:conversation_id:note_id"
    parts = note_id.split(":")
    if len(parts) >= 2:
        conversation_id = parts[1]
    else:
        conversation_id = None

    # Check if conversation was processed
    is_processed = conversation_id in processed_conversations if conversation_id else False

    # Build the note key for lookup
    # note_entities uses "conversation_id:note_id" as key
    if len(parts) >= 3:
        note_key = f"{parts[1]}:{parts[2]}"
    else:
        note_key = note_id.replace("note:", "")

    # Get entity IDs for this note
    entity_ids = note_entities.get(note_key, [])

    # Build full entity details
    note_entity_list = []
    for entity_id in entity_ids:
        entity = entities.get(entity_id)
        if entity:
            # Find context for this specific note from mentions
            context = None
            for mention in entity.get("mentions", []):
                mention_key = f"{mention.get('conversation_id')}:{mention.get('note_id')}"
                if mention_key == note_key:
                    context = mention.get("context")
                    break

            note_entity_list.append({
                "id": entity_id,
                "name": entity.get("name", ""),
                "type": entity.get("type", "concept"),
                "context": context,
                "mentionCount": len(entity.get("mentions", []))
            })

    # Find relationships involving these entities
    related_relationships = []
    entity_id_set = set(entity_ids)
    for rel in entity_relationships:
        if rel.get("source_entity_id") in entity_id_set or rel.get("target_entity_id") in entity_id_set:
            related_relationships.append({
                "id": rel.get("id"),
                "source": rel.get("source_entity_name"),
                "target": rel.get("target_entity_name"),
                "type": rel.get("type"),
                "bidirectional": rel.get("bidirectional", False)
            })

    return {
        "noteId": note_id,
        "entities": note_entity_list,
        "relationships": related_relationships,
        "isProcessed": is_processed,
        "conversationId": conversation_id,
        "extractedAt": data.get("updated_at")
    }


# Migration functions

class MigrationState:
    """Track migration progress."""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.reset()
        return cls._instance

    def reset(self):
        self.running = False
        self.cancelled = False
        self.total = 0
        self.processed = 0
        self.failed = 0
        self.current = None
        self.errors = []
        self.started_at = None
        self.completed_at = None


migration_state = MigrationState()


async def migrate_all_conversations(
    model: Optional[str] = None,
    force_reprocess: bool = False
) -> Dict[str, Any]:
    """
    Migrate all existing synthesizer conversations to the knowledge graph.

    Args:
        model: Model to use for entity extraction (defaults to settings)
        force_reprocess: If True, reprocess already-processed conversations

    Returns:
        Migration result summary
    """
    global migration_state

    if model is None:
        model = get_knowledge_graph_model()

    if migration_state.running:
        return {"error": "Migration already running"}

    migration_state.reset()
    migration_state.running = True
    migration_state.started_at = datetime.utcnow().isoformat()

    # Get all synthesizer conversations
    all_conversations = list_conversations()
    synth_conversations = [c for c in all_conversations if c.get("mode") == "synthesizer"]

    # Load current state
    data = load_entities()
    processed = set(data.get("processed_conversations", []))

    # Filter to unprocessed (unless force)
    if not force_reprocess:
        synth_conversations = [c for c in synth_conversations if c["id"] not in processed]

    migration_state.total = len(synth_conversations)

    try:
        for conv in synth_conversations:
            if migration_state.cancelled:
                break

            migration_state.current = conv.get("title", conv["id"])

            try:
                result = await extract_entities_for_conversation(conv["id"], model)

                if "error" in result:
                    migration_state.errors.append({
                        "conversation_id": conv["id"],
                        "error": result["error"]
                    })
                    migration_state.failed += 1
                else:
                    migration_state.processed += 1

            except Exception as e:
                migration_state.errors.append({
                    "conversation_id": conv["id"],
                    "error": str(e)
                })
                migration_state.failed += 1

            # Small delay to avoid rate limiting
            await asyncio.sleep(0.5)

    finally:
        migration_state.running = False
        migration_state.completed_at = datetime.utcnow().isoformat()
        migration_state.current = None

    return get_migration_status()


def get_migration_status() -> Dict[str, Any]:
    """Get current migration status."""
    global migration_state

    return {
        "running": migration_state.running,
        "cancelled": migration_state.cancelled,
        "total": migration_state.total,
        "processed": migration_state.processed,
        "failed": migration_state.failed,
        "pending": migration_state.total - migration_state.processed - migration_state.failed,
        "current": migration_state.current,
        "errors": migration_state.errors[-10:],  # Last 10 errors
        "started_at": migration_state.started_at,
        "completed_at": migration_state.completed_at
    }


def cancel_migration():
    """Cancel running migration."""
    global migration_state

    if migration_state.running:
        migration_state.cancelled = True
        return {"status": "cancelling"}

    return {"status": "not_running"}


# Manual link functions

def create_manual_link(
    source: str,
    target: str,
    label: str = "related"
) -> Dict[str, Any]:
    """
    Create a manual link between two nodes.

    Args:
        source: Source node ID
        target: Target node ID
        label: Link label (e.g., "supports", "contradicts", "extends")

    Returns:
        Created link
    """
    data = load_manual_links()

    link = {
        "id": str(uuid.uuid4())[:8],
        "source": source,
        "target": target,
        "type": "manual",
        "label": label,
        "created_at": datetime.utcnow().isoformat()
    }

    data["manual_links"].append(link)
    save_manual_links(data)

    return link


def delete_manual_link(link_id: str) -> bool:
    """Delete a manual link."""
    data = load_manual_links()

    data["manual_links"] = [l for l in data["manual_links"] if l["id"] != link_id]
    save_manual_links(data)

    return True


def dismiss_link(link_id: str) -> bool:
    """Dismiss a suggested link (won't be suggested again)."""
    data = load_manual_links()

    if link_id not in data["dismissed_links"]:
        data["dismissed_links"].append(link_id)
        save_manual_links(data)

    return True


# Linkage session functions

def find_duplicate_entities(threshold: float = 0.7) -> List[Dict[str, Any]]:
    """
    Find potential duplicate entities using fuzzy string matching.

    Args:
        threshold: Similarity threshold (0-1) for considering duplicates

    Returns:
        List of duplicate groups with entities that might be the same
    """
    data = load_entities()
    manual_data = load_manual_links()

    entities = data.get("entities", {})
    reviewed = set(manual_data.get("reviewed_entities", []))
    merged = manual_data.get("entity_merges", [])

    # Build list of canonical entity IDs (skip merged ones)
    merged_ids = set()
    for merge in merged:
        merged_ids.update(merge.get("merged", []))

    # Group entities by name similarity
    entity_list = [
        (eid, e) for eid, e in entities.items()
        if eid not in merged_ids
    ]

    duplicates = []
    processed = set()

    for i, (id1, e1) in enumerate(entity_list):
        if id1 in processed:
            continue

        group = [{
            "id": id1,
            "name": e1.get("name"),
            "type": e1.get("type"),
            "mention_count": len(e1.get("mentions", [])),
            "reviewed": id1 in reviewed
        }]

        name1 = e1.get("name", "").lower()

        for id2, e2 in entity_list[i+1:]:
            if id2 in processed:
                continue

            name2 = e2.get("name", "").lower()

            # Calculate similarity
            similarity = SequenceMatcher(None, name1, name2).ratio()

            if similarity >= threshold:
                group.append({
                    "id": id2,
                    "name": e2.get("name"),
                    "type": e2.get("type"),
                    "mention_count": len(e2.get("mentions", [])),
                    "reviewed": id2 in reviewed,
                    "similarity": similarity
                })
                processed.add(id2)

        # Only include groups with duplicates
        if len(group) > 1:
            duplicates.append({
                "group_id": str(uuid.uuid4())[:8],
                "entities": group,
                "suggested_canonical": max(group, key=lambda x: x["mention_count"])["id"]
            })
            processed.add(id1)

    return duplicates


def merge_entities(canonical_id: str, merge_ids: List[str]) -> Dict[str, Any]:
    """
    Merge multiple entities into a canonical one.

    Args:
        canonical_id: The entity ID to keep
        merge_ids: List of entity IDs to merge into the canonical

    Returns:
        Updated canonical entity
    """
    data = load_entities()
    manual_data = load_manual_links()

    entities = data.get("entities", {})

    if canonical_id not in entities:
        return {"error": "Canonical entity not found"}

    canonical = entities[canonical_id]

    # Merge mentions from other entities
    for merge_id in merge_ids:
        if merge_id in entities and merge_id != canonical_id:
            merged_entity = entities[merge_id]
            canonical["mentions"].extend(merged_entity.get("mentions", []))

    # Update note_entities to point to canonical
    note_entities = data.get("note_entities", {})
    for note_key, entity_ids in note_entities.items():
        updated = []
        for eid in entity_ids:
            if eid in merge_ids:
                if canonical_id not in updated:
                    updated.append(canonical_id)
            else:
                updated.append(eid)
        note_entities[note_key] = updated

    # Record the merge
    manual_data["entity_merges"].append({
        "canonical": canonical_id,
        "merged": merge_ids,
        "merged_at": datetime.utcnow().isoformat()
    })

    # Save both files
    data["updated_at"] = datetime.utcnow().isoformat()
    save_entities(data)
    save_manual_links(manual_data)

    return canonical


def mark_entity_reviewed(entity_id: str) -> bool:
    """Mark an entity as reviewed (won't show in duplicate suggestions)."""
    data = load_manual_links()

    if entity_id not in data["reviewed_entities"]:
        data["reviewed_entities"].append(entity_id)
        save_manual_links(data)

    return True


async def get_connection_suggestions(
    model: Optional[str] = None,
    limit: int = 10
) -> List[Dict[str, Any]]:
    """
    Use LLM to suggest connections between notes that may be related.

    Args:
        model: Model to use for analysis (defaults to settings)
        limit: Maximum suggestions to return

    Returns:
        List of suggested connections with reasoning
    """
    if model is None:
        model = get_knowledge_graph_model()

    data = load_entities()
    manual_data = load_manual_links()

    # Get all synthesizer conversations
    all_conversations = list_conversations()
    synth_conversations = [c for c in all_conversations if c.get("mode") == "synthesizer"]

    # Collect notes from different sources
    notes_by_source = {}
    all_notes = []

    for conv in synth_conversations[:20]:  # Limit to recent 20 sources for performance
        full_conv = get_conversation(conv["id"])
        if not full_conv:
            continue

        conv_notes = []
        for msg in full_conv.get("messages", []):
            if msg.get("role") == "assistant":
                for note in msg.get("notes", []):
                    note_data = {
                        "id": f"note:{conv['id']}:{note['id']}",
                        "title": note.get("title", ""),
                        "tags": note.get("tags", []),
                        "body": note.get("body", ""),
                        "source_id": conv["id"]
                    }
                    conv_notes.append(note_data)
                    all_notes.append(note_data)

        if conv_notes:
            notes_by_source[conv["id"]] = conv_notes

    if len(all_notes) < 2:
        return []

    # Get existing links to avoid duplicates
    existing_links = set()
    for link in manual_data.get("manual_links", []):
        existing_links.add(tuple(sorted([link["source"], link["target"]])))

    dismissed = set(manual_data.get("dismissed_links", []))

    # Sample notes from different sources for comparison
    sample_notes = []
    sources = list(notes_by_source.keys())

    for source_id in sources[:10]:
        source_notes = notes_by_source[source_id]
        sample_notes.extend(source_notes[:5])  # Take up to 5 notes per source

    if len(sample_notes) < 4:
        return []

    # Build prompt for LLM analysis
    notes_text = ""
    for i, note in enumerate(sample_notes[:30]):  # Limit for context
        tags_str = " ".join(note["tags"]) if note["tags"] else "(no tags)"
        notes_text += f"\n[Note {i+1}] ID: {note['id']}\nTitle: {note['title']}\nTags: {tags_str}\nContent: {note['body']}\n"

    prompt = f"""Analyze these knowledge notes and identify pairs that might be conceptually related, even if they're from different sources.

{notes_text}

For each suggested connection, provide:
1. The note IDs (e.g., Note 1 and Note 5)
2. A brief reason why they're related (10-20 words)
3. A suggested label: "supports", "contradicts", "extends", "example_of", or "related"

Respond in JSON format:
[
  {{"note1_index": 1, "note2_index": 5, "reason": "Both discuss...", "label": "related"}},
  ...
]

Only suggest connections where there's a meaningful conceptual relationship. Maximum 5 suggestions."""

    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(model, messages, timeout=60.0)

        if not response or not response.get("content"):
            return []

        # Parse response
        content = response["content"]

        # Extract JSON from response
        json_match = re.search(r'\[[\s\S]*\]', content)
        if not json_match:
            return []

        suggestions_raw = json.loads(json_match.group())

        suggestions = []
        for sug in suggestions_raw:
            idx1 = sug.get("note1_index", 0) - 1
            idx2 = sug.get("note2_index", 0) - 1

            if 0 <= idx1 < len(sample_notes) and 0 <= idx2 < len(sample_notes):
                note1 = sample_notes[idx1]
                note2 = sample_notes[idx2]

                # Skip same-source suggestions
                if note1["source_id"] == note2["source_id"]:
                    continue

                # Skip existing or dismissed
                pair = tuple(sorted([note1["id"], note2["id"]]))
                if pair in existing_links:
                    continue

                link_id = f"sug-{uuid.uuid4().hex[:8]}"
                if link_id in dismissed:
                    continue

                suggestions.append({
                    "id": link_id,
                    "source": {
                        "id": note1["id"],
                        "title": note1["title"]
                    },
                    "target": {
                        "id": note2["id"],
                        "title": note2["title"]
                    },
                    "reason": sug.get("reason", "Related concepts"),
                    "label": sug.get("label", "related")
                })

        return suggestions[:limit]

    except Exception as e:
        logger.error(f"Error getting connection suggestions: {e}")
        return []


def get_linkage_session_data() -> Dict[str, Any]:
    """
    Get all data needed for a linkage session.

    Returns:
        Dict with duplicates, pending reviews, and stats
    """
    data = load_entities()
    manual_data = load_manual_links()

    duplicates = find_duplicate_entities()

    # Filter to only unreviewed duplicates
    unreviewed_duplicates = []
    for group in duplicates:
        unreviewed = [e for e in group["entities"] if not e.get("reviewed")]
        if len(unreviewed) > 1:
            unreviewed_duplicates.append(group)

    return {
        "duplicates": unreviewed_duplicates[:20],  # Limit for UI
        "total_duplicates": len(duplicates),
        "reviewed_entities": len(manual_data.get("reviewed_entities", [])),
        "manual_links": len(manual_data.get("manual_links", [])),
        "entity_merges": len(manual_data.get("entity_merges", []))
    }
