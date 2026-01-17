"""Semantic search for knowledge graph nodes using fastembed."""

import hashlib
import math
import os
import pickle
from pathlib import Path
from typing import List, Dict, Any, Optional

import numpy as np

from .search import get_model  # Share model with conversation search

# Module-level cache for knowledge graph index
_kg_index: Optional[Dict[str, Any]] = None

# Index file path
INDEX_DIR = os.getenv("DATA_DIR", "data")
KG_INDEX_PATH = os.path.join(
    Path(INDEX_DIR).parent if "conversations" in INDEX_DIR else INDEX_DIR,
    "kg_search_index.pkl"
)


def extract_entity_content(entity: Dict[str, Any]) -> str:
    """Extract searchable text from an entity."""
    parts = []

    name = entity.get("name", "")
    if name:
        parts.append(name)

    entity_type = entity.get("type", "")
    if entity_type:
        parts.append(entity_type)

    # Include context from mentions
    for mention in entity.get("mentions", [])[:5]:
        context = mention.get("context", "")
        if context:
            parts.append(context[:200])

    return " ".join(parts)


def extract_note_content(note: Dict[str, Any]) -> str:
    """Extract searchable text from a note node."""
    parts = []

    title = note.get("title", "")
    if title:
        parts.append(title)

    # Include tags without # prefix
    for tag in note.get("tags", []):
        parts.append(tag.lstrip("#"))

    body = note.get("body", "")
    if body:
        parts.append(body[:500])

    return " ".join(parts)


def extract_source_content(source: Dict[str, Any]) -> str:
    """Extract searchable text from a source node."""
    parts = []

    title = source.get("title", "")
    if title:
        parts.append(title)

    source_type = source.get("sourceType", "")
    if source_type:
        parts.append(source_type)

    return " ".join(parts)


def content_hash(content: str) -> str:
    """Generate hash of content for change detection."""
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def load_kg_index() -> Dict[str, Any]:
    """Load the knowledge graph search index from disk."""
    global _kg_index
    if _kg_index is not None:
        return _kg_index

    if os.path.exists(KG_INDEX_PATH):
        try:
            with open(KG_INDEX_PATH, "rb") as f:
                _kg_index = pickle.load(f)
                return _kg_index
        except Exception:
            pass

    _kg_index = {}
    return _kg_index


def save_kg_index(index: Dict[str, Any]):
    """Save the knowledge graph search index to disk."""
    global _kg_index
    _kg_index = index

    # Ensure directory exists
    os.makedirs(os.path.dirname(KG_INDEX_PATH), exist_ok=True)

    with open(KG_INDEX_PATH, "wb") as f:
        pickle.dump(index, f)


def build_kg_index() -> Dict[str, Any]:
    """Build/update the search index from the knowledge graph."""
    from . import knowledge_graph

    index = load_kg_index()
    model = get_model()

    # Get the full graph
    graph = knowledge_graph.build_graph()
    nodes = graph.get("nodes", [])

    # Track which nodes need (re)indexing
    to_index = []
    current_ids = set()

    for node in nodes:
        node_id = node.get("id", "")
        if not node_id:
            continue

        current_ids.add(node_id)

        # Extract content based on node type
        node_type = node.get("type", "")
        if node_type == "entity":
            content = extract_entity_content(node)
        elif node_type == "note":
            content = extract_note_content(node)
        elif node_type == "source":
            content = extract_source_content(node)
        else:
            continue

        c_hash = content_hash(content)

        # Check if needs indexing
        if node_id not in index or index[node_id].get("content_hash") != c_hash:
            # Get mention count for entities (for scoring boost)
            mention_count = 0
            if node_type == "entity":
                mention_count = node.get("mentionCount", 0)

            to_index.append({
                "id": node_id,
                "content": content,
                "hash": c_hash,
                "type": node_type,
                "name": node.get("name", node.get("title", "")),
                "entity_type": node.get("entityType", ""),
                "tags": node.get("tags", []),
                "mention_count": mention_count,
                "created_at": node.get("created_at", ""),
            })

    # Remove deleted nodes from index
    deleted = set(index.keys()) - current_ids
    for node_id in deleted:
        del index[node_id]

    # Generate embeddings for new/changed nodes
    if to_index:
        contents = [item["content"] for item in to_index]
        embeddings = list(model.embed(contents))

        for item, embedding in zip(to_index, embeddings):
            index[item["id"]] = {
                "embedding": np.array(embedding),
                "content_hash": item["hash"],
                "type": item["type"],
                "name": item["name"],
                "entity_type": item["entity_type"],
                "tags": item["tags"],
                "mention_count": item["mention_count"],
                "created_at": item["created_at"],
            }

        save_kg_index(index)

    return index


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Calculate cosine similarity between two vectors."""
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def mention_boost(mention_count: int) -> float:
    """Calculate mention count boost for entities (logarithmic scaling)."""
    if mention_count <= 0:
        return 0.0
    # Log scaling to prevent high-mention entities from dominating
    return min(math.log(mention_count + 1) / 10, 0.3)


def search_knowledge_graph(
    query: str,
    node_types: Optional[List[str]] = None,
    entity_types: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
    limit: int = 20
) -> List[Dict[str, Any]]:
    """
    Search knowledge graph nodes by semantic similarity.

    Args:
        query: Search query string
        node_types: Optional list of node types to filter (entity, note, source)
        entity_types: Optional list of entity types to filter (person, organization, etc.)
        tags: Optional list of tags to filter notes by
        limit: Maximum results to return

    Returns:
        List of results with id, type, name, score, and other metadata
    """
    if not query.strip():
        return []

    # Ensure index is built
    index = build_kg_index()

    if not index:
        return []

    # Embed query
    model = get_model()
    query_embedding = list(model.embed([query]))[0]
    query_embedding = np.array(query_embedding)

    # Score all nodes
    results = []
    for node_id, data in index.items():
        # Apply type filters
        if node_types and data["type"] not in node_types:
            continue

        if entity_types and data["type"] == "entity":
            if data["entity_type"] not in entity_types:
                continue

        if tags and data["type"] == "note":
            node_tags = [t.lower().lstrip("#") for t in data.get("tags", [])]
            query_tags = [t.lower().lstrip("#") for t in tags]
            if not any(qt in node_tags for qt in query_tags):
                continue

        similarity = cosine_similarity(query_embedding, data["embedding"])

        # Combined score: 70% similarity, 30% mention boost (for entities)
        boost = mention_boost(data.get("mention_count", 0))
        score = 0.7 * similarity + 0.3 * boost

        # Convert numpy floats to Python floats for JSON serialization
        results.append({
            "id": node_id,
            "type": data["type"],
            "name": data["name"],
            "entityType": data.get("entity_type", ""),
            "tags": data.get("tags", []),
            "score": float(round(score, 4)),
            "similarity": float(round(similarity, 4)),
            "mentionCount": data.get("mention_count", 0),
        })

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)

    return results[:limit]


def clear_kg_index():
    """Clear the in-memory index cache."""
    global _kg_index
    _kg_index = None

    # Also remove the file if it exists
    if os.path.exists(KG_INDEX_PATH):
        os.remove(KG_INDEX_PATH)
