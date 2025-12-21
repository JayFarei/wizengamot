"""Podcast mode: Generate audio explanations of Synthesizer notes with two speakers."""

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from .storage import get_conversation
from .podcast_storage import (
    save_podcast_session,
    get_podcast_session,
    get_podcast_cover_path,
)
from .podcast_elevenlabs import (
    generate_dialogue_audio,
    save_podcast_audio,
    get_podcast_audio_path,
)
from .settings import (
    get_podcast_cover_prompt,
    get_podcast_cover_model,
    get_host_voice_config,
    get_expert_voice_config,
    get_elevenlabs_api_key,
    get_synthesizer_model,
)
from .visualiser import generate_diagram
from .openrouter import query_model

logger = logging.getLogger(__name__)


async def generate_podcast_metadata(
    notes: List[Dict[str, Any]],
    style: str = "conversational"
) -> Dict[str, str]:
    """
    Generate an engaging title and summary for a podcast episode using LLM.

    Args:
        notes: List of notes to base the metadata on
        style: Narration style for context

    Returns:
        {
            "title": str,  # Engaging episode title (max 60 chars)
            "summary": str  # Compelling 2-3 sentence description
        }
    """
    # Build notes context
    notes_text = "\n\n".join([
        f"**{note.get('title', 'Untitled')}**\n{note.get('body', '')[:500]}"
        for note in notes[:5]  # Limit to first 5 notes
    ])

    style_context = {
        "rest-is-politics": "witty British political commentary",
        "all-in": "Silicon Valley tech and business analysis",
        "rest-is-history": "engaging historical storytelling",
        "conversational": "friendly conversational",
        "educational": "educational lecture",
        "storytelling": "narrative storytelling",
    }.get(style, "conversational")

    prompt = f"""Generate a podcast episode title and summary based on these notes.

Style: {style_context}

Notes content:
{notes_text}

Requirements:
1. Title: Create a catchy, engaging episode title (max 60 characters). Make it intriguing and clickable, like a popular podcast episode name.
2. Summary: Write a compelling 2-3 sentence description that hooks listeners and explains what they'll learn.

Respond in this exact JSON format (no markdown, just raw JSON):
{{"title": "Your Episode Title Here", "summary": "Your compelling summary here that makes people want to listen."}}"""

    messages = [{"role": "user", "content": prompt}]

    try:
        # Use the configured synthesizer model for metadata generation
        model = get_synthesizer_model()
        result = await query_model(
            model=model,
            messages=messages,
            timeout=30.0
        )

        if result and result.get("content"):
            import json
            content = result["content"].strip()
            # Handle potential markdown code blocks
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            metadata = json.loads(content)
            return {
                "title": metadata.get("title", "Podcast Episode")[:60],
                "summary": metadata.get("summary", "")
            }
    except Exception as e:
        logger.error(f"Failed to generate podcast metadata: {e}")

    # Fallback to simple extraction
    fallback_title = notes[0].get("title", "Podcast Episode") if notes else "Podcast Episode"
    return {
        "title": fallback_title[:60],
        "summary": ""
    }


async def update_session_metadata(session_id: str) -> Dict[str, Any]:
    """
    Generate and update metadata (title, summary) for a podcast session.

    Args:
        session_id: The session ID to update

    Returns:
        Updated metadata or error dict
    """
    session = get_podcast_session(session_id)
    if not session:
        return {"error": "Session not found"}

    notes = session.get("notes", [])
    style = session.get("style", "conversational")

    if not notes:
        return {"error": "No notes in session"}

    logger.info(f"Generating metadata for session {session_id}")

    metadata = await generate_podcast_metadata(notes, style)

    # Update session with generated metadata
    session["title"] = metadata["title"]
    session["summary"] = metadata["summary"]
    save_podcast_session(session)

    logger.info(f"Updated session {session_id} with title: {metadata['title']}")

    return {
        "title": metadata["title"],
        "summary": metadata["summary"],
        "error": None
    }


