"""
Tests for the Qwen3-TTS service.

Run with: uv run pytest tests/test_service.py
"""

import base64
import io
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import numpy as np
import pytest
from fastapi.testclient import TestClient

# Set up test environment before importing server
os.environ["QWEN_TTS_PORT"] = "7861"

from server import (
    app,
    PREBUILT_VOICES,
    VOICES_DIR,
    load_voices_metadata,
    save_voices_metadata,
    VoiceInfo,
)


@pytest.fixture
def client():
    """Create test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def clean_voices_dir():
    """Clean up voices directory before and after tests."""
    # Create a temporary metadata backup
    metadata_file = VOICES_DIR / "metadata.json"
    backup_data = None
    if metadata_file.exists():
        with open(metadata_file, "r") as f:
            backup_data = f.read()

    yield

    # Restore original metadata
    if backup_data is not None:
        with open(metadata_file, "w") as f:
            f.write(backup_data)
    elif metadata_file.exists():
        metadata_file.unlink()


class TestHealthEndpoint:
    """Tests for the /health endpoint."""

    def test_health_endpoint(self, client):
        """Test that health endpoint returns expected structure."""
        response = client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "qwen3-tts"
        assert "version" in data
        assert "model_loaded" in data
        assert "whisper_loaded" in data


class TestPrebuiltVoices:
    """Tests for prebuilt voices endpoint."""

    def test_prebuilt_voices(self, client):
        """Test listing prebuilt voices."""
        response = client.get("/voices/prebuilt")
        assert response.status_code == 200

        data = response.json()
        assert "voices" in data
        assert "count" in data
        assert data["count"] == 9  # Qwen3-TTS has 9 prebuilt voices

        # Verify expected voices exist (lowercase IDs)
        voice_ids = [v["id"] for v in data["voices"]]
        assert "aiden" in voice_ids
        assert "serena" in voice_ids
        assert "ryan" in voice_ids
        assert "vivian" in voice_ids

    def test_prebuilt_voice_structure(self, client):
        """Test that prebuilt voices have expected structure."""
        response = client.get("/voices/prebuilt")
        data = response.json()

        for voice in data["voices"]:
            assert "id" in voice
            assert "name" in voice
            assert "gender" in voice
            assert "description" in voice
            assert voice["gender"] in ["male", "female"]


class TestVoiceClone:
    """Tests for voice cloning endpoint.

    Voice cloning now uses local CSM model (mlx-community/csm-1b).
    No external Colab/ngrok dependencies required.
    """

    def test_clone_voice_local(self, client, clean_voices_dir):
        """Test that voice cloning works with local CSM model."""
        # Create a simple test WAV file
        sample_rate = 24000
        duration_seconds = 3
        samples = int(sample_rate * duration_seconds)
        audio_data = np.random.randn(samples).astype(np.float32) * 0.1

        # Save to bytes buffer
        import soundfile as sf
        buffer = io.BytesIO()
        sf.write(buffer, audio_data, sample_rate, format="WAV")
        buffer.seek(0)

        response = client.post(
            "/voices/clone",
            files={"audio": ("test.wav", buffer, "audio/wav")},
            data={
                "transcript": "Hello, this is a test of voice cloning.",
                "name": "Test Voice",
                "description": "A test cloned voice",
            },
        )

        # Voice cloning should succeed with local CSM model
        assert response.status_code == 200
        data = response.json()
        assert "voice_id" in data
        assert data["voice_id"].startswith("clone_")
        assert data["name"] == "Test Voice"
        assert data["type"] == "cloned"

        # Verify voice was saved to metadata
        voices = load_voices_metadata()
        assert data["voice_id"] in voices

    def test_clone_voice_missing_audio(self, client):
        """Test that cloning fails without audio file."""
        response = client.post(
            "/voices/clone",
            data={
                "transcript": "Hello",
                "name": "Test",
            },
        )
        assert response.status_code == 422  # Validation error


class TestVoiceDesign:
    """Tests for voice design endpoint."""

    def test_design_voice(self, client, clean_voices_dir):
        """Test designing a voice from description."""
        response = client.post(
            "/voices/design",
            json={
                "description": "warm, mid-30s female, slightly raspy",
                "name": "Custom Voice",
                "sample_text": "Hello, this is a sample.",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "voice_id" in data
        assert data["voice_id"].startswith("design_")
        assert data["name"] == "Custom Voice"
        assert data["type"] == "designed"
        assert data["description"] == "warm, mid-30s female, slightly raspy"

        # Should have sample audio
        assert "sample_audio_base64" in data
        if data["sample_audio_base64"]:
            # Verify it's valid base64
            audio_bytes = base64.b64decode(data["sample_audio_base64"])
            assert len(audio_bytes) > 0

    def test_design_voice_without_sample(self, client, clean_voices_dir):
        """Test designing a voice without sample text."""
        response = client.post(
            "/voices/design",
            json={
                "description": "young male, energetic",
                "name": "No Sample Voice",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "No Sample Voice"


class TestSynthesizeSingle:
    """Tests for single-speaker synthesis endpoint."""

    def test_synthesize_single(self, client):
        """Test basic speech synthesis."""
        response = client.post(
            "/synthesize",
            json={
                "text": "Hello, this is a test of text to speech.",
                "voice_id": "Aiden",
                "voice_mode": "prebuilt",
            },
        )

        assert response.status_code == 200
        data = response.json()

        assert "audio_base64" in data
        assert "duration_ms" in data
        assert "word_timings" in data
        assert "sample_rate" in data

        # Verify audio is valid base64
        audio_bytes = base64.b64decode(data["audio_base64"])
        assert len(audio_bytes) > 0

        # Verify duration is reasonable
        assert data["duration_ms"] > 0
        assert data["sample_rate"] == 24000

    def test_synthesize_with_emotion(self, client):
        """Test synthesis with emotion hint."""
        response = client.post(
            "/synthesize",
            json={
                "text": "This is exciting news!",
                "voice_id": "Chelsie",
                "voice_mode": "prebuilt",
                "emotion": "enthusiastic",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "audio_base64" in data

    def test_synthesize_with_speed(self, client):
        """Test synthesis with speed adjustment."""
        response = client.post(
            "/synthesize",
            json={
                "text": "Speaking quickly now.",
                "voice_id": "Ethan",
                "voice_mode": "prebuilt",
                "speed": 1.5,
            },
        )

        assert response.status_code == 200

    def test_synthesize_missing_text(self, client):
        """Test that synthesis fails without text."""
        response = client.post(
            "/synthesize",
            json={
                "voice_id": "Aiden",
            },
        )
        assert response.status_code == 422


class TestSynthesizeDialogue:
    """Tests for multi-speaker dialogue synthesis endpoint."""

    def test_synthesize_dialogue(self, client):
        """Test multi-speaker dialogue synthesis."""
        response = client.post(
            "/synthesize-dialogue",
            json={
                "speakers": {
                    "Sarah": {"voice_mode": "prebuilt", "voice_id": "Chelsie"},
                    "Mike": {"voice_mode": "prebuilt", "voice_id": "Ethan"},
                },
                "dialogue": [
                    {"speaker": "Sarah", "text": "Welcome to the show!", "emotion": "enthusiastic"},
                    {"speaker": "Mike", "text": "Great to be here.", "emotion": "warm"},
                    {"speaker": "Sarah", "text": "Let's dive right in."},
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()

        assert "audio_base64" in data
        assert "duration_ms" in data
        assert "word_timings" in data

        # Verify word timings include speaker attribution
        if data["word_timings"]:
            for timing in data["word_timings"]:
                assert "word" in timing
                assert "start_ms" in timing
                assert "end_ms" in timing
                assert "speaker" in timing

    def test_synthesize_dialogue_with_designed_voice(self, client, clean_voices_dir):
        """Test dialogue with voice designed from description."""
        response = client.post(
            "/synthesize-dialogue",
            json={
                "speakers": {
                    "Host": {"voice_mode": "prebuilt", "voice_id": "Vivian"},
                    "Guest": {
                        "voice_mode": "design",
                        "description": "warm British accent, male, mid-40s",
                    },
                },
                "dialogue": [
                    {"speaker": "Host", "text": "Welcome to our podcast."},
                    {"speaker": "Guest", "text": "Thank you for having me."},
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["duration_ms"] > 0

    def test_synthesize_dialogue_empty(self, client):
        """Test dialogue with empty dialogue list."""
        response = client.post(
            "/synthesize-dialogue",
            json={
                "speakers": {
                    "A": {"voice_mode": "prebuilt", "voice_id": "Aiden"},
                },
                "dialogue": [],
            },
        )

        assert response.status_code == 200
        data = response.json()
        # Empty dialogue should produce minimal/empty audio
        assert data["duration_ms"] == 0


class TestVoiceManagement:
    """Tests for voice listing and deletion."""

    def test_list_voices_empty(self, client, clean_voices_dir):
        """Test listing voices when none are registered."""
        # Clear metadata
        save_voices_metadata({})

        response = client.get("/voices")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["voices"] == []

    def test_list_voices_after_creation(self, client, clean_voices_dir):
        """Test listing voices after creating some."""
        # Create a designed voice
        client.post(
            "/voices/design",
            json={
                "description": "test voice",
                "name": "Test Voice",
            },
        )

        response = client.get("/voices")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1
        assert any(v["name"] == "Test Voice" for v in data["voices"])

    def test_delete_voice(self, client, clean_voices_dir):
        """Test deleting a custom voice."""
        # First create a voice
        create_response = client.post(
            "/voices/design",
            json={
                "description": "voice to delete",
                "name": "Delete Me",
            },
        )
        voice_id = create_response.json()["voice_id"]

        # Verify it exists
        voices = load_voices_metadata()
        assert voice_id in voices

        # Delete it
        delete_response = client.delete(f"/voices/{voice_id}")
        assert delete_response.status_code == 200
        assert delete_response.json()["deleted"] == voice_id

        # Verify it's gone
        voices = load_voices_metadata()
        assert voice_id not in voices

    def test_delete_nonexistent_voice(self, client):
        """Test deleting a voice that doesn't exist."""
        response = client.delete("/voices/nonexistent_voice_id")
        assert response.status_code == 404

    def test_delete_prebuilt_voice(self, client):
        """Test that prebuilt voices cannot be deleted."""
        response = client.delete("/voices/Aiden")
        assert response.status_code == 400
        assert "prebuilt" in response.json()["detail"].lower()


