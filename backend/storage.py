"""JSON-based storage for conversations."""

import json
import os
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import DATA_DIR


def extract_prompt_title(system_prompt: Optional[str]) -> Optional[str]:
    """
    Extract the title from a system prompt (first # heading).

    Args:
        system_prompt: The system prompt content

    Returns:
        The title or None if no prompt or no title found
    """
    if not system_prompt:
        return None

    for line in system_prompt.strip().split('\n'):
        line = line.strip()
        if line.startswith('# '):
            return line[2:].strip()

    return None


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation."""
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def create_conversation(
    conversation_id: str,
    council_config: Optional[Dict[str, Any]] = None,
    system_prompt: Optional[str] = None,
    mode: str = "council",
    synthesizer_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation
        council_config: Optional custom council configuration with:
            - council_models: List of model identifiers to include
            - chairman_model: Model identifier for the chairman
        system_prompt: Optional system prompt to use for this conversation
        mode: Conversation mode - "council" or "synthesizer"
        synthesizer_config: Optional synthesizer configuration with:
            - model: Model to use for synthesis
            - use_council: Whether to use multiple models

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "mode": mode,
        "messages": [],
        "comments": [],  # Store inline comments
        "threads": [],  # Store follow-up threads
        "council_config": council_config,  # Store custom config if provided
        "system_prompt": system_prompt,  # Store system prompt if provided
        "synthesizer_config": synthesizer_config,  # Store synthesizer config if provided
        "total_cost": 0.0,  # Track cumulative API cost for this conversation
        "linked_visualisations": []  # List of visualisations created from this conversation
    }

    # Save to file
    path = get_conversation_path(conversation_id)
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)

    return conversation


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return None

    with open(path, 'r') as f:
        return json.load(f)


def save_conversation(conversation: Dict[str, Any]):
    """
    Save a conversation to storage.

    Args:
        conversation: Conversation dict to save
    """
    ensure_data_dir()

    path = get_conversation_path(conversation['id'])
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)


def list_conversations() -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only).

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            path = os.path.join(DATA_DIR, filename)
            with open(path, 'r') as f:
                data = json.load(f)
                # Return metadata only
                conv_meta = {
                    "id": data["id"],
                    "created_at": data["created_at"],
                    "title": data.get("title", "New Conversation"),
                    "message_count": len(data["messages"]),
                    "thread_count": len(data.get("threads", [])),
                    "mode": data.get("mode", "council")  # Default to council for backwards compat
                }
                # For council conversations, extract prompt title from system_prompt
                if conv_meta["mode"] == "council" and data.get("system_prompt"):
                    prompt_title = extract_prompt_title(data["system_prompt"])
                    if prompt_title:
                        conv_meta["prompt_title"] = prompt_title
                # For synthesizer, extract source_type from first assistant message
                if conv_meta["mode"] == "synthesizer":
                    for msg in data.get("messages", []):
                        if msg.get("role") == "assistant" and msg.get("source_type"):
                            conv_meta["source_type"] = msg["source_type"]
                            break
                # For visualiser, extract source_type, diagram_style, and latest image_id
                if conv_meta["mode"] == "visualiser":
                    for msg in data.get("messages", []):
                        if msg.get("role") == "user":
                            if msg.get("source_type"):
                                conv_meta["source_type"] = msg["source_type"]
                            if msg.get("style"):
                                conv_meta["diagram_style"] = msg["style"]
                            break
                    # Get the latest image_id from assistant messages
                    for msg in reversed(data.get("messages", [])):
                        if msg.get("role") == "assistant" and msg.get("image_id"):
                            conv_meta["latest_image_id"] = msg["image_id"]
                            conv_meta["image_count"] = sum(
                                1 for m in data.get("messages", [])
                                if m.get("role") == "assistant" and m.get("image_id")
                            )
                            break
                # Include status in metadata (with defaults for existing conversations)
                conv_meta["status"] = {
                    "state": data.get("status", {}).get("state", "idle"),
                    "is_unread": data.get("status", {}).get("is_unread", False)
                }
                # Include total cost for display (default to 0 for backwards compat)
                conv_meta["total_cost"] = data.get("total_cost", 0.0)
                # Include summary for gallery preview (if exists)
                if data.get("summary"):
                    conv_meta["summary"] = data["summary"]
                # Include mode badges for synthesizer notes
                if conv_meta["mode"] == "synthesizer":
                    for msg in data.get("messages", []):
                        if msg.get("role") == "assistant":
                            if msg.get("mode") == "deliberation":
                                conv_meta["is_deliberation"] = True
                                break
                            elif msg.get("mode") == "knowledge_graph":
                                conv_meta["is_knowledge_graph"] = True
                                break
                conversations.append(conv_meta)

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(conversation_id: str, content: str):
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "user",
        "content": content
    })

    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any]
):
    """
    Add an assistant message with all 3 stages to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3
    })

    save_conversation(conversation)


