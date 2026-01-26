"""
Qwen3-TTS integration for podcast audio generation.

Supports two modes:
1. Dialogue mode: Entire podcast in ONE API call (best quality, not cancellable)
2. Segment mode: Per-segment generation (cancellable, slightly less natural transitions)
"""

import asyncio
import base64
import io
import logging
import os
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

from .podcast_storage import (
    get_podcast_audio_path as get_audio_path_from_storage,
    is_session_cancelled,
)


class PodcastCancelledException(Exception):
    """Raised when a podcast generation is cancelled."""
    pass

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


async def generate_podcast_audio_cancellable(
    session_id: str,
    dialogue_segments: List[Dict],
    characters: Dict[str, Dict],
    progress_callback: Optional[Callable] = None,
) -> Tuple[bytes, List[Dict], int]:
    """
    Generate podcast audio segment-by-segment with cancellation support.

    This approach trades some naturalness for the ability to cancel mid-generation.
    Checks for cancellation between each segment.

    Args:
        session_id: The session ID (used to check cancellation state)
        dialogue_segments: List of dialogue segments with speaker, text, and emotion
        characters: Character configs keyed by character name
        progress_callback: Optional callback(progress, message, segment_current, segment_total)

    Returns:
        Tuple of (audio_bytes, word_timings, duration_ms)

    Raises:
        PodcastCancelledException: If the session is cancelled
        Exception: If TTS service returns an error
    """
    # Filter out empty segments
    dialogue = [
        seg for seg in dialogue_segments
        if seg.get("text", "").strip()
    ]

    if not dialogue:
        logger.warning("No dialogue segments to synthesize")
        return b"", [], 0

    total_segments = len(dialogue)
    logger.info(f"Generating podcast audio (cancellable): {total_segments} segments")

    # Collect audio chunks and word timings
    audio_chunks = []
    all_word_timings = []
    total_duration_ms = 0

    for idx, seg in enumerate(dialogue):
        # Check for cancellation before each segment
        if is_session_cancelled(session_id):
            logger.info(f"Podcast generation cancelled at segment {idx}/{total_segments}")
            raise PodcastCancelledException(f"Generation cancelled at segment {idx}")

        speaker = seg["speaker"]
        text = seg["text"]
        emotion = seg.get("emotion")

        # Get character config for this speaker
        character = characters.get(speaker)
        if not character:
            # Fallback to first character if speaker not found
            character = list(characters.values())[0] if characters else {
                "voice_mode": "prebuilt",
                "voice": {"prebuilt_voice": "aiden"}
            }

        # Report progress
        if progress_callback:
            progress = idx / total_segments
            progress_callback(progress, f"Generating segment {idx + 1} of {total_segments}", idx + 1, total_segments)

        logger.info(f"Generating segment {idx + 1}/{total_segments}: {speaker} ({len(text)} chars)")

        try:
            # Generate audio for this segment
            audio_bytes, word_timings, duration_ms = await generate_single_audio(
                text=text,
                character=character,
                emotion=emotion,
            )

            if audio_bytes:
                audio_chunks.append(audio_bytes)

                # Adjust word timing offsets for concatenation
                for timing in word_timings:
                    timing["start_ms"] += total_duration_ms
                    timing["end_ms"] += total_duration_ms
                    timing["segment_index"] = idx

                all_word_timings.extend(word_timings)
                total_duration_ms += duration_ms

        except Exception as e:
            logger.error(f"Failed to generate segment {idx}: {e}")
            # Continue with other segments rather than failing completely
            continue

    # Check cancellation one more time before combining
    if is_session_cancelled(session_id):
        logger.info("Podcast generation cancelled during finalization")
        raise PodcastCancelledException("Generation cancelled during finalization")

    # Combine audio chunks
    if not audio_chunks:
        logger.warning("No audio chunks generated")
        return b"", [], 0

    combined_audio = _concatenate_wav_audio(audio_chunks)

    if progress_callback:
        progress_callback(1.0, "Audio generation complete", total_segments, total_segments)

    logger.info(f"Generated {len(combined_audio)} bytes of audio ({total_duration_ms}ms) from {len(audio_chunks)} segments")

    return combined_audio, all_word_timings, total_duration_ms


def _concatenate_wav_audio(audio_chunks: List[bytes]) -> bytes:
    """
    Concatenate multiple WAV audio chunks into a single WAV file.

    Args:
        audio_chunks: List of WAV audio bytes

    Returns:
        Combined WAV audio bytes
    """
    import numpy as np
    import soundfile as sf

    if not audio_chunks:
        return b""

    if len(audio_chunks) == 1:
        return audio_chunks[0]

    # Read all audio chunks into numpy arrays
    audio_arrays = []
    sample_rate = None

    for chunk in audio_chunks:
        try:
            audio_data, sr = sf.read(io.BytesIO(chunk))
            if sample_rate is None:
                sample_rate = sr
            elif sr != sample_rate:
                # Resample if needed (shouldn't happen with same TTS service)
                logger.warning(f"Sample rate mismatch: {sr} vs {sample_rate}")

            audio_arrays.append(audio_data)
        except Exception as e:
            logger.error(f"Failed to read audio chunk: {e}")
            continue

    if not audio_arrays:
        return b""

    # Concatenate arrays
    combined = np.concatenate(audio_arrays)

    # Write to WAV bytes
    output = io.BytesIO()
    sf.write(output, combined, sample_rate, format='WAV')
    output.seek(0)

    return output.read()


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
    max_retries: int = 3,
) -> Tuple[bytes, List[Dict], int]:
    """
    Generate audio for a single speaker/segment.

    Useful for previews or single-speaker podcasts.
    Includes retry logic with exponential backoff for transient failures.

    Args:
        text: Text to synthesize
        character: Character config with voice settings
        emotion: Optional emotion hint
        max_retries: Maximum number of retry attempts (default: 3)

    Returns:
        Tuple of (audio_bytes, word_timings, duration_ms)

    Raises:
        Exception: If all retry attempts fail
    """
    voice_config = _build_voice_config(character)

    last_error = None
    for attempt in range(max_retries):
        try:
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
        except (httpx.TimeoutException, httpx.HTTPStatusError) as e:
            last_error = e
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + 0.5  # 1.5s, 2.5s, 4.5s
                logger.warning(f"TTS attempt {attempt + 1} failed, retrying in {wait_time}s: {e}")
                await asyncio.sleep(wait_time)

    # All retries failed
    raise last_error or Exception("TTS generation failed after retries")


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
