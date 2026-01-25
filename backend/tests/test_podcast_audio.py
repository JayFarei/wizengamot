"""Tests for podcast audio generation with Qwen3-TTS."""

import base64
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Sample test data
SAMPLE_DIALOGUE = [
    {"speaker": "Alex", "text": "Welcome to the show!", "emotion": "enthusiastic"},
    {"speaker": "Jordan", "text": "Thanks for having me!", "emotion": "warm"},
    {"speaker": "Alex", "text": "Let's dive in.", "emotion": "curious"},
]

SAMPLE_CHARACTERS = {
    "Alex": {
        "id": "char-alex",
        "name": "Alex",
        "voice_mode": "prebuilt",
        "voice": {"prebuilt_voice": "serena"},
        "personality": {"emotion_style": "warm"}
    },
    "Jordan": {
        "id": "char-jordan",
        "name": "Jordan",
        "voice_mode": "prebuilt",
        "voice": {"prebuilt_voice": "ryan"},
        "personality": {"emotion_style": "measured"}
    }
}

SAMPLE_CLONE_CHARACTER = {
    "id": "char-clone",
    "name": "CustomVoice",
    "voice_mode": "clone",
    "voice": {"qwen_voice_id": "clone_abc123"},
    "personality": {"emotion_style": "neutral"}
}

SAMPLE_DESIGN_CHARACTER = {
    "id": "char-design",
    "name": "DesignedVoice",
    "voice_mode": "design",
    "voice": {"qwen_voice_id": "design_xyz789", "description": "warm, mid-30s female"},
    "personality": {"emotion_style": "friendly"}
}