def update_conversation_title(conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation)


def update_conversation_status(
    conversation_id: str,
    state: str,
    is_unread: Optional[bool] = None
):
    """
    Update the status of a conversation.

    Args:
        conversation_id: Conversation identifier
        state: New state ('idle', 'pending', 'completed')
        is_unread: Optional flag to set unread status (only for background updates)
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    if "status" not in conversation:
        conversation["status"] = {
            "state": "idle",
            "is_unread": False,
            "last_updated_at": None,
            "last_read_at": None
        }

    conversation["status"]["state"] = state
    conversation["status"]["last_updated_at"] = datetime.utcnow().isoformat()

    if is_unread is not None:
        conversation["status"]["is_unread"] = is_unread

    save_conversation(conversation)


def mark_conversation_read(conversation_id: str):
    """
    Mark a conversation as read.

    Args:
        conversation_id: Conversation identifier
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    if "status" not in conversation:
        conversation["status"] = {
            "state": "idle",
            "is_unread": False,
            "last_updated_at": None,
            "last_read_at": None
        }

    conversation["status"]["is_unread"] = False
    conversation["status"]["last_read_at"] = datetime.utcnow().isoformat()

    save_conversation(conversation)


def update_conversation_cost(conversation_id: str, cost_to_add: float):
    """
    Add cost to a conversation's total_cost field.

    Args:
        conversation_id: Conversation identifier
        cost_to_add: Amount to add to the total cost (in dollars)
    """
    if cost_to_add is None or cost_to_add <= 0:
        return

    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    current_cost = conversation.get("total_cost", 0.0)
    conversation["total_cost"] = current_cost + cost_to_add

    save_conversation(conversation)


def update_conversation_summary(conversation_id: str, summary: str):
    """
    Update the summary of a conversation (for gallery preview).

    Args:
        conversation_id: Conversation identifier
        summary: Brief summary text for gallery card preview
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["summary"] = summary
    save_conversation(conversation)


def add_comment(
    conversation_id: str,
    comment_id: str,
    selection: str,
    content: str,
    source_type: str = "council",
    source_content: Optional[str] = None,
    # Council-specific fields
    message_index: Optional[int] = None,
    stage: Optional[int] = None,
    model: Optional[str] = None,
    # Synthesizer-specific fields
    note_id: Optional[str] = None,
    note_title: Optional[str] = None,
    source_url: Optional[str] = None,
    note_model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Add a comment to a conversation.

    Args:
        conversation_id: Conversation identifier
        comment_id: Unique identifier for the comment
        selection: Highlighted text snippet
        content: Comment content
        source_type: Type of source ('council' or 'synthesizer')
        source_content: Full content of the response the selection came from

        Council-specific:
        message_index: Index of the message being commented on
        stage: Stage number (1, 2, or 3)
        model: Model identifier for the response being commented on

        Synthesizer-specific:
        note_id: ID of the note being commented on
        note_title: Title of the note
        source_url: Original URL that was synthesized
        note_model: Model that generated the note

    Returns:
        The created comment
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    comment = {
        "id": comment_id,
        "source_type": source_type,
        "selection": selection,
        "content": content,
        "source_content": source_content,
        "created_at": datetime.utcnow().isoformat()
    }

    # Add source-type specific fields
    if source_type == "council":
        comment["message_index"] = message_index
        comment["stage"] = stage
        comment["model"] = model
    elif source_type == "synthesizer":
        comment["note_id"] = note_id
        comment["note_title"] = note_title
        comment["source_url"] = source_url
        comment["note_model"] = note_model

    if "comments" not in conversation:
        conversation["comments"] = []

    conversation["comments"].append(comment)
    save_conversation(conversation)

    return comment


def get_comments(conversation_id: str, message_index: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Get comments for a conversation, optionally filtered by message index.

    Args:
        conversation_id: Conversation identifier
        message_index: Optional message index to filter by

    Returns:
        List of comments
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    comments = conversation.get("comments", [])

    if message_index is not None:
        comments = [c for c in comments if c["message_index"] == message_index]

    return comments


def update_comment(conversation_id: str, comment_id: str, content: str) -> Dict[str, Any]:
    """
    Update a comment's content.

    Args:
        conversation_id: Conversation identifier
        comment_id: Comment identifier
        content: New comment content

    Returns:
        The updated comment
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    if "comments" not in conversation:
        raise ValueError(f"Comment {comment_id} not found")

    for comment in conversation["comments"]:
        if comment["id"] == comment_id:
            comment["content"] = content
            comment["updated_at"] = datetime.utcnow().isoformat()
            save_conversation(conversation)
            return comment

    raise ValueError(f"Comment {comment_id} not found")


