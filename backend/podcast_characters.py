"""Voice character management for podcast generation."""

import json
import logging
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
CHARACTERS_DIR = DATA_DIR / "podcast" / "characters"

# Qwen3-TTS service URL
QWEN_TTS_URL = os.getenv("QWEN_TTS_URL", "http://localhost:7860")


def _ensure_characters_dir():
    """Ensure the characters directory exists."""
    CHARACTERS_DIR.mkdir(parents=True, exist_ok=True)


def _get_character_dir(character_id: str) -> Path:
    """Get the directory path for a character."""
    return CHARACTERS_DIR / character_id


def _get_character_file(character_id: str) -> Path:
    """Get the character.json file path."""
    return _get_character_dir(character_id) / "character.json"


def _load_character(character_id: str) -> Optional[Dict[str, Any]]:
    """Load a character from disk."""
    char_file = _get_character_file(character_id)
    if not char_file.exists():
        return None
    try:
        return json.loads(char_file.read_text())
    except (json.JSONDecodeError, IOError):
        return None


def _save_character(character: Dict[str, Any]) -> None:
    """Save a character to disk."""
    char_dir = _get_character_dir(character["id"])
    char_dir.mkdir(parents=True, exist_ok=True)
    char_file = _get_character_file(character["id"])
    char_file.write_text(json.dumps(character, indent=2))


async def list_characters() -> List[Dict[str, Any]]:
    """
    List all podcast characters.

    Returns:
        List of character data sorted by creation date (newest first)
    """
    _ensure_characters_dir()
    characters = []

    for entry in CHARACTERS_DIR.iterdir():
        if entry.is_dir():
            char_file = entry / "character.json"
            if char_file.exists():
                try:
                    char_data = json.loads(char_file.read_text())
                    characters.append(char_data)
                except (json.JSONDecodeError, IOError):
                    continue

    # Sort by created_at descending
    characters.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return characters


