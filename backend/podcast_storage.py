"""JSON-based storage for podcast sessions with folder-per-podcast structure."""

import json
import os
import shutil
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path

# Podcast sessions stored in data/podcasts/{session_id}/
PODCAST_DIR = Path(os.getenv("PODCAST_DIR", "data/podcasts"))


def ensure_podcast_dir():
    """Ensure the podcast directory exists."""
    PODCAST_DIR.mkdir(parents=True, exist_ok=True)


def get_session_dir(session_id: str) -> Path:
    """Get the directory path for a podcast session."""
    return PODCAST_DIR / session_id


def get_session_file(session_id: str) -> Path:
    """Get the session.json file path for a podcast session."""
    return get_session_dir(session_id) / "session.json"


def get_podcast_audio_path(session_id: str) -> Path:
    """Get the audio file path for a podcast session."""
    return get_session_dir(session_id) / "audio.mp3"


def get_podcast_cover_path(session_id: str) -> Path:
    """Get the cover image path for a podcast session."""
    return get_session_dir(session_id) / "cover.png"


def save_podcast_session(session: Dict[str, Any]) -> None:
    """
    Save a podcast session to disk.

    Creates a folder for the session if it doesn't exist.

    Args:
        session: The session data to save
    """
    ensure_podcast_dir()
    session_dir = get_session_dir(session["id"])
    session_dir.mkdir(parents=True, exist_ok=True)

    session_file = get_session_file(session["id"])
    session_file.write_text(json.dumps(session, indent=2))