def delete_comment(conversation_id: str, comment_id: str):
    """
    Delete a comment from a conversation.

    Args:
        conversation_id: Conversation identifier
        comment_id: Comment identifier
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    if "comments" in conversation:
        conversation["comments"] = [c for c in conversation["comments"] if c["id"] != comment_id]
        save_conversation(conversation)


def create_thread(
    conversation_id: str,
    thread_id: str,
    model: str,
    context: Dict[str, Any],
    initial_question: str
) -> Dict[str, Any]:
    """
    Create a new follow-up thread.

    Args:
        conversation_id: Conversation identifier
        thread_id: Unique identifier for the thread
        model: Model identifier to query
        context: Context dict with message_index, relevant comment IDs, and optional context segments
        initial_question: The follow-up question

    Returns:
        The created thread
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    thread = {
        "id": thread_id,
        "model": model,
        "context": context,
        "messages": [
            {
                "role": "user",
                "content": initial_question,
                "created_at": datetime.utcnow().isoformat()
            }
        ],
        "created_at": datetime.utcnow().isoformat()
    }

    if "threads" not in conversation:
        conversation["threads"] = []

    conversation["threads"].append(thread)
    save_conversation(conversation)

    return thread


def add_thread_message(
    conversation_id: str,
    thread_id: str,
    role: str,
    content: str
):
    """
    Add a message to an existing thread. Searches both legacy top-level
    threads and session-scoped threads for backward compatibility.

    Args:
        conversation_id: Conversation identifier
        thread_id: Thread identifier
        role: Message role (user or assistant)
        content: Message content
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    thread = None
    legacy_threads = conversation.get("threads", [])
    thread = next((t for t in legacy_threads if t["id"] == thread_id), None)

    if thread is None:
        for session in conversation.get("review_sessions", []):
            for t in session.get("threads", []):
                if t["id"] == thread_id:
                    thread = t
                    break
            if thread:
                break

    if thread is None:
        raise ValueError(f"Thread {thread_id} not found")

    thread["messages"].append({
        "role": role,
        "content": content,
        "created_at": datetime.utcnow().isoformat()
    })

    save_conversation(conversation)


def get_thread(conversation_id: str, thread_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a specific thread. Searches both legacy top-level threads and
    session-scoped threads for backward compatibility.

    Args:
        conversation_id: Conversation identifier
        thread_id: Thread identifier

    Returns:
        Thread dict or None if not found
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        return None

    legacy_threads = conversation.get("threads", [])
    thread = next((t for t in legacy_threads if t["id"] == thread_id), None)
    if thread:
        return thread

    for session in conversation.get("review_sessions", []):
        for thread in session.get("threads", []):
            if thread["id"] == thread_id:
                return thread

    return None


def delete_conversation(conversation_id: str) -> bool:
    """
    Delete a conversation from storage.

    Args:
        conversation_id: Conversation identifier

    Returns:
        True if deleted, False if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return False

    os.remove(path)
    return True


# =============================================================================
# Review Sessions
# =============================================================================

def _generate_session_id() -> str:
    """Generate a unique session ID with timestamp."""
    import uuid
    now = datetime.utcnow()
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    short_uuid = str(uuid.uuid4())[:8]
    return f"rs_{timestamp}_{short_uuid}"


def _generate_session_name() -> str:
    """Generate a session name from current timestamp."""
    now = datetime.utcnow()
    return now.strftime("Review %Y-%m-%d %H:%M")


