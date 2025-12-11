"""JSON-based storage for conversations."""

import json
import os
from datetime import datetime
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
        "synthesizer_config": synthesizer_config  # Store synthesizer config if provided
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
                # For visualiser, extract source_type from first user message
                if conv_meta["mode"] == "visualiser":
                    for msg in data.get("messages", []):
                        if msg.get("role") == "user" and msg.get("source_type"):
                            conv_meta["source_type"] = msg["source_type"]
                            break
                # Include status in metadata (with defaults for existing conversations)
                conv_meta["status"] = {
                    "state": data.get("status", {}).get("state", "idle"),
                    "is_unread": data.get("status", {}).get("is_unread", False)
                }
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
    Add a message to an existing thread.

    Args:
        conversation_id: Conversation identifier
        thread_id: Thread identifier
        role: Message role (user or assistant)
        content: Message content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    if "threads" not in conversation:
        raise ValueError(f"No threads found in conversation {conversation_id}")

    thread = next((t for t in conversation["threads"] if t["id"] == thread_id), None)
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
    Get a specific thread.

    Args:
        conversation_id: Conversation identifier
        thread_id: Thread identifier

    Returns:
        Thread dict or None if not found
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return None

    threads = conversation.get("threads", [])
    return next((t for t in threads if t["id"] == thread_id), None)


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
    source_url: str,
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
