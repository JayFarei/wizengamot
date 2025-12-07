"""Semantic search for conversations using fastembed."""

import hashlib
import math
import os
import pickle
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

import numpy as np
from fastembed import TextEmbedding

from .config import DATA_DIR

# Module-level cache
_model: Optional[TextEmbedding] = None
_index: Optional[Dict[str, Any]] = None

# Index file path
INDEX_DIR = os.getenv("DATA_DIR", "data")
INDEX_PATH = os.path.join(Path(INDEX_DIR).parent if "conversations" in INDEX_DIR else INDEX_DIR, "search_index.pkl")


def get_model() -> TextEmbedding:
    """Lazy-load the embedding model (cached)."""
    global _model
    if _model is None:
        _model = TextEmbedding("BAAI/bge-small-en-v1.5")
    return _model


def get_embedding(text: str) -> np.ndarray:
    """Get embedding vector for a text string."""
    model = get_model()
    embeddings = list(model.embed([text]))
    return embeddings[0]


def extract_content(conversation: Dict[str, Any]) -> str:
    """Extract all searchable text from a conversation."""
    parts = []

    # Title
    title = conversation.get("title", "")
    if title and title != "New Conversation":
        parts.append(title)

    # Messages
    for msg in conversation.get("messages", []):
        if msg.get("role") == "user":
            # User message content
            content = msg.get("content", "")
            if content:
                parts.append(content)
        elif msg.get("role") == "assistant":
            # Stage 1: Individual model responses
            for resp in msg.get("stage1", []):
                content = resp.get("content", "")
                if content:
                    # Truncate long responses to first 500 chars
                    parts.append(content[:500])

            # Stage 3: Final synthesis
            stage3 = msg.get("stage3", {})
            if isinstance(stage3, dict):
                content = stage3.get("content", "")
                if content:
                    parts.append(content[:500])

            # Synthesizer notes
            for note in msg.get("notes", []):
                title = note.get("title", "")
                body = note.get("body", "")
                if title:
                    parts.append(title)
                if body:
                    parts.append(body[:300])

    return " ".join(parts)


def content_hash(content: str) -> str:
    """Generate hash of content for change detection."""
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def load_index() -> Dict[str, Any]:
    """Load the search index from disk."""
    global _index
    if _index is not None:
        return _index

    if os.path.exists(INDEX_PATH):
        try:
            with open(INDEX_PATH, "rb") as f:
                _index = pickle.load(f)
                return _index
        except Exception:
            pass

    _index = {}
    return _index


def save_index(index: Dict[str, Any]):
    """Save the search index to disk."""
    global _index
    _index = index

    # Ensure directory exists
    os.makedirs(os.path.dirname(INDEX_PATH), exist_ok=True)

    with open(INDEX_PATH, "wb") as f:
        pickle.dump(index, f)


def build_index() -> Dict[str, Any]:
    """Build/update the search index from all conversations."""
    from . import storage

    index = load_index()
    model = get_model()

    # Get all conversations
    conversations_meta = storage.list_conversations()

    # Track which conversations need (re)indexing
    to_index = []
    current_ids = set()

    for meta in conversations_meta:
        conv_id = meta["id"]
        current_ids.add(conv_id)

        # Load full conversation
        conv = storage.get_conversation(conv_id)
        if conv is None:
            continue

        content = extract_content(conv)
        c_hash = content_hash(content)

        # Check if needs indexing
        if conv_id not in index or index[conv_id].get("content_hash") != c_hash:
            to_index.append({
                "id": conv_id,
                "content": content,
                "hash": c_hash,
                "title": meta.get("title", "New Conversation"),
                "created_at": meta.get("created_at", ""),
                "mode": meta.get("mode", "council")
            })

    # Remove deleted conversations from index
    deleted = set(index.keys()) - current_ids
    for conv_id in deleted:
        del index[conv_id]

    # Generate embeddings for new/changed conversations
    if to_index:
        contents = [item["content"] for item in to_index]
        embeddings = list(model.embed(contents))

        for item, embedding in zip(to_index, embeddings):
            index[item["id"]] = {
                "embedding": np.array(embedding),
                "content_hash": item["hash"],
                "title": item["title"],
                "created_at": item["created_at"],
                "mode": item["mode"]
            }

        save_index(index)

    return index


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Calculate cosine similarity between two vectors."""
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def recency_weight(created_at: str) -> float:
    """Calculate recency weight with 30-day half-life."""
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        now = datetime.now(created.tzinfo) if created.tzinfo else datetime.utcnow()
        days_old = (now - created).days
        return math.exp(-days_old / 30)
    except Exception:
        return 0.5


def search(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Search conversations by semantic similarity + recency.

    Args:
        query: Search query string
        limit: Maximum results to return

    Returns:
        List of results with id, title, score, created_at, mode
    """
    if not query.strip():
        return []

    # Ensure index is built
    index = build_index()

    if not index:
        return []

    # Embed query
    model = get_model()
    query_embedding = list(model.embed([query]))[0]
    query_embedding = np.array(query_embedding)

    # Score all conversations
    results = []
    for conv_id, data in index.items():
        similarity = cosine_similarity(query_embedding, data["embedding"])
        recency = recency_weight(data["created_at"])

        # Combined score: 70% similarity, 30% recency
        score = 0.7 * similarity + 0.3 * recency

        # Convert numpy floats to Python floats for JSON serialization
        results.append({
            "id": conv_id,
            "title": data["title"],
            "score": float(round(score, 4)),
            "similarity": float(round(similarity, 4)),
            "recency": float(round(recency, 4)),
            "created_at": data["created_at"],
            "mode": data["mode"]
        })

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)

    return results[:limit]


def clear_index():
    """Clear the in-memory index cache (for testing)."""
    global _index
    _index = None