def migrate_to_review_sessions(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Migrate a conversation from legacy comments/threads to review_sessions.

    If the conversation already has review_sessions, returns unchanged.
    Otherwise, creates an 'Initial Review' session containing existing
    comments and threads.

    Args:
        conversation: Conversation dict to migrate

    Returns:
        Migrated conversation dict (also saves to disk)
    """
    if "review_sessions" in conversation and conversation["review_sessions"]:
        return conversation

    legacy_comments = conversation.get("comments", [])
    legacy_threads = conversation.get("threads", [])

    if not legacy_comments and not legacy_threads:
        conversation["review_sessions"] = []
        conversation["active_review_session_id"] = None
        save_conversation(conversation)
        return conversation

    session_id = _generate_session_id()
    session = {
        "id": session_id,
        "name": "Initial Review",
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
        "comments": legacy_comments,
        "context_segments": [],
        "threads": legacy_threads
    }

    conversation["review_sessions"] = [session]
    conversation["active_review_session_id"] = session_id
    conversation["comments"] = []
    conversation["threads"] = []

    save_conversation(conversation)
    return conversation


def get_conversation_with_migration(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation and migrate to review_sessions if needed.

    Args:
        conversation_id: Conversation identifier

    Returns:
        Conversation dict with review_sessions, or None if not found
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return None

    return migrate_to_review_sessions(conversation)


def create_review_session(
    conversation_id: str,
    name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a new review session for a conversation.

    Args:
        conversation_id: Conversation identifier
        name: Optional session name (auto-generated if not provided)

    Returns:
        The created session
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    session_id = _generate_session_id()
    session = {
        "id": session_id,
        "name": name or _generate_session_name(),
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
        "comments": [],
        "context_segments": [],
        "threads": []
    }

    if "review_sessions" not in conversation:
        conversation["review_sessions"] = []

    conversation["review_sessions"].append(session)
    conversation["active_review_session_id"] = session_id

    save_conversation(conversation)
    return session


def get_review_sessions(conversation_id: str) -> List[Dict[str, Any]]:
    """
    Get all review sessions for a conversation.

    Args:
        conversation_id: Conversation identifier

    Returns:
        List of review sessions
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    return conversation.get("review_sessions", [])


def get_review_session(
    conversation_id: str,
    session_id: str
) -> Optional[Dict[str, Any]]:
    """
    Get a specific review session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier

    Returns:
        Session dict or None if not found
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        return None

    sessions = conversation.get("review_sessions", [])
    return next((s for s in sessions if s["id"] == session_id), None)


def get_active_review_session(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Get the active review session for a conversation.

    Args:
        conversation_id: Conversation identifier

    Returns:
        Active session dict or None if no sessions exist
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        return None

    active_id = conversation.get("active_review_session_id")
    if not active_id:
        sessions = conversation.get("review_sessions", [])
        if sessions:
            sorted_sessions = sorted(
                sessions,
                key=lambda s: s.get("updated_at", s.get("created_at", "")),
                reverse=True
            )
            return sorted_sessions[0]
        return None

    sessions = conversation.get("review_sessions", [])
    return next((s for s in sessions if s["id"] == active_id), None)


def update_review_session(
    conversation_id: str,
    session_id: str,
    name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Update a review session (e.g., rename).

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        name: New session name

    Returns:
        The updated session
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    for session in sessions:
        if session["id"] == session_id:
            if name is not None:
                session["name"] = name
            session["updated_at"] = datetime.utcnow().isoformat()
            save_conversation(conversation)
            return session

    raise ValueError(f"Session {session_id} not found")


def delete_review_session(conversation_id: str, session_id: str) -> bool:
    """
    Delete a review session (cascade deletes its threads).

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier

    Returns:
        True if deleted, False if not found
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    original_count = len(sessions)
    conversation["review_sessions"] = [s for s in sessions if s["id"] != session_id]

    if len(conversation["review_sessions"]) == original_count:
        return False

    if conversation.get("active_review_session_id") == session_id:
        remaining = conversation["review_sessions"]
        if remaining:
            sorted_sessions = sorted(
                remaining,
                key=lambda s: s.get("updated_at", s.get("created_at", "")),
                reverse=True
            )
            conversation["active_review_session_id"] = sorted_sessions[0]["id"]
        else:
            conversation["active_review_session_id"] = None

    save_conversation(conversation)
    return True


def set_active_review_session(conversation_id: str, session_id: str) -> Dict[str, Any]:
    """
    Set a review session as active.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier to activate

    Returns:
        The activated session
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    session = next((s for s in sessions if s["id"] == session_id), None)

    if session is None:
        raise ValueError(f"Session {session_id} not found")

    conversation["active_review_session_id"] = session_id
    save_conversation(conversation)

    return session


# =============================================================================
# Session-scoped Comments
# =============================================================================

def add_session_comment(
    conversation_id: str,
    session_id: str,
    comment_id: str,
    selection: str,
    content: str,
    source_type: str = "council",
    source_content: Optional[str] = None,
    message_index: Optional[int] = None,
    stage: Optional[int] = None,
    model: Optional[str] = None,
    note_id: Optional[str] = None,
    note_title: Optional[str] = None,
    source_url: Optional[str] = None,
    note_model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Add a comment to a review session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        comment_id: Unique identifier for the comment
        selection: Highlighted text snippet
        content: Comment content
        source_type: Type of source ('council' or 'synthesizer')
        source_content: Full content of the response the selection came from
        message_index: Index of the message (council)
        stage: Stage number (council)
        model: Model identifier (council)
        note_id: Note ID (synthesizer)
        note_title: Note title (synthesizer)
        source_url: Source URL (synthesizer)
        note_model: Note model (synthesizer)

    Returns:
        The created comment
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    session = next((s for s in sessions if s["id"] == session_id), None)

    if session is None:
        raise ValueError(f"Session {session_id} not found")

    comment = {
        "id": comment_id,
        "source_type": source_type,
        "selection": selection,
        "content": content,
        "source_content": source_content,
        "created_at": datetime.utcnow().isoformat()
    }

    if source_type == "council":
        comment["message_index"] = message_index
        comment["stage"] = stage
        comment["model"] = model
    elif source_type == "synthesizer":
        comment["note_id"] = note_id
        comment["note_title"] = note_title
        comment["source_url"] = source_url
        comment["note_model"] = note_model

    if "comments" not in session:
        session["comments"] = []

    session["comments"].append(comment)
    session["updated_at"] = datetime.utcnow().isoformat()

    save_conversation(conversation)
    return comment


def get_session_comments(
    conversation_id: str,
    session_id: str,
    message_index: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Get comments for a review session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        message_index: Optional message index filter

    Returns:
        List of comments
    """
    session = get_review_session(conversation_id, session_id)
    if session is None:
        raise ValueError(f"Session {session_id} not found")

    comments = session.get("comments", [])

    if message_index is not None:
        comments = [c for c in comments if c.get("message_index") == message_index]

    return comments


def update_session_comment(
    conversation_id: str,
    session_id: str,
    comment_id: str,
    content: str
) -> Dict[str, Any]:
    """
    Update a comment's content within a session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        comment_id: Comment identifier
        content: New comment content

    Returns:
        The updated comment
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    session = next((s for s in sessions if s["id"] == session_id), None)

    if session is None:
        raise ValueError(f"Session {session_id} not found")

    for comment in session.get("comments", []):
        if comment["id"] == comment_id:
            comment["content"] = content
            comment["updated_at"] = datetime.utcnow().isoformat()
            session["updated_at"] = datetime.utcnow().isoformat()
            save_conversation(conversation)
            return comment

    raise ValueError(f"Comment {comment_id} not found")


def delete_session_comment(
    conversation_id: str,
    session_id: str,
    comment_id: str
) -> bool:
    """
    Delete a comment from a session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        comment_id: Comment identifier

    Returns:
        True if deleted
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    session = next((s for s in sessions if s["id"] == session_id), None)

    if session is None:
        raise ValueError(f"Session {session_id} not found")

    original_count = len(session.get("comments", []))
    session["comments"] = [c for c in session.get("comments", []) if c["id"] != comment_id]

    if len(session["comments"]) < original_count:
        session["updated_at"] = datetime.utcnow().isoformat()
        save_conversation(conversation)
        return True

    return False


# =============================================================================
# Session-scoped Context Segments
# =============================================================================

def add_session_context_segment(
    conversation_id: str,
    session_id: str,
    segment: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Add a context segment to a review session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        segment: Segment data with id, sourceType, content, etc.

    Returns:
        The added segment
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    session = next((s for s in sessions if s["id"] == session_id), None)

    if session is None:
        raise ValueError(f"Session {session_id} not found")

    if "context_segments" not in session:
        session["context_segments"] = []

    existing_ids = [s["id"] for s in session["context_segments"]]
    if segment.get("id") not in existing_ids:
        session["context_segments"].append(segment)
        session["updated_at"] = datetime.utcnow().isoformat()
        save_conversation(conversation)

    return segment


def remove_session_context_segment(
    conversation_id: str,
    session_id: str,
    segment_id: str
) -> bool:
    """
    Remove a context segment from a session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        segment_id: Segment identifier

    Returns:
        True if removed
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    session = next((s for s in sessions if s["id"] == session_id), None)

    if session is None:
        raise ValueError(f"Session {session_id} not found")

    original_count = len(session.get("context_segments", []))
    session["context_segments"] = [
        s for s in session.get("context_segments", [])
        if s.get("id") != segment_id
    ]

    if len(session["context_segments"]) < original_count:
        session["updated_at"] = datetime.utcnow().isoformat()
        save_conversation(conversation)
        return True

    return False


# =============================================================================
# Session-scoped Threads
# =============================================================================

def create_session_thread(
    conversation_id: str,
    session_id: str,
    thread_id: str,
    model: str,
    context: Dict[str, Any],
    initial_question: str
) -> Dict[str, Any]:
    """
    Create a new thread within a review session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        thread_id: Unique identifier for the thread
        model: Model identifier
        context: Context dict with comment_ids, context_segments, etc.
        initial_question: The initial question

    Returns:
        The created thread
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    session = next((s for s in sessions if s["id"] == session_id), None)

    if session is None:
        raise ValueError(f"Session {session_id} not found")

    thread = {
        "id": thread_id,
        "model": model,
        "context": context,
        "messages": [
            {
                "role": "user",
                "content": initial_question,
                "created_at": datetime.utcnow().isoformat()
            }
        ],
        "created_at": datetime.utcnow().isoformat()
    }

    if "threads" not in session:
        session["threads"] = []

    session["threads"].append(thread)
    session["updated_at"] = datetime.utcnow().isoformat()

    save_conversation(conversation)
    return thread


def get_session_thread(
    conversation_id: str,
    session_id: str,
    thread_id: str
) -> Optional[Dict[str, Any]]:
    """
    Get a specific thread from a session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        thread_id: Thread identifier

    Returns:
        Thread dict or None
    """
    session = get_review_session(conversation_id, session_id)
    if session is None:
        return None

    threads = session.get("threads", [])
    return next((t for t in threads if t["id"] == thread_id), None)


def find_thread_in_sessions(
    conversation_id: str,
    thread_id: str
) -> Optional[tuple]:
    """
    Find a thread across all sessions.

    Args:
        conversation_id: Conversation identifier
        thread_id: Thread identifier

    Returns:
        Tuple of (session_id, thread) or None if not found
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        return None

    for session in conversation.get("review_sessions", []):
        for thread in session.get("threads", []):
            if thread["id"] == thread_id:
                return (session["id"], thread)

    legacy_threads = conversation.get("threads", [])
    for thread in legacy_threads:
        if thread["id"] == thread_id:
            return (None, thread)

    return None


def add_session_thread_message(
    conversation_id: str,
    session_id: str,
    thread_id: str,
    role: str,
    content: str
) -> Dict[str, Any]:
    """
    Add a message to a thread within a session.

    Args:
        conversation_id: Conversation identifier
        session_id: Session identifier
        thread_id: Thread identifier
        role: Message role (user or assistant)
        content: Message content

    Returns:
        The added message
    """
    conversation = get_conversation_with_migration(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    sessions = conversation.get("review_sessions", [])
    session = next((s for s in sessions if s["id"] == session_id), None)

    if session is None:
        raise ValueError(f"Session {session_id} not found")

    thread = next((t for t in session.get("threads", []) if t["id"] == thread_id), None)

    if thread is None:
        raise ValueError(f"Thread {thread_id} not found")

    message = {
        "role": role,
        "content": content,
        "created_at": datetime.utcnow().isoformat()
    }

    thread["messages"].append(message)
    session["updated_at"] = datetime.utcnow().isoformat()

    save_conversation(conversation)
    return message


# =============================================================================
# Synthesizer-specific functions
# =============================================================================

def add_synthesizer_user_message(
    conversation_id: str,
    url: str,
    comment: Optional[str] = None
):
    """
    Add a synthesizer user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        url: The URL being processed
        comment: Optional user comment/guidance
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "user",
        "url": url,
        "comment": comment
    })

    save_conversation(conversation)