def create_podcast_session(
    conversation_id: str,
    note_ids: Optional[List[str]] = None,
    style: str = "conversational"
) -> Dict[str, Any]:
    """
    Create a new podcast session from Synthesizer notes.

    Args:
        conversation_id: The synthesizer conversation containing notes
        note_ids: Specific note IDs to include (None = all notes)
        style: Narration style (conversational, educational, storytelling)

    Returns:
        Session metadata

    Raises:
        ValueError: If source conversation not found or has no notes
    """
    # Verify source conversation exists and has notes
    conversation = get_conversation(conversation_id)
    if not conversation:
        raise ValueError("Source conversation not found")

    if conversation.get("mode") != "synthesizer":
        raise ValueError("Source conversation must be a synthesizer conversation")

    # Extract notes from the conversation
    notes = extract_notes_from_conversation(conversation, note_ids)
    if not notes:
        raise ValueError("No notes found in conversation")

    # Generate a title from the first note or conversation title
    title = None
    if notes:
        title = notes[0].get("title", "Untitled")
    if not title and conversation.get("title"):
        title = conversation["title"]
    if not title:
        title = "Podcast Episode"

    # Create session
    session_id = str(uuid.uuid4())

    session = {
        "id": session_id,
        "source_conversation_id": conversation_id,
        "notes": notes,
        "style": style,
        "title": title,
        "summary": "",  # Will be populated by background LLM generation
        "status": "created",
        "created_at": datetime.utcnow().isoformat(),
        # Audio generation fields
        "audio_path": None,
        "audio_duration_ms": None,
        "word_timings": [],
        "dialogue_segments": [],
        "generation_progress": 0,
    }

    # Save the session
    save_podcast_session(session)

    return {
        "session_id": session_id,
        "status": "created",
        "title": title,
        "note_count": len(notes),
    }


