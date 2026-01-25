"""
Tests for podcast character management functionality.

Run with:
    uv run pytest backend/tests/test_podcast_characters.py -v
"""

import pytest
import sys
import json
import tempfile
import shutil
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock

# Ensure we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


@pytest.fixture
def temp_characters_dir(tmp_path):
    """Create a temporary directory for character storage."""
    characters_dir = tmp_path / "podcast" / "characters"
    characters_dir.mkdir(parents=True)
    return characters_dir


@pytest.fixture
def mock_characters_dir(temp_characters_dir, monkeypatch):
    """Patch the CHARACTERS_DIR to use the temporary directory."""
    monkeypatch.setattr(
        'backend.podcast_characters.CHARACTERS_DIR',
        temp_characters_dir
    )
    return temp_characters_dir


class TestListCharacters:
    """Tests for the list_characters function."""

    @pytest.mark.asyncio
    async def test_list_characters_empty(self, mock_characters_dir):
        """Returns empty list when no characters exist."""
        from backend.podcast_characters import list_characters

        result = await list_characters()
        assert result == []

    @pytest.mark.asyncio
    async def test_list_characters_returns_all(self, mock_characters_dir):
        """Returns all saved characters sorted by creation date."""
        from backend.podcast_characters import list_characters

        # Create some test characters
        char1_dir = mock_characters_dir / "char-1"
        char1_dir.mkdir()
        (char1_dir / "character.json").write_text(json.dumps({
            "id": "char-1",
            "name": "Alice",
            "voice_mode": "prebuilt",
            "voice": {"prebuilt_voice": "ono_anna"},
            "personality": {"speaking_role": "host"},
            "created_at": "2024-01-01T10:00:00",
            "updated_at": "2024-01-01T10:00:00"
        }))

        char2_dir = mock_characters_dir / "char-2"
        char2_dir.mkdir()
        (char2_dir / "character.json").write_text(json.dumps({
            "id": "char-2",
            "name": "Bob",
            "voice_mode": "prebuilt",
            "voice": {"prebuilt_voice": "aiden"},
            "personality": {"speaking_role": "expert"},
            "created_at": "2024-01-02T10:00:00",
            "updated_at": "2024-01-02T10:00:00"
        }))

        result = await list_characters()

        assert len(result) == 2
        # Should be sorted by created_at descending (newest first)
        assert result[0]["name"] == "Bob"
        assert result[1]["name"] == "Alice"


class TestGetCharacter:
    """Tests for the get_character function."""

    @pytest.mark.asyncio
    async def test_get_character_exists(self, mock_characters_dir):
        """Returns character data when it exists."""
        from backend.podcast_characters import get_character

        # Create a test character
        char_dir = mock_characters_dir / "test-id"
        char_dir.mkdir()
        char_data = {
            "id": "test-id",
            "name": "Test Character",
            "voice_mode": "prebuilt",
            "voice": {"prebuilt_voice": "aiden"},
            "personality": {"speaking_role": "host"},
            "created_at": "2024-01-01T10:00:00"
        }
        (char_dir / "character.json").write_text(json.dumps(char_data))

        result = await get_character("test-id")

        assert result is not None
        assert result["id"] == "test-id"
        assert result["name"] == "Test Character"

    @pytest.mark.asyncio
    async def test_get_character_not_found(self, mock_characters_dir):
        """Returns None when character does not exist."""
        from backend.podcast_characters import get_character

        result = await get_character("nonexistent-id")
        assert result is None


class TestCreateCharacterCloneMode:
    """Tests for creating characters with clone mode."""

    @pytest.mark.asyncio
    async def test_create_character_clone_mode(self, mock_characters_dir):
        """Creates character with audio + transcript."""
        from backend.podcast_characters import create_character

        # Mock the TTS service response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"voice_id": "clone_abc123"}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch('backend.podcast_characters.httpx.AsyncClient', return_value=mock_client):
            result = await create_character(
                name="Cloned Voice",
                voice_mode="clone",
                voice_config={"reference_transcript": "Hello, this is my voice."},
                personality={"speaking_role": "host", "traits": "Warm and friendly"},
                audio_file=b"fake audio data"
            )

        assert result["name"] == "Cloned Voice"
        assert result["voice_mode"] == "clone"
        assert result["voice"]["reference_transcript"] == "Hello, this is my voice."
        assert result["voice"]["qwen_voice_id"] == "clone_abc123"
        assert "id" in result
        assert "created_at" in result

        # Verify audio file was saved
        char_dir = mock_characters_dir / result["id"]
        assert (char_dir / "voice_sample.wav").exists()

    @pytest.mark.asyncio
    async def test_create_character_clone_mode_missing_audio(self, mock_characters_dir):
        """Raises error when audio file is missing for clone mode."""
        from backend.podcast_characters import create_character

        with pytest.raises(ValueError, match="audio_file is required"):
            await create_character(
                name="Test",
                voice_mode="clone",
                voice_config={"reference_transcript": "Hello"},
                personality={"speaking_role": "host"},
                audio_file=None
            )

    @pytest.mark.asyncio
    async def test_create_character_clone_mode_missing_transcript(self, mock_characters_dir):
        """Raises error when transcript is missing for clone mode."""
        from backend.podcast_characters import create_character

        with pytest.raises(ValueError, match="reference_transcript is required"):
            await create_character(
                name="Test",
                voice_mode="clone",
                voice_config={},
                personality={"speaking_role": "host"},
                audio_file=b"fake audio"
            )