def add_synthesizer_message(
    conversation_id: str,
    notes: List[Dict[str, Any]],
    raw_response: str,
    source_content: str,
    source_type: str,
    source_url: Optional[str],
    model: Optional[str] = None,
    source_title: Optional[str] = None
):
    """
    Add a synthesizer assistant message with generated notes.

    Args:
        conversation_id: Conversation identifier
        notes: List of generated Zettel notes, each with:
            - id: Note identifier
            - title: Note title
            - tags: List of hashtags
            - body: Note content (~100 words)
        raw_response: Raw LLM response for debugging
        source_content: Full source content (transcript or article text)
        source_type: Type of source ("youtube", "podcast", or "article")
        source_url: Original URL
        model: Model used for generation
        source_title: Title of the source content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "assistant",
        "notes": notes,
        "raw_response": raw_response,
        "source_content": source_content,
        "source_type": source_type,
        "source_url": source_url,
        "source_title": source_title,
        "model": model
    })

    save_conversation(conversation)


def add_synthesizer_deliberation_message(
    conversation_id: str,
    notes: List[Dict[str, Any]],
    deliberation: Dict[str, Any],
    stage3_raw: str,
    source_content: str,
    source_type: str,
    source_url: Optional[str],
    models: List[str],
    chairman_model: str,
    source_title: Optional[str] = None
):
    """
    Add a synthesizer assistant message with deliberation details.

    This stores the full 3-stage council deliberation process results.

    Args:
        conversation_id: Conversation identifier
        notes: Final synthesized Zettel notes
        deliberation: Deliberation metadata containing:
            - stage1: List of per-model results with notes
            - stage2: List of rankings with parsed_ranking
            - label_to_model: Mapping for de-anonymization
            - aggregate_rankings: Sorted rankings by avg position
        stage3_raw: Chairman's raw response
        source_content: Full source content
        source_type: Type of source ("youtube", "podcast", "article", "text")
        source_url: Original URL (if any)
        models: List of models used in deliberation
        chairman_model: Model used for final synthesis
        source_title: Title of the source content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "assistant",
        "notes": notes,
        "mode": "deliberation",  # Distinguish from single/parallel modes
        "deliberation": deliberation,
        "stage3_raw": stage3_raw,
        "source_content": source_content,
        "source_type": source_type,
        "source_url": source_url,
        "source_title": source_title,
        "models": models,
        "chairman_model": chairman_model
    })

    save_conversation(conversation)