def get_podcast_session(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a podcast session by ID.

    Args:
        session_id: The session ID

    Returns:
        The session data or None if not found
    """
    session_file = get_session_file(session_id)
    if not session_file.exists():
        return None
    return json.loads(session_file.read_text())


def get_session_by_prefix(prefix: str) -> Optional[Dict[str, Any]]:
    """
    Find a session by ID prefix (for room name matching).

    LiveKit rooms are named podcast-{id[:8]}, so this allows
    the agent to find the full session from the room name.

    Args:
        prefix: The ID prefix to match

    Returns:
        The matching session or None
    """
    ensure_podcast_dir()
    for entry in PODCAST_DIR.iterdir():
        if entry.is_dir() and entry.name.startswith(prefix):
            session_file = entry / "session.json"
            if session_file.exists():
                return json.loads(session_file.read_text())
    return None


def update_session_transcript(
    session_id: str,
    message: Dict[str, Any]
) -> None:
    """
    Append a message to the session transcript.

    Args:
        session_id: The session ID
        message: The message to append (role, content, timestamp)
    """
    session = get_podcast_session(session_id)
    if session:
        if "transcript" not in session:
            session["transcript"] = []
        session["transcript"].append(message)
        save_podcast_session(session)


def update_session_status(
    session_id: str,
    status: str
) -> None:
    """
    Update the status of a session.

    Args:
        session_id: The session ID
        status: New status (created, active, ended)
    """
    session = get_podcast_session(session_id)
    if session:
        session["status"] = status
        if status == "active" and "started_at" not in session:
            session["started_at"] = datetime.utcnow().isoformat()
        elif status == "ended" and "ended_at" not in session:
            session["ended_at"] = datetime.utcnow().isoformat()
        save_podcast_session(session)


def mark_session_active(session_id: str) -> None:
    """Mark a session as active (started)."""
    update_session_status(session_id, "active")


def mark_session_ended(session_id: str) -> None:
    """Mark a session as ended."""
    update_session_status(session_id, "ended")


def list_podcast_sessions(
    source_conversation_id: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    List podcast sessions, optionally filtered by source conversation.

    Args:
        source_conversation_id: Filter by source synthesizer conversation
        limit: Maximum number of sessions to return

    Returns:
        List of session metadata (excludes full transcript/notes for performance)
    """
    ensure_podcast_dir()
    sessions = []

    for entry in PODCAST_DIR.iterdir():
        if entry.is_dir():
            session_file = entry / "session.json"
            if session_file.exists():
                try:
                    session = json.loads(session_file.read_text())

                    # Filter by source conversation if specified
                    if source_conversation_id is not None:
                        if session.get("source_conversation_id") != source_conversation_id:
                            continue

                    # Check for cover file
                    cover_path = entry / "cover.png"
                    cover_url = f"/api/podcast/sessions/{session['id']}/cover" if cover_path.exists() else session.get("cover_url")

                    # Return metadata only (exclude large fields)
                    sessions.append({
                        "id": session["id"],
                        "room_name": session.get("room_name"),
                        "source_conversation_id": session.get("source_conversation_id"),
                        "status": session.get("status", "created"),
                        "style": session.get("style", "conversational"),
                        "created_at": session.get("created_at"),
                        "started_at": session.get("started_at"),
                        "ended_at": session.get("ended_at"),
                        "note_count": len(session.get("notes", [])),
                        "transcript_length": len(session.get("transcript", [])),
                        "title": session.get("title"),
                        "summary": session.get("summary", ""),
                        "cover_url": cover_url,
                    })
                except (json.JSONDecodeError, KeyError):
                    # Skip malformed files
                    continue

    # Sort by created_at descending (most recent first)
    sessions.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return sessions[:limit]


def delete_podcast_session(session_id: str) -> bool:
    """
    Delete a podcast session and all its files.

    Args:
        session_id: The session ID

    Returns:
        True if deleted, False if not found
    """
    session_dir = get_session_dir(session_id)
    if session_dir.exists() and session_dir.is_dir():
        shutil.rmtree(session_dir)
        return True
    return False


def add_session_reaction(
    session_id: str,
    emoji: str,
    timestamp_ms: int
) -> None:
    """
    Add an emoji reaction to the session.

    Args:
        session_id: The session ID
        emoji: The emoji character
        timestamp_ms: Playback position in milliseconds
    """
    session = get_podcast_session(session_id)
    if session:
        if "reactions" not in session:
            session["reactions"] = []
        session["reactions"].append({
            "emoji": emoji,
            "timestamp_ms": timestamp_ms,
            "created_at": datetime.utcnow().isoformat()
        })
        save_podcast_session(session)


def get_session_reactions(session_id: str) -> List[Dict[str, Any]]:
    """
    Get all reactions for a session.

    Args:
        session_id: The session ID

    Returns:
        List of reactions with emoji, timestamp_ms, and created_at
    """
    session = get_podcast_session(session_id)
    if session:
        return session.get("reactions", [])
    return []


def update_session_audio_path(session_id: str, audio_path: str) -> None:
    """
    Update the audio file path for a session.

    Args:
        session_id: The session ID
        audio_path: Path to the recorded audio file
    """
    session = get_podcast_session(session_id)
    if session:
        session["audio_path"] = audio_path
        save_podcast_session(session)


def update_session_background_completion(session_id: str, background: bool) -> None:
    """
    Mark a session for background completion.

    Args:
        session_id: The session ID
        background: Whether to complete in background
    """
    session = get_podcast_session(session_id)
    if session:
        session["background_completion"] = background
        save_podcast_session(session)


def update_session_word_timings(
    session_id: str,
    word_timings: List[Dict[str, Any]]
) -> None:
    """
    Store word timing data for teleprompter replay.

    Word timings are appended to allow incremental updates during
    live podcast generation. Each timing entry contains:
    - segment_index: Which script segment
    - word_index: Position within segment
    - word: The word text
    - start_ms: Start time in milliseconds
    - end_ms: End time in milliseconds

    Args:
        session_id: The session ID
        word_timings: List of word timing entries to append
    """
    session = get_podcast_session(session_id)
    if session:
        if "word_timings" not in session:
            session["word_timings"] = []
        session["word_timings"].extend(word_timings)
        save_podcast_session(session)


def get_session_word_timings(session_id: str) -> List[Dict[str, Any]]:
    """
    Get all word timings for a session.

    Used for teleprompter sync during replay playback.

    Args:
        session_id: The session ID

    Returns:
        List of word timing entries with segment_index, word_index,
        word, start_ms, and end_ms
    """
    session = get_podcast_session(session_id)
    if session:
        return session.get("word_timings", [])
    return []