class TestCreateCharacterDesignMode:
    """Tests for creating characters with design mode."""

    @pytest.mark.asyncio
    async def test_create_character_design_mode(self, mock_characters_dir):
        """Creates character with text description."""
        from backend.podcast_characters import create_character

        # Mock the TTS service response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"voice_id": "design_xyz789"}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch('backend.podcast_characters.httpx.AsyncClient', return_value=mock_client):
            result = await create_character(
                name="Designed Voice",
                voice_mode="design",
                voice_config={"description": "Warm female voice, mid-30s, slightly raspy"},
                personality={"speaking_role": "expert", "traits": "Curious and insightful"}
            )

        assert result["name"] == "Designed Voice"
        assert result["voice_mode"] == "design"
        assert result["voice"]["description"] == "Warm female voice, mid-30s, slightly raspy"
        assert result["voice"]["qwen_voice_id"] == "design_xyz789"

    @pytest.mark.asyncio
    async def test_create_character_design_mode_missing_description(self, mock_characters_dir):
        """Raises error when description is missing for design mode."""
        from backend.podcast_characters import create_character

        with pytest.raises(ValueError, match="description is required"):
            await create_character(
                name="Test",
                voice_mode="design",
                voice_config={},
                personality={"speaking_role": "host"}
            )


class TestCreateCharacterPrebuiltMode:
    """Tests for creating characters with prebuilt mode."""

    @pytest.mark.asyncio
    async def test_create_character_prebuilt_mode(self, mock_characters_dir):
        """Creates character with prebuilt voice."""
        from backend.podcast_characters import create_character

        result = await create_character(
            name="Prebuilt Voice",
            voice_mode="prebuilt",
            voice_config={"prebuilt_voice": "ono_anna"},
            personality={
                "speaking_role": "host",
                "traits": "Friendly and warm",
                "key_phrases": ["That's fascinating", "Tell me more"],
                "expertise_areas": ["technology", "science"]
            }
        )

        assert result["name"] == "Prebuilt Voice"
        assert result["voice_mode"] == "prebuilt"
        assert result["voice"]["prebuilt_voice"] == "ono_anna"
        assert result["personality"]["speaking_role"] == "host"
        assert result["personality"]["key_phrases"] == ["That's fascinating", "Tell me more"]

    @pytest.mark.asyncio
    async def test_create_character_prebuilt_mode_missing_voice(self, mock_characters_dir):
        """Raises error when prebuilt_voice is missing."""
        from backend.podcast_characters import create_character

        with pytest.raises(ValueError, match="prebuilt_voice is required"):
            await create_character(
                name="Test",
                voice_mode="prebuilt",
                voice_config={},
                personality={"speaking_role": "host"}
            )


class TestUpdateCharacter:
    """Tests for the update_character function."""

    @pytest.mark.asyncio
    async def test_update_character_personality(self, mock_characters_dir):
        """Updates personality and emotion style."""
        from backend.podcast_characters import create_character, update_character

        # Create initial character
        char = await create_character(
            name="Original Name",
            voice_mode="prebuilt",
            voice_config={"prebuilt_voice": "aiden"},
            personality={"speaking_role": "host", "traits": "Original traits"}
        )

        # Update personality
        updated = await update_character(char["id"], {
            "name": "Updated Name",
            "personality": {
                "traits": "Updated traits",
                "emotion_style": "Enthusiastic and energetic"
            }
        })

        assert updated is not None
        assert updated["name"] == "Updated Name"
        assert updated["personality"]["traits"] == "Updated traits"
        assert updated["personality"]["emotion_style"] == "Enthusiastic and energetic"
        # Original values should be preserved if not updated
        assert updated["personality"]["speaking_role"] == "host"

    @pytest.mark.asyncio
    async def test_update_character_not_found(self, mock_characters_dir):
        """Returns None when character does not exist."""
        from backend.podcast_characters import update_character

        result = await update_character("nonexistent-id", {"name": "Test"})
        assert result is None