def _create_mock_httpx_response(response_data):
    """Helper to create properly mocked httpx response."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = response_data
    mock_response.raise_for_status = MagicMock()
    return mock_response


class TestGeneratePodcastAudio:
    """Tests for generate_podcast_audio function."""

    @pytest.mark.asyncio
    async def test_generate_podcast_audio(self):
        """Generates full podcast audio in one call."""
        from backend.podcast_qwen import generate_podcast_audio

        # Mock TTS response
        mock_audio = b"RIFF" + b"\x00" * 100  # Fake WAV header
        mock_response_data = {
            "audio_base64": base64.b64encode(mock_audio).decode(),
            "word_timings": [
                {"word": "Welcome", "start_ms": 0, "end_ms": 500, "speaker": "Alex"},
                {"word": "to", "start_ms": 500, "end_ms": 600, "speaker": "Alex"},
            ],
            "duration_ms": 5000
        }

        mock_response = _create_mock_httpx_response(mock_response_data)

        with patch("backend.podcast_qwen.httpx.AsyncClient") as MockAsyncClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=None)

            audio_bytes, word_timings, duration_ms = await generate_podcast_audio(
                dialogue_segments=SAMPLE_DIALOGUE,
                characters=SAMPLE_CHARACTERS
            )

            assert audio_bytes == mock_audio
            assert len(word_timings) == 2
            assert duration_ms == 5000

    @pytest.mark.asyncio
    async def test_audio_has_word_timings(self):
        """Audio response includes teleprompter timings."""
        from backend.podcast_qwen import generate_podcast_audio

        mock_timings = [
            {"word": "Welcome", "start_ms": 0, "end_ms": 500, "speaker": "Alex"},
            {"word": "to", "start_ms": 500, "end_ms": 600, "speaker": "Alex"},
            {"word": "the", "start_ms": 600, "end_ms": 700, "speaker": "Alex"},
            {"word": "show", "start_ms": 700, "end_ms": 1000, "speaker": "Alex"},
        ]

        mock_response_data = {
            "audio_base64": base64.b64encode(b"audio").decode(),
            "word_timings": mock_timings,
            "duration_ms": 1000
        }

        mock_response = _create_mock_httpx_response(mock_response_data)

        with patch("backend.podcast_qwen.httpx.AsyncClient") as MockAsyncClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=None)

            _, word_timings, _ = await generate_podcast_audio(
                dialogue_segments=SAMPLE_DIALOGUE,
                characters=SAMPLE_CHARACTERS
            )

            # Verify timing structure
            for timing in word_timings:
                assert "word" in timing
                assert "start_ms" in timing
                assert "end_ms" in timing
                assert "speaker" in timing
                assert isinstance(timing["start_ms"], int)
                assert isinstance(timing["end_ms"], int)
                assert timing["end_ms"] >= timing["start_ms"]

    @pytest.mark.asyncio
    async def test_empty_dialogue_returns_empty(self):
        """Empty dialogue returns empty audio."""
        from backend.podcast_qwen import generate_podcast_audio

        audio_bytes, word_timings, duration_ms = await generate_podcast_audio(
            dialogue_segments=[],
            characters=SAMPLE_CHARACTERS
        )

        assert audio_bytes == b""
        assert word_timings == []
        assert duration_ms == 0

    @pytest.mark.asyncio
    async def test_skips_empty_text_segments(self):
        """Segments with empty text are skipped."""
        from backend.podcast_qwen import generate_podcast_audio

        dialogue_with_empty = [
            {"speaker": "Alex", "text": "Hello!", "emotion": "warm"},
            {"speaker": "Alex", "text": "", "emotion": "warm"},  # Empty
            {"speaker": "Alex", "text": "   ", "emotion": "warm"},  # Whitespace only
            {"speaker": "Alex", "text": "Goodbye!", "emotion": "warm"},
        ]

        mock_response_data = {
            "audio_base64": base64.b64encode(b"audio").decode(),
            "word_timings": [],
            "duration_ms": 1000
        }

        mock_response = _create_mock_httpx_response(mock_response_data)

        with patch("backend.podcast_qwen.httpx.AsyncClient") as MockAsyncClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=None)

            await generate_podcast_audio(
                dialogue_segments=dialogue_with_empty,
                characters=SAMPLE_CHARACTERS
            )

            # Verify only non-empty segments were sent
            call_args = mock_client_instance.post.call_args
            sent_dialogue = call_args.kwargs["json"]["dialogue"]
            assert len(sent_dialogue) == 2  # Only "Hello!" and "Goodbye!"


class TestVoiceConfigFromCharacter:
    """Tests for _build_voice_config function."""

    def test_voice_config_prebuilt(self):
        """Builds correct voice config for prebuilt mode."""
        from backend.podcast_qwen import _build_voice_config

        config = _build_voice_config(SAMPLE_CHARACTERS["Alex"])

        assert config["voice_mode"] == "prebuilt"
        assert config["voice_id"] == "serena"

    def test_voice_config_clone(self):
        """Builds correct voice config for clone mode."""
        from backend.podcast_qwen import _build_voice_config

        config = _build_voice_config(SAMPLE_CLONE_CHARACTER)

        assert config["voice_mode"] == "clone"
        assert config["voice_id"] == "clone_abc123"

    def test_voice_config_design(self):
        """Builds correct voice config for design mode."""
        from backend.podcast_qwen import _build_voice_config

        config = _build_voice_config(SAMPLE_DESIGN_CHARACTER)

        assert config["voice_mode"] == "design"
        assert config["voice_id"] == "design_xyz789"

    def test_voice_config_default_prebuilt(self):
        """Defaults to prebuilt mode with Aiden voice."""
        from backend.podcast_qwen import _build_voice_config

        minimal_char = {
            "name": "Test",
            "voice": {}
        }

        config = _build_voice_config(minimal_char)

        assert config["voice_mode"] == "prebuilt"
        assert config["voice_id"] == "aiden"


class TestTTSServiceHealth:
    """Tests for TTS service health check."""

    @pytest.mark.asyncio
    async def test_healthy_service(self):
        """Health check returns healthy for working service."""
        from backend.podcast_qwen import check_tts_service

        mock_health = {
            "status": "healthy",
            "service": "qwen3-tts",
            "model_loaded": True
        }

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = mock_health

        with patch("backend.podcast_qwen.httpx.AsyncClient") as MockAsyncClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=None)

            result = await check_tts_service()

            assert result["healthy"] is True
            assert "details" in result

    @pytest.mark.asyncio
    async def test_unhealthy_service(self):
        """Health check returns unhealthy for error response."""
        from backend.podcast_qwen import check_tts_service

        mock_response = MagicMock()
        mock_response.status_code = 500

        with patch("backend.podcast_qwen.httpx.AsyncClient") as MockAsyncClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=None)

            result = await check_tts_service()

            assert result["healthy"] is False

    @pytest.mark.asyncio
    async def test_service_connection_error(self):
        """Health check handles connection errors."""
        from backend.podcast_qwen import check_tts_service
        import httpx

        with patch("backend.podcast_qwen.httpx.AsyncClient") as MockAsyncClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(side_effect=httpx.RequestError("Connection refused"))
            MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=None)

            result = await check_tts_service()

            assert result["healthy"] is False
            assert "Connection refused" in result["details"]


class TestSingleSpeakerAudio:
    """Tests for single speaker audio generation."""

    @pytest.mark.asyncio
    async def test_generate_single_audio(self):
        """Generates audio for a single speaker segment."""
        from backend.podcast_qwen import generate_single_audio

        mock_response_data = {
            "audio_base64": base64.b64encode(b"single_audio").decode(),
            "word_timings": [{"word": "Hello", "start_ms": 0, "end_ms": 500}],
            "duration_ms": 500
        }

        mock_response = _create_mock_httpx_response(mock_response_data)

        with patch("backend.podcast_qwen.httpx.AsyncClient") as MockAsyncClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=None)

            audio_bytes, word_timings, duration_ms = await generate_single_audio(
                text="Hello",
                character=SAMPLE_CHARACTERS["Alex"],
                emotion="warm"
            )

            assert audio_bytes == b"single_audio"
            assert len(word_timings) == 1
            assert duration_ms == 500


class TestProgressCallback:
    """Tests for progress callback during audio generation."""

    @pytest.mark.asyncio
    async def test_progress_callback_called(self):
        """Progress callback is called during generation."""
        from backend.podcast_qwen import generate_podcast_audio

        progress_calls = []

        def track_progress(progress, message):
            progress_calls.append((progress, message))

        mock_response_data = {
            "audio_base64": base64.b64encode(b"audio").decode(),
            "word_timings": [],
            "duration_ms": 1000
        }

        mock_response = _create_mock_httpx_response(mock_response_data)

        with patch("backend.podcast_qwen.httpx.AsyncClient") as MockAsyncClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=None)

            await generate_podcast_audio(
                dialogue_segments=SAMPLE_DIALOGUE,
                characters=SAMPLE_CHARACTERS,
                progress_callback=track_progress
            )

            # Should have progress updates
            assert len(progress_calls) >= 2
            # Progress should increase
            for i in range(1, len(progress_calls)):
                assert progress_calls[i][0] >= progress_calls[i-1][0]


class TestAudioSaving:
    """Tests for audio file saving."""

    def test_save_podcast_audio(self, tmp_path):
        """Audio is saved to correct path."""
        from backend.podcast_qwen import save_podcast_audio

        session_id = "test-session-123"
        audio_bytes = b"fake audio content"

        with patch("backend.podcast_qwen.get_audio_path_from_storage") as mock_path:
            audio_path = tmp_path / session_id / "audio.mp3"
            mock_path.return_value = audio_path

            result_path = save_podcast_audio(session_id, audio_bytes)

            assert audio_path.exists()
            assert audio_path.read_bytes() == audio_bytes
            assert result_path == str(audio_path)

    def test_get_podcast_audio_path_exists(self, tmp_path):
        """Returns path when audio file exists."""
        from backend.podcast_qwen import get_podcast_audio_path

        session_id = "test-session-456"
        audio_path = tmp_path / session_id / "audio.mp3"
        audio_path.parent.mkdir(parents=True)
        audio_path.write_bytes(b"audio")

        with patch("backend.podcast_qwen.get_audio_path_from_storage") as mock_path:
            mock_path.return_value = audio_path

            result = get_podcast_audio_path(session_id)

            assert result == audio_path

    def test_get_podcast_audio_path_not_exists(self, tmp_path):
        """Returns None when audio file doesn't exist."""
        from backend.podcast_qwen import get_podcast_audio_path

        session_id = "nonexistent-session"
        audio_path = tmp_path / session_id / "audio.mp3"

        with patch("backend.podcast_qwen.get_audio_path_from_storage") as mock_path:
            mock_path.return_value = audio_path

            result = get_podcast_audio_path(session_id)

            assert result is None

    def test_delete_podcast_audio(self, tmp_path):
        """Audio file is deleted successfully."""
        from backend.podcast_qwen import delete_podcast_audio

        session_id = "test-session-789"
        audio_path = tmp_path / session_id / "audio.mp3"
        audio_path.parent.mkdir(parents=True)
        audio_path.write_bytes(b"audio to delete")

        with patch("backend.podcast_qwen.get_audio_path_from_storage") as mock_path:
            mock_path.return_value = audio_path

            result = delete_podcast_audio(session_id)

            assert result is True
            assert not audio_path.exists()

    def test_delete_nonexistent_audio(self, tmp_path):
        """Deleting nonexistent audio returns False."""
        from backend.podcast_qwen import delete_podcast_audio

        session_id = "nonexistent"
        audio_path = tmp_path / session_id / "audio.mp3"

        with patch("backend.podcast_qwen.get_audio_path_from_storage") as mock_path:
            mock_path.return_value = audio_path

            result = delete_podcast_audio(session_id)

            assert result is False
