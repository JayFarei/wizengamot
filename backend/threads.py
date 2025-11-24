"""Thread management for follow-up conversations with specific models."""

from typing import List, Dict, Any, Optional
from .openrouter import query_model
from .storage import get_conversation, get_comments


def compile_context_from_comments(
    conversation: Dict[str, Any],
    comment_ids: List[str]
) -> str:
    """
    Compile context from comments into a formatted string.

    Args:
        conversation: The conversation dict
        comment_ids: List of comment IDs to include

    Returns:
        Formatted context string
    """
    comments = conversation.get("comments", [])
    relevant_comments = [c for c in comments if c["id"] in comment_ids]

    if not relevant_comments:
        return ""

    context_parts = ["The user has highlighted and commented on specific parts of previous responses:\n"]

    for comment in relevant_comments:
        stage = comment["stage"]
        model = comment["model"]
        selection = comment["selection"]
        content = comment["content"]

        context_parts.append(f"\nStage {stage} response from {model}:")
        context_parts.append(f"Selected text: \"{selection}\"")
        context_parts.append(f"User comment: {content}\n")

    return "\n".join(context_parts)


async def query_with_context(
    model: str,
    question: str,
    conversation: Dict[str, Any],
    comment_ids: List[str],
    system_prompt: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Query a specific model with context from comments.

    Args:
        model: Model identifier to query
        question: The follow-up question
        conversation: The conversation dict
        comment_ids: List of comment IDs to include in context
        system_prompt: Optional system prompt

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    # Compile context from comments
    context = compile_context_from_comments(conversation, comment_ids)

    # Build messages
    messages = []

    # Add system prompt if provided
    if system_prompt:
        messages.append({
            "role": "system",
            "content": system_prompt
        })

    # Add context as a system message if we have comments
    if context:
        messages.append({
            "role": "system",
            "content": context
        })

    # Add the user's question
    messages.append({
        "role": "user",
        "content": question
    })

    # Query the model
    return await query_model(model, messages)


async def continue_thread(
    model: str,
    thread_messages: List[Dict[str, Any]],
    new_question: str,
    system_prompt: Optional[str] = None,
    context: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Continue an existing thread with a new question.

    Args:
        model: Model identifier to query
        thread_messages: Previous messages in the thread
        new_question: The new question to ask
        system_prompt: Optional system prompt
        context: Optional compiled context from comments

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    # Build messages
    messages = []

    # Add system prompt if provided
    if system_prompt:
        messages.append({
            "role": "system",
            "content": system_prompt
        })

    # Add context if provided (only for the first message)
    if context:
        messages.append({
            "role": "system",
            "content": context
        })

    # Add previous thread messages (skip the first message if it's already included as context)
    for msg in thread_messages:
        messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    # Add the new question
    messages.append({
        "role": "user",
        "content": new_question
    })

    # Query the model
    return await query_model(model, messages)