def add_synthesizer_kg_message(
    conversation_id: str,
    notes: List[Dict[str, Any]],
    raw_response: str,
    source_content: str,
    source_type: str,
    source_url: Optional[str],
    model: str,
    context_notes: List[Dict[str, Any]],
    topics_extracted: Dict[str, Any],
    source_title: Optional[str] = None
):
    """
    Add a synthesizer assistant message with knowledge graph context details.

    This stores notes generated with awareness of the existing knowledge graph.

    Args:
        conversation_id: Conversation identifier
        notes: Generated Zettel notes
        raw_response: Raw LLM response
        source_content: Full source content
        source_type: Type of source ("youtube", "podcast", "article", "text")
        source_url: Original URL (if any)
        model: Model used for generation
        context_notes: Related notes from knowledge graph used as context
        topics_extracted: Topics and entities extracted from content (first pass)
        source_title: Title of the source content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "assistant",
        "notes": notes,
        "mode": "knowledge_graph",  # Distinguish from single/deliberation modes
        "raw_response": raw_response,
        "source_content": source_content,
        "source_type": source_type,
        "source_url": source_url,
        "source_title": source_title,
        "model": model,
        "context_notes": context_notes,
        "topics_extracted": topics_extracted
    })

    save_conversation(conversation)


def update_synthesizer_source_metadata(
    conversation_id: str,
    updates: Dict[str, Optional[str]]
) -> Dict[str, Any]:
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    synthesizer_config = conversation.get("synthesizer_config") or {}
    for key, value in updates.items():
        synthesizer_config[key] = value
    conversation["synthesizer_config"] = synthesizer_config

    for message in conversation.get("messages", []):
        if message.get("role") == "assistant" and message.get("notes"):
            for key, value in updates.items():
                message[key] = value

    save_conversation(conversation)
    return conversation


def update_note_tweet(
    conversation_id: str,
    note_id: str,
    tweet: str
) -> bool:
    """
    Update a note's tweet field in a conversation.

    Args:
        conversation_id: Conversation identifier
        note_id: Note identifier (e.g., "note-1")
        tweet: Generated tweet text

    Returns:
        True if note was found and updated, False otherwise
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return False

    # Search through messages to find the note
    for message in conversation.get("messages", []):
        if message.get("role") == "assistant":
            notes = message.get("notes", [])
            for note in notes:
                if note.get("id") == note_id:
                    note["tweet"] = tweet
                    save_conversation(conversation)
                    return True

    return False


