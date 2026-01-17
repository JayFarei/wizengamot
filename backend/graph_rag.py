"""Graph RAG module for querying the knowledge graph with natural language."""

import json
import re
import logging
from typing import List, Dict, Any, Optional
from difflib import SequenceMatcher

from .openrouter import query_model
from .storage import get_conversation, list_conversations
from .knowledge_graph import load_entities, build_graph
from .settings import get_knowledge_graph_model

logger = logging.getLogger(__name__)


def extract_query_entities(question: str, entities: Dict[str, Any]) -> List[str]:
    """
    Extract entity names from the question that match our knowledge graph.

    Args:
        question: User's natural language question
        entities: Dictionary of entities from knowledge graph

    Returns:
        List of matching entity IDs
    """
    question_lower = question.lower()
    matched = []

    for entity_id, entity in entities.items():
        name = entity.get("name", "").lower()
        if name and len(name) > 2:
            # Check for exact or fuzzy match
            if name in question_lower:
                matched.append(entity_id)
            elif SequenceMatcher(None, name, question_lower).ratio() > 0.8:
                matched.append(entity_id)

    return matched


def find_relevant_notes(
    question: str,
    graph_data: Dict[str, Any],
    entities_data: Dict[str, Any],
    max_notes: int = 10
) -> List[Dict[str, Any]]:
    """
    Find notes relevant to the question using entities and keyword matching.

    Args:
        question: User's question
        graph_data: Full graph with nodes and links
        entities_data: Entities storage data
        max_notes: Maximum notes to return

    Returns:
        List of relevant note data with content
    """
    question_lower = question.lower()
    words = set(question_lower.split())
    relevant = []

    # Get entity matches
    entity_ids = extract_query_entities(question, entities_data.get("entities", {}))

    # Find notes that mention these entities
    note_entities = entities_data.get("note_entities", {})
    entity_note_ids = set()

    for note_key, note_ent_ids in note_entities.items():
        for eid in note_ent_ids:
            if eid in entity_ids:
                # note_key is "conversation_id:note_id"
                entity_note_ids.add(note_key)

    # Score all note nodes
    note_nodes = [n for n in graph_data.get("nodes", []) if n["type"] == "note"]

    for node in note_nodes:
        note_id = node["id"]
        # Extract conversation_id:note_id format for matching
        parts = note_id.split(":")
        if len(parts) >= 3:
            note_key = f"{parts[1]}:{parts[2]}"
        else:
            note_key = note_id

        score = 0

        # Entity match gives higher score
        if note_key in entity_note_ids:
            score += 5

        # Title match
        title_lower = node.get("title", "").lower()
        for word in words:
            if len(word) > 3 and word in title_lower:
                score += 2

        # Tag match
        for tag in node.get("tags", []):
            tag_clean = tag.lower().replace("#", "")
            if tag_clean in words or any(word in tag_clean for word in words if len(word) > 3):
                score += 3

        # Body match (from truncated body in graph)
        body_lower = node.get("body", "").lower()
        for word in words:
            if len(word) > 3 and word in body_lower:
                score += 1

        if score > 0:
            relevant.append({
                "node": node,
                "score": score,
                "note_key": note_key
            })

    # Sort by score and take top results
    relevant.sort(key=lambda x: x["score"], reverse=True)
    return relevant[:max_notes]


