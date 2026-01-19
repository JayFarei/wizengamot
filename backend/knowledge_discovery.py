"""Knowledge Discovery module for self-referential graph analysis.

Uses Claude Opus 4.5 to analyze the knowledge graph and suggest bridge notes
that synthesize concepts across existing notes.
"""

import json
import os
import re
import uuid
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

import asyncio
from .openrouter import query_model, get_generation_cost
from .storage import get_conversation, list_conversations, save_conversation, update_conversation_cost, update_conversation_summary
from .graph_search import search_knowledge_graph
from .knowledge_graph import load_entities, build_graph
from .summarizer import generate_summary

logger = logging.getLogger(__name__)

# Storage directory
KNOWLEDGE_GRAPH_DIR = os.getenv("KNOWLEDGE_GRAPH_DIR", "data/knowledge_graph")

# Default model for discovery (Claude Opus 4.5 for deep reasoning)
# Falls back to knowledge graph model if not set
DISCOVERY_MODEL = "anthropic/claude-opus-4.5"


def ensure_kg_dir():
    """Ensure the knowledge graph directory exists."""
    Path(KNOWLEDGE_GRAPH_DIR).mkdir(parents=True, exist_ok=True)


def get_discoveries_path() -> str:
    """Get the path to the discoveries storage file."""
    return os.path.join(KNOWLEDGE_GRAPH_DIR, "discoveries.json")


def load_discoveries() -> Dict[str, Any]:
    """Load discoveries from storage."""
    ensure_kg_dir()
    path = get_discoveries_path()

    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)

    return {
        "discoveries": [],
        "discovery_runs": [],
        "settings": {
            "discovery_model": None,
            "min_notes_for_discovery": 5,
            "discovery_depth": "moderate"
        },
        "updated_at": None
    }


def save_discoveries(data: Dict[str, Any]):
    """Save discoveries to storage."""
    ensure_kg_dir()
    data["updated_at"] = datetime.utcnow().isoformat()

    path = get_discoveries_path()
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


# Discovery prompts

GUIDED_DISCOVERY_PROMPT = """You are analyzing a personal knowledge graph to find non-obvious connections between notes.

## User's Discovery Request
{user_prompt}

## Notes from Knowledge Base
{notes_content}

## Web Research (if relevant)
{web_research}

## Your Task
Based on the user's request, identify 3-5 groups of notes that:
1. Discuss related concepts but aren't currently connected
2. Could benefit from a "bridge note" synthesizing their ideas
3. Reveal non-obvious connections that the user may not have noticed

## Anti-patterns to Avoid
- Notes already connected by shared tags or entities (trivial connections)
- Vague connections like "both about technology"
- Notes from the same source (they're already sequential)

## Output Format
Return a JSON array of connection groups:
```json
[
  {{
    "notes": ["note:conv1:note-1", "note:conv2:note-3"],
    "connection_type": "conceptual",
    "insight": "Both explore how X principle applies to Y domain, suggesting a deeper pattern",
    "strength": "strong",
    "bridge_suggestion": "A note exploring how [specific concept] from Note 1 illuminates [specific concept] from Note 2"
  }}
]
```

Connection types: conceptual, methodological, temporal, causal, analogical
Strength: weak, moderate, strong

Return ONLY the JSON array, no other text."""


BRIDGE_NOTE_PROMPT = """Create a Zettelkasten-style bridge note that synthesizes these related concepts.

## Source Notes
{source_notes}

## Connection Insight
{insight}

## Requirements
1. ~100 words, expressing a single atomic idea
2. Must add NEW insight, not just summarize the source notes
3. Reference the source concepts but create NEW understanding
4. Use active voice, present tense
5. End with an implication or question for further exploration

## Output Format
Return a JSON object:
```json
{{
  "title": "Clear, specific title (not generic)",
  "body": "~100 word synthesis note creating new understanding...",
  "tags": ["#existing-tag", "#new-synthesis-tag"],
  "references": "Brief note on how this connects the sources"
}}
```

Return ONLY the JSON object, no other text."""


class DiscoveryState:
    """Track discovery run progress."""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.reset()
        return cls._instance

    def reset(self):
        self.running = False
        self.cancelled = False
        self.phase = None  # "searching", "analyzing", "generating"
        self.progress = 0
        self.total_notes = 0
        self.started_at = None
        self.error = None


discovery_state = DiscoveryState()