# =============================================================================
# Visualiser-specific storage functions
# =============================================================================


def add_visualiser_user_message(
    conversation_id: str,
    source_type: str,
    source_id: Optional[str] = None,
    source_url: Optional[str] = None,
    source_text: Optional[str] = None,
    source_title: Optional[str] = None,
    style: str = "bento"
):
    """
    Add a visualiser user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        source_type: Type of source ('conversation', 'url', 'text')
        source_id: Source conversation ID (if source_type='conversation')
        source_url: URL (if source_type='url')
        source_text: Plain text (if source_type='text')
        source_title: Title of the source content
        style: Diagram style
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "user",
        "source_type": source_type,
        "style": style
    }

    if source_title:
        message["source_title"] = source_title

    if source_type == "conversation":
        message["source_id"] = source_id
    elif source_type == "url":
        message["source_url"] = source_url
    elif source_type == "text":
        message["source_text"] = source_text

    conversation["messages"].append(message)
    save_conversation(conversation)


def add_visualiser_message(
    conversation_id: str,
    image_id: str,
    image_path: str,
    style: str,
    source_content: str,
    model: Optional[str] = None,
    edit_prompt: Optional[str] = None
):
    """
    Add a visualiser assistant message with generated image.

    Args:
        conversation_id: Conversation identifier
        image_id: Unique identifier for the generated image
        image_path: Path where the image is stored
        style: Diagram style used
        source_content: Content that was visualized
        model: Model used for generation
        edit_prompt: The edit prompt used if this is a regenerated version
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "image_id": image_id,
        "image_path": image_path,
        "style": style,
        "source_content": source_content,
        "model": model
    }

    if edit_prompt:
        message["edit_prompt"] = edit_prompt

    conversation["messages"].append(message)

    save_conversation(conversation)


# =============================================================================
# Usage Statistics
# =============================================================================

