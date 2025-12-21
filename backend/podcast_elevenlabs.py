"""
Direct ElevenLabs API integration for podcast generation.

This module handles TTS generation with word-level timestamps from ElevenLabs,
replacing the LiveKit-based approach for simpler, pre-generated podcast audio.
"""

import asyncio
import base64
import httpx
import io
import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .podcast_storage import get_podcast_audio_path as get_audio_path_from_storage

logger = logging.getLogger(__name__)


async def generate_speech_with_timestamps(
    text: str,
    voice_id: str,
    model: str,
    voice_settings: Dict[str, float],
    api_key: str,
) -> Tuple[bytes, List[Dict[str, Any]]]:
    """
    Generate speech using ElevenLabs API with word-level timestamps.

    Uses the /v1/text-to-speech/{voice_id}/stream/with-timestamps endpoint.

    Args:
        text: Text to convert to speech
        voice_id: ElevenLabs voice ID
        model: ElevenLabs model ID (e.g., eleven_turbo_v2_5)
        voice_settings: Dict with stability, similarity_boost, style, speed
        api_key: ElevenLabs API key

    Returns:
        Tuple of (audio_bytes, word_timings)
        word_timings format: [{"word": "Hello", "start_ms": 0, "end_ms": 450}, ...]
    """
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream/with-timestamps"

    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
    }

    payload = {
        "text": text,
        "model_id": model,
        "voice_settings": {
            "stability": voice_settings.get("stability", 0.5),
            "similarity_boost": voice_settings.get("similarity_boost", 0.75),
            "style": voice_settings.get("style", 0.0),
            "use_speaker_boost": True,
        },
        "output_format": "mp3_44100_128",
    }

    audio_chunks = []
    all_alignments = []

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            if response.status_code != 200:
                error_text = await response.aread()
                error_decoded = error_text.decode("utf-8", errors="replace")
                logger.error(f"ElevenLabs API error: {response.status_code} - {error_decoded}")
                logger.error(f"Request payload: voice_id={voice_id}, model={model}, text_length={len(text)}")
                raise Exception(f"ElevenLabs API error: {response.status_code} - {error_decoded}")

            # Stream response is newline-delimited JSON
            buffer = b""
            async for chunk in response.aiter_bytes():
                buffer += chunk

                # Process complete JSON objects (newline-delimited)
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.strip():
                        continue

                    try:
                        import json
                        data = json.loads(line.decode("utf-8"))

                        # Extract audio
                        if "audio_base64" in data and data["audio_base64"]:
                            audio_bytes = base64.b64decode(data["audio_base64"])
                            audio_chunks.append(audio_bytes)

                        # Extract alignment data
                        if "alignment" in data and data["alignment"]:
                            all_alignments.append(data["alignment"])

                    except json.JSONDecodeError as e:
                        logger.warning(f"Failed to parse JSON chunk: {e}")
                        continue

    # Combine audio chunks
    combined_audio = b"".join(audio_chunks)

    # Convert character alignments to word timings
    word_timings = _alignments_to_word_timings(all_alignments, text)

    logger.info(f"Generated {len(combined_audio)} bytes of audio with {len(word_timings)} word timings")

    return combined_audio, word_timings


def _alignments_to_word_timings(
    alignments: List[Dict[str, Any]],
    original_text: str
) -> List[Dict[str, Any]]:
    """
    Convert ElevenLabs character alignments to word-level timings.

    ElevenLabs returns character-level timing:
    {
        "characters": ["H", "e", "l", "l", "o"],
        "character_start_times_seconds": [0.0, 0.1, 0.2, 0.3, 0.4],
        "character_end_times_seconds": [0.1, 0.2, 0.3, 0.4, 0.5]
    }

    We convert this to word-level:
    [{"word": "Hello", "start_ms": 0, "end_ms": 500}]
    """
    if not alignments:
        return []

    # Flatten all alignment chunks into character arrays
    all_chars = []
    all_starts = []
    all_ends = []

    for alignment in alignments:
        chars = alignment.get("characters", [])
        starts = alignment.get("character_start_times_seconds", [])
        ends = alignment.get("character_end_times_seconds", [])

        # Ensure arrays are same length
        min_len = min(len(chars), len(starts), len(ends))
        all_chars.extend(chars[:min_len])
        all_starts.extend(starts[:min_len])
        all_ends.extend(ends[:min_len])

    if not all_chars:
        return []

    # Group characters into words
    word_timings = []
    current_word = ""
    word_start = None
    word_end = None

    for i, char in enumerate(all_chars):
        if char in (" ", "\n", "\t"):
            # End of word
            if current_word:
                word_timings.append({
                    "word": current_word,
                    "start_ms": int(word_start * 1000) if word_start else 0,
                    "end_ms": int(word_end * 1000) if word_end else 0,
                })
                current_word = ""
                word_start = None
                word_end = None
        else:
            # Continue building word
            if word_start is None:
                word_start = all_starts[i] if i < len(all_starts) else 0
            word_end = all_ends[i] if i < len(all_ends) else word_start
            current_word += char

    # Don't forget the last word
    if current_word:
        word_timings.append({
            "word": current_word,
            "start_ms": int(word_start * 1000) if word_start else 0,
            "end_ms": int(word_end * 1000) if word_end else 0,
        })

    return word_timings


