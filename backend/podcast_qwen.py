"""
Qwen3-TTS integration for podcast audio generation.
Replaces ElevenLabs with self-hosted Qwen3-TTS service.

Key improvement: Entire podcast audio is generated in ONE API call
via the /synthesize-dialogue endpoint, enabling natural speaker transitions.
"""

import base64
import logging
import os
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

from .podcast_storage import get_podcast_audio_path as get_audio_path_from_storage

logger = logging.getLogger(__name__)

# Qwen3-TTS service URL
QWEN_TTS_URL = os.getenv("QWEN_TTS_URL", "http://localhost:7860")


async def generate_podcast_audio(
    dialogue_segments: List[Dict],
    characters: Dict[str, Dict],
    progress_callback: Optional[Callable] = None,
) -> Tuple[bytes, List[Dict], int]:
    """
    Generate entire podcast audio in ONE call using multi-speaker dialogue synthesis.

    This is a major improvement over segment-by-segment approaches:
    - Single API call for entire podcast
    - Natural speaker transitions
    - Consistent prosody across conversation

    Args:
        dialogue_segments: List of dialogue segments with speaker, text, and emotion
            [{"speaker": "Sarah", "text": "Welcome!", "emotion": "enthusiastic"}, ...]
        characters: Character configs keyed by character name
            {"Sarah": {"name": "Sarah", "voice_mode": "prebuilt", "voice": {...}}, ...}
        progress_callback: Optional callback for progress updates

    Returns:
        Tuple of (audio_bytes, word_timings, duration_ms)

    Raises:
        Exception: If TTS service returns an error
    """
    # Build voice configs for each speaker
    speakers = {}
    for char_name, char in characters.items():
        speakers[char_name] = _build_voice_config(char)

    # Build dialogue with emotions
    dialogue = [
        {
            "speaker": seg["speaker"],
            "text": seg["text"],
            "emotion": seg.get("emotion"),
        }
        for seg in dialogue_segments
        if seg.get("text", "").strip()  # Skip empty segments
    ]

    if not dialogue:
        logger.warning("No dialogue segments to synthesize")
        return b"", [], 0

    logger.info(f"Generating podcast audio: {len(dialogue)} segments, {len(speakers)} speakers")

    if progress_callback:
        progress_callback(0.1, "Sending to TTS service...")

    # Use longer timeout for podcast generation - can take 10+ minutes for longer episodes
    # with many dialogue segments (each segment requires model inference + whisper alignment)
    timeout = httpx.Timeout(connect=30.0, read=1800.0, write=30.0, pool=30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(
                f"{QWEN_TTS_URL}/synthesize-dialogue",
                json={"speakers": speakers, "dialogue": dialogue}
            )
            response.raise_for_status()

            if progress_callback:
                progress_callback(0.9, "Processing audio response...")

            data = response.json()

            # Decode base64 audio
            audio_base64 = data.get("audio_base64", "")
            audio_bytes = base64.b64decode(audio_base64) if audio_base64 else b""

            word_timings = data.get("word_timings", [])
            duration_ms = data.get("duration_ms", 0)

            logger.info(f"Generated {len(audio_bytes)} bytes of audio ({duration_ms}ms)")

            if progress_callback:
                progress_callback(1.0, "Audio generation complete")

            return audio_bytes, word_timings, duration_ms

        except httpx.HTTPStatusError as e:
            error_detail = e.response.text if e.response else str(e)
            logger.error(f"TTS service error: {e.response.status_code} - {error_detail}")
            raise Exception(f"TTS service error: {e.response.status_code} - {error_detail}")
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to TTS service: {e}")
            raise Exception(f"Failed to connect to TTS service at {QWEN_TTS_URL}: {e}")


def _build_voice_config(character: Dict) -> Dict:
    """
    Build voice config for Qwen3-TTS from character data.

    Args:
        character: Character dict with voice_mode and voice fields

    Returns:
        Voice config dict for Qwen3-TTS API
    """
    voice = character.get("voice", {})
    mode = character.get("voice_mode", "prebuilt")

    if mode == "clone":
        return {
            "voice_mode": "clone",
            "voice_id": voice.get("qwen_voice_id")
        }
    elif mode == "design":
        return {
            "voice_mode": "design",
            "voice_id": voice.get("qwen_voice_id"),
            "description": voice.get("description")
        }
    else:  # prebuilt
        return {
            "voice_mode": "prebuilt",
            "voice_id": voice.get("prebuilt_voice", "aiden")
        }


async def generate_single_audio(
    text: str,
    character: Dict,
    emotion: Optional[str] = None,
) -> Tuple[bytes, List[Dict], int]:
    """
    Generate audio for a single speaker/segment.

    Useful for previews or single-speaker podcasts.

    Args:
        text: Text to synthesize
        character: Character config with voice settings
        emotion: Optional emotion hint

    Returns:
        Tuple of (audio_bytes, word_timings, duration_ms)
    """
    voice_config = _build_voice_config(character)

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{QWEN_TTS_URL}/synthesize",
            json={
                "text": text,
                "voice_id": voice_config.get("voice_id", "aiden"),
                "voice_mode": voice_config.get("voice_mode", "prebuilt"),
                "emotion": emotion,
                "speed": 1.0,
            }
        )
        response.raise_for_status()

        data = response.json()

        audio_base64 = data.get("audio_base64", "")
        audio_bytes = base64.b64decode(audio_base64) if audio_base64 else b""

        return (
            audio_bytes,
            data.get("word_timings", []),
            data.get("duration_ms", 0)
        )


def save_podcast_audio(session_id: str, audio_bytes: bytes) -> str:
    """
    Save podcast audio to disk in the session's folder.

    Args:
        session_id: The podcast session ID
        audio_bytes: The raw audio bytes (WAV format from Qwen3-TTS)

    Returns:
        Path to the saved audio file (as string)
    """
    audio_path = get_audio_path_from_storage(session_id)
    # Ensure parent directory exists (session folder)
    audio_path.parent.mkdir(parents=True, exist_ok=True)

    # Qwen3-TTS returns WAV, but we save as MP3 path for compatibility
    # For now, save the WAV bytes directly (frontend can handle both)
    audio_path.write_bytes(audio_bytes)

    logger.info(f"Saved podcast audio to {audio_path} ({len(audio_bytes)} bytes)")

    return str(audio_path)


def get_podcast_audio_path(session_id: str) -> Optional[Path]:
    """
    Get the path to a podcast's audio file.

    Args:
        session_id: The podcast session ID

    Returns:
        Path object if file exists, None otherwise
    """
    audio_path = get_audio_path_from_storage(session_id)
    return audio_path if audio_path.exists() else None


def delete_podcast_audio(session_id: str) -> bool:
    """
    Delete a podcast's audio file.

    Note: With folder-per-podcast structure, audio is deleted
    when the entire session folder is removed.

    Args:
        session_id: The podcast session ID

    Returns:
        True if deleted, False if not found
    """
    audio_path = get_audio_path_from_storage(session_id)
    if audio_path.exists():
        audio_path.unlink()
        logger.info(f"Deleted podcast audio: {audio_path}")
        return True
    return False


async def check_tts_service() -> Dict[str, Any]:
    """
    Check if the Qwen3-TTS service is available.

    Returns:
        Health status dict with 'healthy' bool and 'details'
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{QWEN_TTS_URL}/health")
            if response.status_code == 200:
                data = response.json()
                return {
                    "healthy": True,
                    "details": data,
                }
            return {
                "healthy": False,
                "details": f"Service returned status {response.status_code}",
            }
    except httpx.RequestError as e:
        return {
            "healthy": False,
            "details": str(e),
        }