def get_usage_stats() -> Dict[str, Any]:
    """
    Get aggregated usage statistics across all conversations.

    Returns:
        Dict with:
            - total_spent: Total cost across all conversations
            - by_mode: Dict mapping mode to total cost
            - conversation_count: Number of conversations
            - top_conversations: List of 5 most expensive conversations
            - daily_spending: List of daily spending for last 30 days with mode breakdown
    """
    ensure_data_dir()

    total_spent = 0.0
    by_mode = {
        "council": 0.0,
        "synthesizer": 0.0,
        "monitor": 0.0,
        "visualiser": 0.0
    }
    conversation_count = 0
    conversations_with_cost = []

    # Track daily spending by mode
    daily_by_mode: Dict[str, Dict[str, float]] = {}  # date -> {mode -> cost}
    daily_count: Dict[str, int] = {}  # date -> conversation count

    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            try:
                path = os.path.join(DATA_DIR, filename)
                with open(path, 'r') as f:
                    data = json.load(f)

                conversation_count += 1
                cost = data.get("total_cost", 0.0)
                mode = data.get("mode", "council")
                created_at = data.get("created_at", "")

                total_spent += cost
                if mode in by_mode:
                    by_mode[mode] += cost

                # Track daily spending
                if created_at and cost > 0:
                    # Extract date from ISO timestamp
                    date_str = created_at[:10]  # "2024-12-01T..." -> "2024-12-01"
                    if date_str not in daily_by_mode:
                        daily_by_mode[date_str] = {
                            "council": 0.0,
                            "synthesizer": 0.0,
                            "monitor": 0.0,
                            "visualiser": 0.0
                        }
                        daily_count[date_str] = 0
                    if mode in daily_by_mode[date_str]:
                        daily_by_mode[date_str][mode] += cost
                    daily_count[date_str] += 1

                if cost > 0:
                    conversations_with_cost.append({
                        "id": data["id"],
                        "title": data.get("title", "Untitled"),
                        "mode": mode,
                        "cost": cost,
                        "created_at": data.get("created_at")
                    })
            except (json.JSONDecodeError, IOError, KeyError):
                # Skip malformed files
                continue

    # Sort by cost descending and take top 5
    top_conversations = sorted(
        conversations_with_cost,
        key=lambda x: x["cost"],
        reverse=True
    )[:5]

    # Build daily_spending array for last 30 days
    daily_spending = []
    today = datetime.utcnow().date()
    for i in range(29, -1, -1):  # 29 days ago to today
        date = today - timedelta(days=i)
        date_str = date.isoformat()
        mode_costs = daily_by_mode.get(date_str, {
            "council": 0.0,
            "synthesizer": 0.0,
            "monitor": 0.0,
            "visualiser": 0.0
        })
        total_day = sum(mode_costs.values())
        daily_spending.append({
            "date": date_str,
            "total": round(total_day, 4),
            "by_mode": {k: round(v, 4) for k, v in mode_costs.items()},
            "count": daily_count.get(date_str, 0)
        })

    return {
        "total_spent": round(total_spent, 4),
        "by_mode": {k: round(v, 4) for k, v in by_mode.items()},
        "conversation_count": conversation_count,
        "top_conversations": top_conversations,
        "daily_spending": daily_spending
    }


def link_visualisation(source_conv_id: str, visualiser_conv_id: str, title: str) -> bool:
    """
    Add a visualisation link to the source conversation.

    Args:
        source_conv_id: ID of the source conversation (synthesizer/council)
        visualiser_conv_id: ID of the visualiser conversation
        title: Title of the visualisation

    Returns:
        True if link was added, False if source conversation not found
    """
    conv = get_conversation(source_conv_id)
    if not conv:
        return False

    # Initialize if missing (backwards compatibility)
    if "linked_visualisations" not in conv:
        conv["linked_visualisations"] = []

    # Avoid duplicates
    existing_ids = [v["id"] for v in conv["linked_visualisations"]]
    if visualiser_conv_id not in existing_ids:
        conv["linked_visualisations"].append({
            "id": visualiser_conv_id,
            "title": title,
            "created_at": datetime.utcnow().isoformat()
        })
        save_conversation(conv)

    return True


def migrate_visualisation_links() -> int:
    """
    Scan existing visualiser conversations and create links
    in their source conversations. Returns count of links created.
    """
    count = 0
    data_path = Path(DATA_DIR)

    for conv_path in data_path.glob("*.json"):
        try:
            with open(conv_path, 'r') as f:
                conv = json.load(f)

            # Only process visualiser conversations
            if conv.get("mode") != "visualiser":
                continue

            # Find source_id from user message
            for msg in conv.get("messages", []):
                if msg.get("role") == "user" and msg.get("source_type") == "conversation":
                    source_id = msg.get("source_id")
                    if source_id:
                        title = conv.get("title", "Diagram")
                        if link_visualisation(source_id, conv["id"], title):
                            count += 1
                    break
        except (json.JSONDecodeError, IOError) as e:
            print(f"Error processing {conv_path}: {e}")
            continue

    return count