def get_discovery_status() -> Dict[str, Any]:
    """Get current discovery run status."""
    global discovery_state

    return {
        "running": discovery_state.running,
        "cancelled": discovery_state.cancelled,
        "phase": discovery_state.phase,
        "progress": discovery_state.progress,
        "total_notes": discovery_state.total_notes,
        "started_at": discovery_state.started_at,
        "error": discovery_state.error
    }


def cancel_discovery():
    """Cancel running discovery."""
    global discovery_state

    if discovery_state.running:
        discovery_state.cancelled = True
        return {"status": "cancelling"}

    return {"status": "not_running"}


def _collect_notes_for_discovery(prompt: str, limit: int = 50) -> List[Dict[str, Any]]:
    """
    Collect relevant notes from the knowledge base for discovery analysis.

    Uses semantic search to find notes relevant to the user's prompt,
    then enriches with additional context.
    """
    # Get all synthesizer conversations
    all_conversations = list_conversations()
    synth_conversations = [c for c in all_conversations if c.get("mode") == "synthesizer"]

    # Collect all notes with full context
    all_notes = []
    for conv in synth_conversations:
        full_conv = get_conversation(conv["id"])
        if not full_conv:
            continue

        source_title = full_conv.get("title", "Untitled")

        for msg in full_conv.get("messages", []):
            if msg.get("role") != "assistant":
                continue

            for note in msg.get("notes", []):
                note_id = f"note:{conv['id']}:{note['id']}"
                all_notes.append({
                    "id": note_id,
                    "title": note.get("title", ""),
                    "body": note.get("body", ""),
                    "tags": note.get("tags", []),
                    "source_id": conv["id"],
                    "source_title": source_title
                })

    if not all_notes:
        return []

    # Use semantic search to find most relevant notes to the prompt
    search_results = search_knowledge_graph(
        query=prompt,
        node_types=["note"],
        limit=limit
    )

    # Build set of relevant note IDs
    relevant_ids = {r["id"] for r in search_results}

    # Return notes in search result order, with full content
    notes_by_id = {n["id"]: n for n in all_notes}
    relevant_notes = []

    for result in search_results:
        note_id = result["id"]
        if note_id in notes_by_id:
            note = notes_by_id[note_id]
            note["relevance_score"] = result.get("score", 0)
            relevant_notes.append(note)

    # If we have fewer than 10 relevant notes, add some random ones for diversity
    if len(relevant_notes) < 10:
        remaining = [n for n in all_notes if n["id"] not in relevant_ids]
        import random
        random.shuffle(remaining)
        relevant_notes.extend(remaining[:10 - len(relevant_notes)])

    return relevant_notes


