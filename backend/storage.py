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


def create_conversation(conversation_id: str, council_config: Optional[Dict[str, Any]] = None, system_prompt: Optional[str] = None) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation
        council_config: Optional custom council configuration with:
            - council_models: List of model identifiers to include
            - chairman_model: Model identifier for the chairman
        system_prompt: Optional system prompt to use for this conversation

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "messages": [],
        "comments": [],  # Store inline comments
        "threads": [],  # Store follow-up threads
        "council_config": council_config,  # Store custom config if provided
        "system_prompt": system_prompt  # Store system prompt if provided
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
                conversations.append({
                    "id": data["id"],
                    "created_at": data["created_at"],
                    "title": data.get("title", "New Conversation"),
                    "message_count": len(data["messages"])
                })

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


def add_comment(
    conversation_id: str,
    comment_id: str,
    message_index: int,
    stage: int,
    model: str,
    selection: str,
    content: str,
    source_content: Optional[str] = None
) -> Dict[str, Any]:
    """
    Add a comment to a conversation.

    Args:
        conversation_id: Conversation identifier
        comment_id: Unique identifier for the comment
        message_index: Index of the message being commented on
        stage: Stage number (1, 2, or 3)
        model: Model identifier for the response being commented on
        selection: Highlighted text snippet
        content: Comment content
        source_content: Full content of the response the selection came from

    Returns:
        The created comment
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    comment = {
        "id": comment_id,
        "message_index": message_index,
        "stage": stage,
        "model": model,
        "selection": selection,
        "content": content,
        "source_content": source_content,
        "created_at": datetime.utcnow().isoformat()
    }

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
        context: Context dict with message_index and relevant comment IDs
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