async def generate_dialogue_audio(
    dialogue_segments: List[Dict[str, Any]],
    host_voice_config: Dict[str, Any],
    expert_voice_config: Dict[str, Any],
    api_key: str,
    progress_callback: Optional[Callable[[float, int, int], None]] = None,
) -> Tuple[bytes, List[Dict[str, Any]], int]:
    """
    Generate audio for a two-speaker dialogue.

    Args:
        dialogue_segments: List of {"speaker": "host"|"expert", "text": "..."}
        host_voice_config: Voice config for host (voice_id, model, voice_settings)
        expert_voice_config: Voice config for expert (voice_id, model, voice_settings)
        api_key: ElevenLabs API key
        progress_callback: Optional callback(progress, current_segment, total_segments)

    Returns:
        Tuple of (combined_audio_bytes, word_timings_with_metadata, total_duration_ms)
    """
    all_audio_chunks = []
    all_word_timings = []
    cumulative_offset_ms = 0
    total_segments = len(dialogue_segments)

    for segment_index, segment in enumerate(dialogue_segments):
        speaker = segment.get("speaker", "host")
        text = segment.get("text", "")

        if not text.strip():
            continue

        # Select voice config based on speaker
        voice_config = host_voice_config if speaker == "host" else expert_voice_config

        logger.info(f"Generating segment {segment_index + 1}/{total_segments} for {speaker}: {text[:50]}...")

        try:
            audio_bytes, word_timings = await generate_speech_with_timestamps(
                text=text,
                voice_id=voice_config["voice_id"],
                model=voice_config["model"],
                voice_settings=voice_config["voice_settings"],
                api_key=api_key,
            )

            # Add metadata to word timings
            for timing in word_timings:
                timing["segment_index"] = segment_index
                timing["speaker"] = speaker
                timing["start_ms"] += cumulative_offset_ms
                timing["end_ms"] += cumulative_offset_ms

            all_audio_chunks.append(audio_bytes)
            all_word_timings.extend(word_timings)

            # Calculate segment duration from last word timing
            if word_timings:
                segment_duration = word_timings[-1]["end_ms"] - cumulative_offset_ms
                cumulative_offset_ms = word_timings[-1]["end_ms"]
            else:
                # Estimate duration if no timings (shouldn't happen)
                segment_duration = len(text.split()) * 400  # ~150 WPM
                cumulative_offset_ms += segment_duration

            # Report progress
            if progress_callback:
                progress = (segment_index + 1) / total_segments
                progress_callback(progress, segment_index + 1, total_segments)

        except Exception as e:
            logger.error(f"Failed to generate segment {segment_index}: {e}")
            raise

        # Small delay between API calls to avoid rate limiting
        await asyncio.sleep(0.1)

    # Combine all audio chunks
    combined_audio = b"".join(all_audio_chunks)

    return combined_audio, all_word_timings, cumulative_offset_ms


def save_podcast_audio(session_id: str, audio_bytes: bytes) -> str:
    """
    Save podcast audio to disk in the session's folder.

    Args:
        session_id: The podcast session ID
        audio_bytes: The raw MP3 audio bytes

    Returns:
        Path to the saved audio file (relative path)
    """
    audio_path = get_audio_path_from_storage(session_id)
    # Ensure parent directory exists (session folder)
    audio_path.parent.mkdir(parents=True, exist_ok=True)
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