def _filter_trivial_connections(notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Pre-filter notes to identify pairs that are already trivially connected.

    Returns notes with metadata about existing connections to help the LLM
    avoid suggesting obvious links.
    """
    # Build tag index
    tag_to_notes = {}
    for note in notes:
        for tag in note.get("tags", []):
            tag_clean = tag.lower().strip()
            if tag_clean not in tag_to_notes:
                tag_to_notes[tag_clean] = []
            tag_to_notes[tag_clean].append(note["id"])

    # Mark notes that share tags with other notes
    for note in notes:
        shared_tag_notes = set()
        for tag in note.get("tags", []):
            tag_clean = tag.lower().strip()
            for other_id in tag_to_notes.get(tag_clean, []):
                if other_id != note["id"]:
                    shared_tag_notes.add(other_id)
        note["shares_tags_with"] = list(shared_tag_notes)

    # Load entities to find notes sharing entities
    entities_data = load_entities()
    note_entities = entities_data.get("note_entities", {})

    # Build entity to notes index
    entity_to_notes = {}
    for note_key, entity_ids in note_entities.items():
        for entity_id in entity_ids:
            if entity_id not in entity_to_notes:
                entity_to_notes[entity_id] = []
            entity_to_notes[entity_id].append(f"note:{note_key}")

    # Mark notes that share entities
    for note in notes:
        note_key = note["id"].replace("note:", "")
        shared_entity_notes = set()

        for entity_id in note_entities.get(note_key, []):
            for other_id in entity_to_notes.get(entity_id, []):
                if other_id != note["id"]:
                    shared_entity_notes.add(other_id)

        note["shares_entities_with"] = list(shared_entity_notes)

    return notes


def _format_notes_for_prompt(notes: List[Dict[str, Any]]) -> str:
    """Format notes for inclusion in the LLM prompt."""
    lines = []

    for i, note in enumerate(notes, 1):
        tags_str = " ".join(note.get("tags", [])) if note.get("tags") else "(no tags)"
        trivial_connections = []

        if note.get("shares_tags_with"):
            trivial_connections.append(f"shares tags with {len(note['shares_tags_with'])} other notes")
        if note.get("shares_entities_with"):
            trivial_connections.append(f"shares entities with {len(note['shares_entities_with'])} other notes")

        trivial_str = f" [Already connected: {'; '.join(trivial_connections)}]" if trivial_connections else ""

        lines.append(f"""
[Note {i}] ID: {note['id']}
Source: {note.get('source_title', 'Unknown')}
Title: {note['title']}
Tags: {tags_str}{trivial_str}
Content: {note['body'][:500]}
""")

    return "\n".join(lines)


async def run_discovery_analysis(
    prompt: str,
    model: Optional[str] = None,
    include_web_search: bool = True
) -> Dict[str, Any]:
    """
    Run discovery analysis based on user's natural language prompt.

    Args:
        prompt: User's discovery request (e.g., "Find connections between AI and philosophy")
        model: Model to use (defaults to Claude Opus 4.5)
        include_web_search: Whether to search the web for bridging concepts

    Returns:
        Dict with discovery run results
    """
    global discovery_state

    if discovery_state.running:
        return {"error": "Discovery already running"}

    if model is None:
        data = load_discoveries()
        model = data["settings"].get("discovery_model") or DISCOVERY_MODEL

    discovery_state.reset()
    discovery_state.running = True
    discovery_state.started_at = datetime.utcnow().isoformat()

    run_id = f"run_{uuid.uuid4().hex[:8]}"

    try:
        # Phase 1: Search knowledge base
        discovery_state.phase = "searching"
        discovery_state.progress = 10

        notes = _collect_notes_for_discovery(prompt, limit=30)
        discovery_state.total_notes = len(notes)

        if len(notes) < 2:
            discovery_state.error = "Not enough notes in knowledge base for discovery"
            return {"error": discovery_state.error, "notes_found": len(notes)}

        if discovery_state.cancelled:
            return {"status": "cancelled"}

        # Phase 2: Pre-filter and prepare notes
        discovery_state.phase = "analyzing"
        discovery_state.progress = 30

        notes = _filter_trivial_connections(notes)
        notes_content = _format_notes_for_prompt(notes)

        # Optional: Web search for bridging concepts
        web_research = "No web research performed."
        if include_web_search:
            # For now, placeholder, can integrate with web search later
            web_research = "Web search not yet implemented in this version."

        if discovery_state.cancelled:
            return {"status": "cancelled"}

        # Phase 3: LLM analysis
        discovery_state.phase = "generating"
        discovery_state.progress = 50

        logger.info(f"Running discovery analysis with model: {model}")

        analysis_prompt = GUIDED_DISCOVERY_PROMPT.format(
            user_prompt=prompt,
            notes_content=notes_content,
            web_research=web_research
        )

        messages = [{"role": "user", "content": analysis_prompt}]

        response = await query_model(model, messages, timeout=120.0)

        if not response:
            discovery_state.error = "Failed to get response from model"
            return {"error": discovery_state.error}

        if response.get("error"):
            discovery_state.error = response["error"]
            return {"error": discovery_state.error}

        if not response.get("content"):
            discovery_state.error = "Model returned empty response"
            return {"error": discovery_state.error}

        # Capture generation_id for cost tracking
        analysis_generation_id = response.get("generation_id")

        # Parse response
        content = response["content"]

        # Extract JSON from response
        if content.startswith("```"):
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)

        try:
            connection_groups = json.loads(content)
        except json.JSONDecodeError:
            # Try to find JSON array in response
            json_match = re.search(r'\[[\s\S]*\]', content)
            if json_match:
                connection_groups = json.loads(json_match.group())
            else:
                discovery_state.error = "Failed to parse model response"
                return {"error": discovery_state.error, "raw_response": content[:500]}

        if discovery_state.cancelled:
            return {"status": "cancelled"}

        # Phase 4: Generate bridge note suggestions
        discovery_state.progress = 70

        discoveries = []
        notes_by_id = {n["id"]: n for n in notes}

        # Collect all generation IDs for cost tracking
        all_generation_ids = []
        if analysis_generation_id:
            all_generation_ids.append(analysis_generation_id)

        for group in connection_groups:
            if discovery_state.cancelled:
                break

            group_notes = group.get("notes", [])
            if len(group_notes) < 2:
                continue

            # Validate note IDs exist
            valid_notes = [notes_by_id[nid] for nid in group_notes if nid in notes_by_id]
            if len(valid_notes) < 2:
                continue

            # Generate bridge note content
            source_notes_text = "\n\n".join([
                f"**{n['title']}** (from {n.get('source_title', 'Unknown')})\n{n['body']}"
                for n in valid_notes
            ])

            bridge_prompt = BRIDGE_NOTE_PROMPT.format(
                source_notes=source_notes_text,
                insight=group.get("insight", group.get("bridge_suggestion", ""))
            )

            bridge_response = await query_model(model, [{"role": "user", "content": bridge_prompt}], timeout=60.0)

            if not bridge_response or not bridge_response.get("content"):
                continue

            # Capture generation_id for cost tracking
            bridge_generation_id = bridge_response.get("generation_id")
            if bridge_generation_id:
                all_generation_ids.append(bridge_generation_id)

            bridge_content = bridge_response["content"]
            if bridge_content.startswith("```"):
                bridge_content = re.sub(r'^```(?:json)?\n?', '', bridge_content)
                bridge_content = re.sub(r'\n?```$', '', bridge_content)

            try:
                bridge_note = json.loads(bridge_content)
            except json.JSONDecodeError:
                json_match = re.search(r'\{[\s\S]*\}', bridge_content)
                if json_match:
                    bridge_note = json.loads(json_match.group())
                else:
                    continue

            # Create discovery record
            # Include generation_ids for cost tracking (analysis + this bridge note)
            discovery_generation_ids = []
            if analysis_generation_id:
                discovery_generation_ids.append(analysis_generation_id)
            if bridge_generation_id:
                discovery_generation_ids.append(bridge_generation_id)

            discovery = {
                "id": f"disc_{uuid.uuid4().hex[:8]}",
                "type": "bridge_note",
                "status": "pending",
                "created_at": datetime.utcnow().isoformat(),
                "run_id": run_id,
                "user_prompt": prompt,
                "source_notes": group_notes,
                "source_entities": [],
                "connection_type": group.get("connection_type", "conceptual"),
                "connection_strength": group.get("strength", "moderate"),
                "suggested_title": bridge_note.get("title", "Untitled Bridge Note"),
                "suggested_body": bridge_note.get("body", ""),
                "suggested_tags": bridge_note.get("tags", []),
                "reasoning": group.get("insight", ""),
                "bridge_suggestion": group.get("bridge_suggestion", ""),
                "references": bridge_note.get("references", ""),
                "generation_ids": discovery_generation_ids
            }

            discoveries.append(discovery)

        discovery_state.progress = 100

        # Save discoveries
        data = load_discoveries()
        data["discoveries"].extend(discoveries)
        data["discovery_runs"].append({
            "id": run_id,
            "prompt": prompt,
            "started_at": discovery_state.started_at,
            "completed_at": datetime.utcnow().isoformat(),
            "notes_analyzed": len(notes),
            "discoveries_generated": len(discoveries),
            "model": model
        })
        save_discoveries(data)

        return {
            "run_id": run_id,
            "status": "completed",
            "notes_analyzed": len(notes),
            "discoveries_generated": len(discoveries),
            "discoveries": discoveries
        }

    except Exception as e:
        logger.error(f"Discovery error: {e}")
        discovery_state.error = str(e)
        return {"error": str(e)}

    finally:
        discovery_state.running = False


def list_discoveries(
    status: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    List discoveries with optional status filter.

    Args:
        status: Filter by status (pending, approved, dismissed)
        limit: Maximum discoveries to return

    Returns:
        List of discovery dicts
    """
    data = load_discoveries()
    discoveries = data.get("discoveries", [])

    if status:
        discoveries = [d for d in discoveries if d.get("status") == status]

    # Sort by created_at descending (most recent first)
    discoveries.sort(key=lambda d: d.get("created_at", ""), reverse=True)

    return discoveries[:limit]


def get_discovery(discovery_id: str) -> Optional[Dict[str, Any]]:
    """Get a single discovery by ID."""
    data = load_discoveries()

    for discovery in data.get("discoveries", []):
        if discovery.get("id") == discovery_id:
            return discovery

    return None


async def approve_discovery(
    discovery_id: str,
    edits: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Approve a discovery and create the bridge note.

    Args:
        discovery_id: Discovery ID to approve
        edits: Optional edits to title, body, or tags

    Returns:
        Created conversation/note info
    """
    data = load_discoveries()

    discovery = None
    for d in data["discoveries"]:
        if d.get("id") == discovery_id:
            discovery = d
            break

    if not discovery:
        return {"error": "Discovery not found"}

    if discovery.get("status") != "pending":
        return {"error": f"Discovery already {discovery.get('status')}"}

    # Apply edits if provided
    title = edits.get("title", discovery["suggested_title"]) if edits else discovery["suggested_title"]
    body = edits.get("body", discovery["suggested_body"]) if edits else discovery["suggested_body"]
    tags = edits.get("tags", discovery["suggested_tags"]) if edits else discovery["suggested_tags"]

    # Create a discovery conversation
    conv_id = f"disc-{uuid.uuid4().hex[:8]}"
    note_id = f"note-{uuid.uuid4().hex[:8]}"

    conversation = {
        "id": conv_id,
        "mode": "discovery",
        "title": f"Discovery: {title}",
        "created_at": datetime.utcnow().isoformat(),
        "discovery_id": discovery_id,
        "source_notes": discovery["source_notes"],
        "total_cost": 0.0,  # Initialize cost tracking
        "messages": [
            {
                "role": "assistant",
                "notes": [{
                    "id": note_id,
                    "title": title,
                    "body": body,
                    "tags": tags,
                    "is_bridge": True,
                    "source_note_ids": discovery["source_notes"],
                    "reasoning": discovery.get("reasoning", "")
                }]
            }
        ]
    }

    save_conversation(conversation)

    # Generate summary for gallery preview
    try:
        summary = await generate_summary(body, 'synthesizer')
        if summary:
            update_conversation_summary(conv_id, summary)
    except Exception as e:
        logger.warning(f"Failed to generate summary for discovery {conv_id}: {e}")

    # Fetch and accumulate costs from generation_ids
    generation_ids = discovery.get("generation_ids", [])
    if generation_ids:
        try:
            cost_tasks = [get_generation_cost(gid) for gid in generation_ids]
            costs = await asyncio.gather(*cost_tasks)
            total_cost = sum(c for c in costs if c is not None)
            if total_cost > 0:
                update_conversation_cost(conv_id, total_cost)
        except Exception as e:
            logger.warning(f"Failed to fetch costs for discovery {conv_id}: {e}")

    # Update discovery status
    discovery["status"] = "approved"
    discovery["approved_at"] = datetime.utcnow().isoformat()
    discovery["conversation_id"] = conv_id
    discovery["note_id"] = note_id
    save_discoveries(data)

    return {
        "status": "approved",
        "conversation_id": conv_id,
        "note_id": note_id,
        "title": title
    }


def dismiss_discovery(discovery_id: str) -> bool:
    """Dismiss a discovery (won't show again)."""
    data = load_discoveries()

    for discovery in data["discoveries"]:
        if discovery.get("id") == discovery_id:
            discovery["status"] = "dismissed"
            discovery["dismissed_at"] = datetime.utcnow().isoformat()
            save_discoveries(data)
            return True

    return False


def delete_discovery(discovery_id: str) -> bool:
    """Delete a discovery entirely."""
    data = load_discoveries()

    original_count = len(data["discoveries"])
    data["discoveries"] = [d for d in data["discoveries"] if d.get("id") != discovery_id]

    if len(data["discoveries"]) < original_count:
        save_discoveries(data)
        return True

    return False


def get_discovery_stats() -> Dict[str, Any]:
    """Get discovery statistics."""
    data = load_discoveries()
    discoveries = data.get("discoveries", [])
    runs = data.get("discovery_runs", [])

    status_counts = {"pending": 0, "approved": 0, "dismissed": 0}
    for d in discoveries:
        status = d.get("status", "pending")
        status_counts[status] = status_counts.get(status, 0) + 1

    return {
        "total_discoveries": len(discoveries),
        "pending": status_counts["pending"],
        "approved": status_counts["approved"],
        "dismissed": status_counts["dismissed"],
        "total_runs": len(runs),
        "last_run": runs[-1] if runs else None,
        "settings": data.get("settings", {})
    }


def update_discovery_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Update discovery settings."""
    data = load_discoveries()

    for key, value in settings.items():
        if key in data["settings"]:
            data["settings"][key] = value

    save_discoveries(data)
    return data["settings"]