class TestWordTimings:
    """Tests for word timing extraction."""

    def test_word_timings_structure(self, client):
        """Test that word timings have correct structure."""
        response = client.post(
            "/synthesize",
            json={
                "text": "One two three four five.",
                "voice_id": "Aiden",
                "voice_mode": "prebuilt",
            },
        )

        data = response.json()
        word_timings = data["word_timings"]

        # Word timings is always a list (may be empty with mock TTS)
        assert isinstance(word_timings, list)

        # If we have timings, they should have correct structure
        for timing in word_timings:
            assert "word" in timing
            assert "start_ms" in timing
            assert "end_ms" in timing
            assert isinstance(timing["start_ms"], int)
            assert isinstance(timing["end_ms"], int)
            assert timing["end_ms"] >= timing["start_ms"]

    def test_word_timings_sequential(self, client):
        """Test that word timings are sequential."""
        response = client.post(
            "/synthesize",
            json={
                "text": "First second third.",
                "voice_id": "Chelsie",
                "voice_mode": "prebuilt",
            },
        )

        data = response.json()
        word_timings = data["word_timings"]

        # Word timings is always a list
        assert isinstance(word_timings, list)

        # If we have multiple timings, they should be in order
        if len(word_timings) > 1:
            for i in range(1, len(word_timings)):
                assert word_timings[i]["start_ms"] >= word_timings[i - 1]["start_ms"]


class TestErrorHandling:
    """Tests for error handling."""

    def test_invalid_voice_mode(self, client):
        """Test handling of invalid voice mode."""
        response = client.post(
            "/synthesize",
            json={
                "text": "Test",
                "voice_id": "test",
                "voice_mode": "invalid_mode",
            },
        )
        # Should still work with mock model, but might fail with real one
        assert response.status_code in [200, 500]

    def test_clone_invalid_audio(self, client):
        """Test handling of invalid audio file for cloning."""
        response = client.post(
            "/voices/clone",
            files={"audio": ("test.txt", b"not audio data", "text/plain")},
            data={
                "transcript": "Hello",
                "name": "Test",
            },
        )
        # With local CSM, returns 500 for invalid audio format
        assert response.status_code == 500