def extract_notes_from_conversation(
    conversation: Dict[str, Any],
    note_ids: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    Extract notes from a synthesizer conversation.

    Args:
        conversation: The full conversation object
        note_ids: Optional list of specific note IDs to include

    Returns:
        List of note objects with id, title, body, tags
    """
    all_notes = []

    for msg in conversation.get("messages", []):
        if msg.get("role") == "assistant":
            # Notes can be stored in different formats depending on synthesizer mode
            if msg.get("notes"):
                all_notes.extend(msg["notes"])
            elif msg.get("content") and isinstance(msg.get("content"), dict):
                # Handle structured content format
                if "notes" in msg["content"]:
                    all_notes.extend(msg["content"]["notes"])

    # Filter by note_ids if specified
    if note_ids:
        all_notes = [n for n in all_notes if n.get("id") in note_ids]

    return all_notes


async def generate_dialogue_script(
    notes: List[Dict[str, Any]],
    style: str = "conversational",
    host_prompt: str = "",
    expert_prompt: str = "",
) -> List[Dict[str, str]]:
    """
    Generate a two-speaker dialogue script from notes using LLM.

    Args:
        notes: List of notes to discuss
        style: Conversation style
        host_prompt: System prompt for host personality
        expert_prompt: System prompt for expert personality

    Returns:
        List of dialogue segments: [{"speaker": "host"|"expert", "text": "..."}]
    """
    # Build notes text
    notes_text = "\n\n---\n\n".join([
        f"## {note.get('title', 'Untitled')}\n"
        f"Tags: {', '.join(note.get('tags', []))}\n\n"
        f"{note.get('body', '')}"
        for note in notes
    ])

    style_context = {
        "rest-is-politics": "witty British political commentary with dry humor",
        "all-in": "Silicon Valley tech analysis, direct and opinionated",
        "rest-is-history": "engaging historical storytelling with narrative tension",
        "conversational": "friendly, casual conversation",
        "educational": "structured educational discussion",
        "storytelling": "narrative-driven exploration",
    }.get(style, "engaging conversation")

    prompt = f"""Generate a podcast dialogue between a HOST and an EXPERT discussing these research notes.

## Source Material
{notes_text}

## Style
{style_context}

## Host Personality
{host_prompt or "Curious, engaging interviewer who asks thoughtful questions"}

## Expert Personality
{expert_prompt or "Knowledgeable explainer who shares insights accessibly"}

## Requirements
1. Create a natural back-and-forth conversation (15-25 exchanges total)
2. HOST introduces the topic and asks questions
3. EXPERT explains concepts, shares insights, uses examples
4. Include natural reactions ("That's fascinating!", "Exactly!", "Great point!")
5. Cover all the key points from the notes
6. End with a memorable takeaway

## Output Format
Return ONLY a JSON array with no markdown, no explanation:
[
  {{"speaker": "host", "text": "Welcome to the podcast! Today we're diving into..."}},
  {{"speaker": "expert", "text": "Thanks for having me! This topic is really fascinating because..."}},
  ...
]"""

    messages = [{"role": "user", "content": prompt}]

    try:
        # Use the configured synthesizer model for dialogue generation
        model = get_synthesizer_model()
        result = await query_model(
            model=model,
            messages=messages,
            timeout=120.0
        )

        if result and result.get("content"):
            content = result["content"].strip()
            # Handle potential markdown code blocks
            if content.startswith("```"):
                lines = content.split("\n")
                # Remove first and last lines (```json and ```)
                content = "\n".join(lines[1:-1])

            dialogue = json.loads(content)

            # Validate structure
            if isinstance(dialogue, list) and len(dialogue) > 0:
                validated = []
                for segment in dialogue:
                    if isinstance(segment, dict) and "speaker" in segment and "text" in segment:
                        validated.append({
                            "speaker": segment["speaker"].lower(),
                            "text": segment["text"]
                        })
                if validated:
                    logger.info(f"Generated dialogue with {len(validated)} segments")
                    return validated

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse dialogue JSON: {e}")
    except Exception as e:
        logger.error(f"Failed to generate dialogue: {e}")

    # Fallback to simple dialogue
    logger.warning("Using fallback dialogue generation")
    fallback = [
        {"speaker": "host", "text": f"Welcome to the podcast! Today we're exploring some fascinating topics."},
    ]

    for note in notes:
        title = note.get("title", "this topic")
        body = note.get("body", "")[:500]
        fallback.append({"speaker": "host", "text": f"Let's talk about {title}. What can you tell us?"})
        fallback.append({"speaker": "expert", "text": f"Great question! {body}"})

    fallback.append({"speaker": "host", "text": "That's all we have time for today. Thanks for listening!"})
    fallback.append({"speaker": "expert", "text": "Thanks for having me! Great conversation."})

    return fallback


async def generate_podcast_audio(
    session_id: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """
    Generate audio for a podcast session.

    This is the main entry point for audio generation:
    1. Generate dialogue script using LLM
    2. Generate audio for each segment using ElevenLabs
    3. Save audio and word timings to session

    Args:
        session_id: The podcast session ID
        progress_callback: Optional callback(progress_0_to_1, status_message)

    Returns:
        Dict with audio_path, duration_ms, word_timings, or error
    """
    logger.info(f"[PODCAST] Starting audio generation for session {session_id}")

    session = get_podcast_session(session_id)
    if not session:
        logger.error(f"[PODCAST] Session {session_id} not found")
        return {"error": "Session not found"}

    # Check ElevenLabs is configured
    api_key = get_elevenlabs_api_key()
    if not api_key:
        return {"error": "ElevenLabs API key not configured"}

    # Update status immediately so user sees feedback
    session["status"] = "generating"
    session["generation_step"] = "starting"
    session["generation_progress"] = 0.01
    session["generation_message"] = "Starting podcast generation..."
    save_podcast_session(session)
    logger.info(f"[PODCAST] Session {session_id} status set to generating")

    try:
        # Get voice configurations
        host_config = get_host_voice_config()
        expert_config = get_expert_voice_config()

        # Phase 1: Generate dialogue script (10% of progress)
        session["generation_step"] = "writing_script"
        session["generation_progress"] = 0.02
        session["generation_message"] = "Writing dialogue script with AI..."
        save_podcast_session(session)

        if progress_callback:
            progress_callback(0.05, "Generating dialogue script...")

        logger.info(f"[PODCAST] Generating dialogue for session {session_id}")

        dialogue_segments = await generate_dialogue_script(
            notes=session.get("notes", []),
            style=session.get("style", "conversational"),
            host_prompt=host_config.get("system_prompt", ""),
            expert_prompt=expert_config.get("system_prompt", ""),
        )

        session["dialogue_segments"] = dialogue_segments
        session["generation_step"] = "generating_audio"
        session["generation_progress"] = 0.1
        session["generation_message"] = f"Script ready! Generating audio for {len(dialogue_segments)} segments..."
        session["audio_total_segments"] = len(dialogue_segments)
        session["audio_current_segment"] = 0
        save_podcast_session(session)
        logger.info(f"[PODCAST] Dialogue ready with {len(dialogue_segments)} segments")

        if progress_callback:
            progress_callback(0.1, f"Script ready. Generating audio for {len(dialogue_segments)} segments...")

        # Phase 2: Generate audio (10% to 95% of progress)
        def audio_progress(progress: float, current: int, total: int):
            # Map 0-1 audio progress to 0.1-0.95 overall progress
            overall = 0.1 + (progress * 0.85)
            session["generation_progress"] = overall
            session["generation_message"] = f"Generating audio: segment {current} of {total}"
            session["audio_current_segment"] = current
            save_podcast_session(session)
            if progress_callback:
                progress_callback(overall, f"Generating audio: {current}/{total} segments")

        logger.info(f"Generating audio for {len(dialogue_segments)} segments")

        audio_bytes, word_timings, duration_ms = await generate_dialogue_audio(
            dialogue_segments=dialogue_segments,
            host_voice_config=host_config,
            expert_voice_config=expert_config,
            api_key=api_key,
            progress_callback=audio_progress,
        )

        # Phase 3: Save audio file (95% to 100%)
        session["generation_step"] = "finalizing"
        session["generation_progress"] = 0.95
        session["generation_message"] = "Saving audio file..."
        save_podcast_session(session)

        if progress_callback:
            progress_callback(0.95, "Saving audio file...")

        audio_path = save_podcast_audio(session_id, audio_bytes)

        # Update session with results
        session["audio_path"] = audio_path
        session["audio_duration_ms"] = duration_ms
        session["word_timings"] = word_timings
        session["status"] = "ready"
        session["generation_step"] = "complete"
        session["generation_progress"] = 1.0
        session["generation_message"] = "Complete!"
        save_podcast_session(session)

        if progress_callback:
            progress_callback(1.0, "Complete!")

        logger.info(f"[PODCAST] Audio generated: {audio_path} ({duration_ms}ms)")

        return {
            "audio_path": audio_path,
            "duration_ms": duration_ms,
            "word_timings": word_timings,
            "dialogue_segments": dialogue_segments,
            "error": None,
        }

    except Exception as e:
        logger.exception(f"Failed to generate podcast audio: {e}")
        session["status"] = "error"
        session["error"] = str(e)
        save_podcast_session(session)
        return {"error": str(e)}


async def generate_podcast_cover(session_id: str) -> Dict[str, Any]:
    """
    Generate cover art for a podcast session.

    Uses the configured podcast cover model (separate from visualiser).
    Saves the cover image directly to the podcast session folder.

    Args:
        session_id: The podcast session ID

    Returns:
        {
            "cover_url": str or None,
            "error": str or None
        }
    """
    from pathlib import Path

    session = get_podcast_session(session_id)
    if not session:
        return {"error": "Session not found"}

    # Build content summary from notes for cover generation
    notes = session.get("notes", [])
    title = session.get("title", "Podcast")
    summary = session.get("summary", "")

    content_parts = [f"Title: {title}"]

    # Include the LLM-generated summary if available (better context for cover)
    if summary:
        content_parts.append(f"Episode Summary: {summary}")

    # Add note topics for additional context
    for note in notes[:3]:  # Use first 3 notes for context
        note_title = note.get("title", "")
        if note_title:
            content_parts.append(f"Topic: {note_title}")

    content = "\n".join(content_parts)

    logger.info(f"Generating cover art for session {session_id}")
    logger.debug(f"Cover content: {content[:200]}...")

    # Get cover prompt and model from settings
    cover_prompt = get_podcast_cover_prompt()
    cover_model = get_podcast_cover_model()

    # Generate using visualiser with podcast-specific model
    try:
        result = await generate_diagram(
            content=content,
            style="podcast_cover",
            model=cover_model,
            custom_prompt=cover_prompt
        )
        logger.debug(f"generate_diagram result: {result}")
    except Exception as e:
        logger.exception(f"generate_diagram raised exception: {e}")
        return {"error": str(e)}

    if result.get("error"):
        logger.error(f"Cover generation failed: {result['error']}")
        return {"error": result["error"]}

    # Copy the generated image to the podcast folder
    image_id = result.get("image_id")
    image_path = result.get("image_path")

    if image_id and image_path:
        try:
            # Read from shared images location
            source_path = Path(image_path)
            if not source_path.exists():
                source_path = Path("data/images") / f"{image_id}.png"

            if source_path.exists():
                # Copy to podcast folder
                cover_path = get_podcast_cover_path(session_id)
                cover_path.parent.mkdir(parents=True, exist_ok=True)
                cover_path.write_bytes(source_path.read_bytes())

                # Clean up from shared images (optional, keeps things tidy)
                try:
                    source_path.unlink()
                except Exception:
                    pass  # Not critical if cleanup fails

                # Build the podcast-specific cover URL
                cover_url = f"/api/podcast/sessions/{session_id}/cover"

                # Update session with cover
                session["cover_url"] = cover_url
                save_podcast_session(session)

                logger.info(f"Generated cover art: {cover_url}")
                return {
                    "cover_url": cover_url,
                    "error": None
                }
            else:
                logger.error(f"Generated image not found at {source_path}")
                return {"error": "Generated image file not found"}

        except Exception as e:
            logger.exception(f"Failed to save cover to podcast folder: {e}")
            return {"error": str(e)}

    # Log the full result for debugging when no image was generated
    logger.error(f"No image generated. Result keys: {list(result.keys())}. "
                 f"image_id={result.get('image_id')}, image_path={result.get('image_path')}, "
                 f"model={result.get('model')}")

    # Include model response in error if available (helps debug model format issues)
    model_response = result.get("raw_response") or result.get("content")
    if model_response:
        # Truncate for logging
        preview = str(model_response)[:500]
        logger.error(f"Model response preview: {preview}")
        return {"error": f"No image generated. Model response: {preview}..."}

    return {"error": "No image generated - model returned no image_id or image_path"}