def get_full_note_content(note_nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Retrieve full note content from conversations.

    Args:
        note_nodes: List of note node data with conversation/note IDs

    Returns:
        List of notes with full content
    """
    full_notes = []

    for item in note_nodes:
        node = item["node"]
        note_id = node["id"]

        # Parse note ID: "note:conversation_id:note_id"
        parts = note_id.split(":")
        if len(parts) < 3:
            continue

        conv_id = parts[1]
        local_note_id = parts[2]

        # Get full conversation
        conv = get_conversation(conv_id)
        if not conv:
            continue

        # Find the note
        for msg in conv.get("messages", []):
            if msg.get("role") == "assistant":
                for note in msg.get("notes", []):
                    if note.get("id") == local_note_id:
                        full_notes.append({
                            "id": note_id,
                            "title": note.get("title", ""),
                            "tags": note.get("tags", []),
                            "body": note.get("body", ""),
                            "source_title": conv.get("title", ""),
                            "conversation_id": conv_id,
                            "score": item.get("score", 0)
                        })
                        break

    return full_notes


def build_rag_context(notes: List[Dict[str, Any]], max_length: int = 8000) -> str:
    """
    Build context string from retrieved notes.

    Args:
        notes: List of note data with full content
        max_length: Maximum context length

    Returns:
        Formatted context string
    """
    context_parts = []
    current_length = 0

    for i, note in enumerate(notes, 1):
        tags_str = " ".join(note.get("tags", [])) if note.get("tags") else ""
        note_text = f"""[Note {i}] "{note['title']}"
Source: {note.get('source_title', 'Unknown')}
Tags: {tags_str}
Content: {note['body']}
"""
        if current_length + len(note_text) > max_length:
            break

        context_parts.append(note_text)
        current_length += len(note_text)

    return "\n---\n".join(context_parts)


async def query_knowledge_graph(
    question: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Query the knowledge graph with a natural language question.

    Args:
        question: User's question
        conversation_history: Previous messages in the chat
        model: LLM model to use for answering (defaults to settings)

    Returns:
        Dict with answer, citations, and follow-up suggestions
    """
    if model is None:
        model = get_knowledge_graph_model()

    # Load graph and entity data
    entities_data = load_entities()
    graph_data = build_graph()

    # Find relevant notes
    relevant = find_relevant_notes(question, graph_data, entities_data)

    if not relevant:
        return {
            "answer": "I couldn't find any notes in your knowledge graph related to your question. Try running the migration to index your existing notes, or create some Synthesizer notes first.",
            "citations": [],
            "follow_ups": [],
            "notes_searched": 0
        }

    # Get full content for relevant notes
    full_notes = get_full_note_content(relevant)

    if not full_notes:
        return {
            "answer": "I found some potentially relevant notes but couldn't retrieve their content. The knowledge graph may need to be rebuilt.",
            "citations": [],
            "follow_ups": [],
            "notes_searched": len(relevant)
        }

    # Build context
    context = build_rag_context(full_notes)

    # Build conversation history for prompt
    history_text = ""
    if conversation_history:
        for msg in conversation_history[-5:]:  # Last 5 messages
            role = msg.get("role", "user")
            content = msg.get("content", "")
            history_text += f"{role.capitalize()}: {content}\n"

    # Build prompt
    prompt = f"""You are a knowledgeable assistant with access to a personal knowledge base.
Answer the user's question based on the following notes from their knowledge graph.

## Retrieved Notes:
{context}

## Previous Conversation:
{history_text}

## Current Question:
{question}

## Instructions:
1. Answer the question based on the notes above
2. Cite your sources using [Note N] format inline (e.g., "According to [Note 1], ...")
3. If the notes don't contain enough information to fully answer, say so
4. At the end, suggest 2-3 follow-up questions the user might want to ask
5. Be concise but thorough

Format your response as:
ANSWER:
[Your answer with inline citations]

FOLLOW_UPS:
- [Question 1]
- [Question 2]
- [Question 3]"""

    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(model, messages, timeout=90.0)

        # Check for error response from query_model
        if response and response.get("error"):
            return {
                "answer": f"Error: {response['error']}",
                "citations": [],
                "follow_ups": [],
                "notes_searched": len(full_notes)
            }

        if not response or not response.get("content"):
            return {
                "answer": f"Model '{model}' returned empty response. Try a different model in Settings > Knowledge Graph.",
                "citations": [],
                "follow_ups": [],
                "notes_searched": len(full_notes)
            }

        content = response["content"]

        # Parse response
        answer = content
        follow_ups = []

        # Extract answer section
        if "ANSWER:" in content:
            parts = content.split("FOLLOW_UPS:")
            answer = parts[0].replace("ANSWER:", "").strip()

            if len(parts) > 1:
                follow_ups_text = parts[1].strip()
                # Extract bullet points
                for line in follow_ups_text.split("\n"):
                    line = line.strip()
                    if line.startswith("-") or line.startswith("•"):
                        follow_ups.append(line[1:].strip())

        # Build citations from the notes we provided
        citations = []
        for i, note in enumerate(full_notes, 1):
            citation_marker = f"[Note {i}]"
            if citation_marker in answer:
                citations.append({
                    "note_id": note["id"],
                    "title": note["title"],
                    "snippet": note["body"][:150] + "..." if len(note["body"]) > 150 else note["body"],
                    "conversation_id": note["conversation_id"]
                })

        return {
            "answer": answer,
            "citations": citations,
            "follow_ups": follow_ups[:5],
            "notes_searched": len(full_notes)
        }

    except Exception as e:
        logger.error(f"Error in Graph RAG query: {e}")
        return {
            "answer": f"An error occurred while answering: {str(e)}",
            "citations": [],
            "follow_ups": [],
            "notes_searched": len(full_notes)
        }


# Chat session management
_chat_sessions: Dict[str, List[Dict[str, str]]] = {}


def get_chat_history(session_id: str) -> List[Dict[str, str]]:
    """Get chat history for a session."""
    return _chat_sessions.get(session_id, [])


def add_to_chat_history(session_id: str, role: str, content: str):
    """Add a message to chat history."""
    if session_id not in _chat_sessions:
        _chat_sessions[session_id] = []

    _chat_sessions[session_id].append({
        "role": role,
        "content": content
    })

    # Limit history to last 20 messages
    if len(_chat_sessions[session_id]) > 20:
        _chat_sessions[session_id] = _chat_sessions[session_id][-20:]


def clear_chat_session(session_id: str):
    """Clear a chat session."""
    if session_id in _chat_sessions:
        del _chat_sessions[session_id]


def list_chat_sessions() -> List[str]:
    """List all active chat session IDs."""
    return list(_chat_sessions.keys())