class TestDeleteCharacter:
    """Tests for the delete_character function."""

    @pytest.mark.asyncio
    async def test_delete_character(self, mock_characters_dir):
        """Deletes character and associated voice."""
        from backend.podcast_characters import create_character, delete_character, get_character

        # Create a character
        char = await create_character(
            name="To Be Deleted",
            voice_mode="prebuilt",
            voice_config={"prebuilt_voice": "aiden"},
            personality={"speaking_role": "host"}
        )

        # Verify it exists
        assert await get_character(char["id"]) is not None

        # Delete it
        result = await delete_character(char["id"])
        assert result is True

        # Verify it's gone
        assert await get_character(char["id"]) is None

    @pytest.mark.asyncio
    async def test_delete_character_not_found(self, mock_characters_dir):
        """Returns False when character does not exist."""
        from backend.podcast_characters import delete_character

        result = await delete_character("nonexistent-id")
        assert result is False

    @pytest.mark.asyncio
    async def test_delete_character_cleans_up_tts_voice(self, mock_characters_dir):
        """Attempts to delete voice from TTS service."""
        from backend.podcast_characters import create_character, delete_character

        # Create a character with a TTS voice ID
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"voice_id": "design_to_delete"}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.delete.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch('backend.podcast_characters.httpx.AsyncClient', return_value=mock_client):
            char = await create_character(
                name="With TTS Voice",
                voice_mode="design",
                voice_config={"description": "Test voice"},
                personality={"speaking_role": "host"}
            )

            # Delete the character
            await delete_character(char["id"])

            # Verify TTS delete was called
            mock_client.delete.assert_called_once()


class TestPreviewVoice:
    """Tests for the preview_character_voice function."""

    @pytest.mark.asyncio
    async def test_preview_voice(self, mock_characters_dir):
        """Generates preview audio for character."""
        from backend.podcast_characters import create_character, preview_character_voice
        import base64

        # Create a character
        char = await create_character(
            name="Preview Test",
            voice_mode="prebuilt",
            voice_config={"prebuilt_voice": "ono_anna"},
            personality={"speaking_role": "host"}
        )

        # Mock the TTS synthesis response
        fake_audio = b"fake audio data for preview"
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "audio_base64": base64.b64encode(fake_audio).decode(),
            "duration_ms": 1000
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch('backend.podcast_characters.httpx.AsyncClient', return_value=mock_client):
            result = await preview_character_voice(char["id"], "Hello there!")

        assert result == fake_audio

    @pytest.mark.asyncio
    async def test_preview_voice_character_not_found(self, mock_characters_dir):
        """Returns None when character does not exist."""
        from backend.podcast_characters import preview_character_voice

        result = await preview_character_voice("nonexistent-id")
        assert result is None


class TestGetPrebuiltVoices:
    """Tests for the get_prebuilt_voices function."""

    @pytest.mark.asyncio
    async def test_get_prebuilt_voices_from_service(self):
        """Returns prebuilt voices from TTS service."""
        from backend.podcast_characters import get_prebuilt_voices

        expected_voices = [
            {"id": "aiden", "name": "Aiden", "gender": "male"},
            {"id": "ono_anna", "name": "Anna", "gender": "female"}
        ]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"voices": expected_voices}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch('backend.podcast_characters.httpx.AsyncClient', return_value=mock_client):
            result = await get_prebuilt_voices()

        assert result == expected_voices

    @pytest.mark.asyncio
    async def test_get_prebuilt_voices_fallback(self):
        """Returns fallback list when TTS service is unavailable."""
        from backend.podcast_characters import get_prebuilt_voices
        import httpx

        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.HTTPError("Connection refused")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch('backend.podcast_characters.httpx.AsyncClient', return_value=mock_client):
            result = await get_prebuilt_voices()

        # Should return fallback list
        assert len(result) == 9
        voice_ids = [v["id"] for v in result]
        assert "aiden" in voice_ids
        assert "ono_anna" in voice_ids


class TestTTSHealthCheck:
    """Tests for the check_tts_service_health function."""

    @pytest.mark.asyncio
    async def test_tts_health_check_healthy(self):
        """Returns healthy status when service is available."""
        from backend.podcast_characters import check_tts_service_health

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "healthy", "model_loaded": True}

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch('backend.podcast_characters.httpx.AsyncClient', return_value=mock_client):
            result = await check_tts_service_health()

        assert result["healthy"] is True
        assert "details" in result

    @pytest.mark.asyncio
    async def test_tts_health_check_unhealthy(self):
        """Returns unhealthy status when service is unavailable."""
        from backend.podcast_characters import check_tts_service_health
        import httpx

        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.HTTPError("Connection refused")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch('backend.podcast_characters.httpx.AsyncClient', return_value=mock_client):
            result = await check_tts_service_health()

        assert result["healthy"] is False
        assert "Connection refused" in result["details"]