async def get_character(character_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a character by ID.

    Args:
        character_id: The character's unique identifier

    Returns:
        Character data or None if not found
    """
    return _load_character(character_id)


async def create_character(
    name: str,
    voice_mode: str,
    voice_config: Dict[str, Any],
    personality: Dict[str, Any],
    audio_file: Optional[bytes] = None,
) -> Dict[str, Any]:
    """
    Create a new podcast character and register voice with Qwen3-TTS.

    Args:
        name: Character display name
        voice_mode: One of "clone", "design", or "prebuilt"
        voice_config: Mode-specific voice configuration
        personality: Character personality settings
        audio_file: Audio file bytes for clone mode

    Returns:
        The created character data

    Raises:
        ValueError: If voice_mode is invalid or required config is missing
    """
    _ensure_characters_dir()

    if voice_mode not in ("clone", "design", "prebuilt"):
        raise ValueError(f"Invalid voice_mode: {voice_mode}")

    character_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    # Build voice section based on mode
    voice = {}

    if voice_mode == "prebuilt":
        prebuilt_voice = voice_config.get("prebuilt_voice")
        if not prebuilt_voice:
            raise ValueError("prebuilt_voice is required for prebuilt mode")
        voice["prebuilt_voice"] = prebuilt_voice

    elif voice_mode == "design":
        description = voice_config.get("description")
        if not description:
            raise ValueError("description is required for design mode")

        # Register voice with Qwen3-TTS
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{QWEN_TTS_URL}/voices/design",
                    json={
                        "description": description,
                        "name": name,
                        "sample_text": voice_config.get(
                            "sample_text",
                            "Hello, this is a sample of my voice."
                        ),
                    }
                )
                response.raise_for_status()
                result = response.json()
                voice["description"] = description
                voice["qwen_voice_id"] = result.get("voice_id")
        except httpx.HTTPError as e:
            # Allow character creation even if TTS service is unavailable
            voice["description"] = description
            voice["qwen_voice_id"] = None
            voice["tts_error"] = str(e)

    elif voice_mode == "clone":
        if not audio_file:
            raise ValueError("audio_file is required for clone mode")
        transcript = voice_config.get("reference_transcript")
        if not transcript:
            raise ValueError("reference_transcript is required for clone mode")

        # Save audio file
        char_dir = _get_character_dir(character_id)
        char_dir.mkdir(parents=True, exist_ok=True)
        audio_path = char_dir / "voice_sample.wav"
        audio_path.write_bytes(audio_file)

        # Register voice with Qwen3-TTS
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                files = {"audio": ("voice_sample.wav", audio_file, "audio/wav")}
                data = {
                    "transcript": transcript,
                    "name": name,
                    "description": voice_config.get("description", ""),
                }
                response = await client.post(
                    f"{QWEN_TTS_URL}/voices/clone",
                    files=files,
                    data=data,
                )
                response.raise_for_status()
                result = response.json()
                voice["reference_audio"] = "voice_sample.wav"
                voice["reference_transcript"] = transcript
                voice["qwen_voice_id"] = result.get("voice_id")
        except httpx.HTTPError as e:
            voice["reference_audio"] = "voice_sample.wav"
            voice["reference_transcript"] = transcript
            voice["qwen_voice_id"] = None
            voice["tts_error"] = str(e)

    # Build character data
    character = {
        "id": character_id,
        "name": name,
        "voice_mode": voice_mode,
        "voice": voice,
        "personality": {
            "traits": personality.get("traits", ""),
            "key_phrases": personality.get("key_phrases", []),
            "expertise_areas": personality.get("expertise_areas", []),
            "speaking_role": personality.get("speaking_role", "host"),
            "emotion_style": personality.get("emotion_style", ""),
        },
        "created_at": now,
        "updated_at": now,
    }

    _save_character(character)
    return character


async def update_character(
    character_id: str,
    updates: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Update character details.

    Args:
        character_id: The character's unique identifier
        updates: Fields to update (name, personality, voice_config)

    Returns:
        Updated character data or None if not found
    """
    character = _load_character(character_id)
    if not character:
        return None

    # Update allowed fields
    if "name" in updates:
        character["name"] = updates["name"]

    if "personality" in updates:
        # Merge personality updates
        personality = character.get("personality", {})
        for key in ["traits", "key_phrases", "expertise_areas", "speaking_role", "emotion_style"]:
            if key in updates["personality"]:
                personality[key] = updates["personality"][key]
        character["personality"] = personality

    # Voice changes require re-registration (handled separately)
    if "voice_config" in updates and character["voice_mode"] == "design":
        new_description = updates["voice_config"].get("description")
        if new_description and new_description != character["voice"].get("description"):
            # Re-register voice with new description
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(
                        f"{QWEN_TTS_URL}/voices/design",
                        json={
                            "description": new_description,
                            "name": character["name"],
                        }
                    )
                    response.raise_for_status()
                    result = response.json()
                    # Delete old voice if it exists
                    old_voice_id = character["voice"].get("qwen_voice_id")
                    if old_voice_id:
                        try:
                            await client.delete(f"{QWEN_TTS_URL}/voices/{old_voice_id}")
                        except httpx.HTTPError:
                            pass
                    character["voice"]["description"] = new_description
                    character["voice"]["qwen_voice_id"] = result.get("voice_id")
                    character["voice"].pop("tts_error", None)
            except httpx.HTTPError as e:
                character["voice"]["description"] = new_description
                character["voice"]["tts_error"] = str(e)

    character["updated_at"] = datetime.utcnow().isoformat()
    _save_character(character)
    return character


async def delete_character(character_id: str) -> bool:
    """
    Delete a character and associated voice from Qwen3-TTS.

    Args:
        character_id: The character's unique identifier

    Returns:
        True if deleted, False if not found
    """
    character = _load_character(character_id)
    if not character:
        return False

    # Delete voice from Qwen3-TTS if it exists
    voice = character.get("voice", {})
    qwen_voice_id = voice.get("qwen_voice_id")
    if qwen_voice_id:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                await client.delete(f"{QWEN_TTS_URL}/voices/{qwen_voice_id}")
        except httpx.HTTPError:
            # Continue with deletion even if TTS cleanup fails
            pass

    # Delete character directory
    char_dir = _get_character_dir(character_id)
    if char_dir.exists():
        shutil.rmtree(char_dir)

    return True


async def preview_character_voice(
    character_id: str,
    text: Optional[str] = None
) -> Optional[bytes]:
    """
    Generate preview audio for a character.

    Args:
        character_id: The character's unique identifier
        text: Optional text to synthesize (uses default if not provided)

    Returns:
        Audio bytes (WAV format) or None if generation fails
    """
    character = _load_character(character_id)
    if not character:
        return None

    preview_text = text or f"Hi, I'm {character['name']}. Nice to meet you!"
    voice = character.get("voice", {})
    voice_mode = character.get("voice_mode", "prebuilt")

    try:
        # Use longer timeout for synthesis (voice cloning can take a while)
        async with httpx.AsyncClient(timeout=180.0) as client:
            # Build synthesis request based on voice mode
            request_data = {
                "text": preview_text,
                "voice_mode": voice_mode,
            }

            # Only add emotion for non-clone modes (clone mode with emotion can hang the model)
            if voice_mode != "clone":
                emotion = character.get("personality", {}).get("emotion_style")
                if emotion:
                    request_data["emotion"] = emotion

            if voice_mode == "prebuilt":
                request_data["voice_id"] = voice.get("prebuilt_voice", "aiden")

            elif voice_mode == "clone":
                # Prefer using voice registry if voice is already registered
                # This is more reliable than passing reference_audio_path directly
                # since the TTS service has already processed and stored the audio
                voice_id = voice.get("qwen_voice_id")
                if voice_id:
                    # Use the registered voice (TTS service has already converted the audio)
                    request_data["voice_id"] = voice_id
                    logger.info(f"Using registered clone voice: {voice_id}")
                else:
                    # No registered voice, pass reference audio path directly
                    char_dir = _get_character_dir(character_id)
                    ref_audio = voice.get("reference_audio")
                    if not ref_audio:
                        return None
                    ref_audio_path = str((char_dir / ref_audio).resolve())
                    request_data["voice_id"] = "clone"
                    request_data["reference_audio_path"] = ref_audio_path
                    request_data["reference_transcript"] = voice.get("reference_transcript", "")

            elif voice_mode == "design":
                # Pass voice description directly if available
                description = voice.get("description")
                if description:
                    request_data["voice_id"] = voice.get("qwen_voice_id", "design")
                    request_data["voice_description"] = description
                else:
                    voice_id = voice.get("qwen_voice_id")
                    if not voice_id:
                        return None
                    request_data["voice_id"] = voice_id

            else:
                return None

            logger.info(f"TTS synthesis request for {character['name']}: {request_data}")
            response = await client.post(
                f"{QWEN_TTS_URL}/synthesize",
                json=request_data
            )
            response.raise_for_status()
            result = response.json()

            # Decode base64 audio
            import base64
            audio_base64 = result.get("audio_base64")
            if audio_base64:
                return base64.b64decode(audio_base64)
            return None

    except httpx.HTTPError as e:
        logger.exception(f"TTS synthesis failed for {character['name']}")
        return None
    except Exception as e:
        logger.exception(f"Unexpected error during TTS synthesis for {character['name']}")
        return None


async def re_register_character_voice(character_id: str) -> Optional[Dict[str, Any]]:
    """
    Re-register a character's voice with the TTS service.

    With local CSM voice cloning, this is now a no-op since voices are
    processed at synthesis time using the stored reference audio.
    The reference audio is already stored locally, so no re-registration
    is needed.

    Args:
        character_id: The character's unique identifier

    Returns:
        Character data or None if not found
    """
    character = _load_character(character_id)
    if not character:
        logger.warning(f"Character {character_id} not found")
        return None

    voice_mode = character.get("voice_mode")
    if voice_mode != "clone":
        logger.info(f"Character {character_id} is not a clone (mode: {voice_mode}), no re-registration needed")
        return character

    # With local CSM, voice cloning uses stored reference audio at synthesis time
    # No re-registration with external service needed
    logger.info(f"Voice for {character['name']} uses local CSM - no re-registration needed")
    return character


async def get_prebuilt_voices() -> List[Dict[str, Any]]:
    """
    Get list of available prebuilt voices from Qwen3-TTS.

    Returns:
        List of prebuilt voice info dicts
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{QWEN_TTS_URL}/voices/prebuilt")
            response.raise_for_status()
            result = response.json()
            return result.get("voices", [])
    except httpx.HTTPError:
        # Return fallback list if service unavailable (actual Qwen3-TTS voices, lowercase IDs)
        return [
            {"id": "aiden", "name": "Aiden", "gender": "male", "description": "Young adult male, clear and energetic"},
            {"id": "dylan", "name": "Dylan", "gender": "male", "description": "Adult male, warm and friendly"},
            {"id": "eric", "name": "Eric", "gender": "male", "description": "Adult male, professional and calm"},
            {"id": "ryan", "name": "Ryan", "gender": "male", "description": "Adult male, warm and professional"},
            {"id": "uncle_fu", "name": "Uncle Fu", "gender": "male", "description": "Mature male, wise and measured"},
            {"id": "ono_anna", "name": "Anna", "gender": "female", "description": "Adult female, warm and expressive"},
            {"id": "serena", "name": "Serena", "gender": "female", "description": "Young adult female, bright and clear"},
            {"id": "sohee", "name": "Sohee", "gender": "female", "description": "Young female, energetic and engaging"},
            {"id": "vivian", "name": "Vivian", "gender": "female", "description": "Adult female, professional and calm"},
        ]


async def check_tts_service_health() -> Dict[str, Any]:
    """
    Check if the Qwen3-TTS service is healthy.

    Returns:
        Health status dict with 'healthy' bool and 'details' string
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
    except httpx.HTTPError as e:
        return {
            "healthy": False,
            "details": str(e),
        }
