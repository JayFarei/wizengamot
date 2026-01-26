"""
End-to-end tests for voice cloning workflow.

Tests the full pipeline: clone voice -> synthesize -> verify with Whisper.

Run with: uv run pytest tests/test_clone_e2e.py -v
Requires: TTS service running on localhost:7860
"""

import base64
import os
from pathlib import Path

import pytest

FIXTURE_AUDIO = Path(__file__).parent.parent / "voices" / "clone_6c96c779.wav"
FIXTURE_TRANSCRIPT = """CHAPTER ONE
THE BOY WHO LIVED
Mr. and Mrs. Dursley, of number four, Privet Drive, were proud to say
that they were perfectly normal, thank you very much."""

TEST_PROMPT = "The Dursleys were perfectly normal, thank you very much."

TTS_SERVICE_URL = os.environ.get("TTS_SERVICE_URL", "http://localhost:7860")


@pytest.fixture
def tts_client():
    """Create HTTP client for TTS service."""
    import httpx
    return httpx.Client(base_url=TTS_SERVICE_URL, timeout=300)


@pytest.fixture
def check_service(tts_client):
    """Check if TTS service is running before tests."""
    try:
        response = tts_client.get("/health")
        if response.status_code != 200:
            pytest.skip("TTS service not healthy")
    except Exception:
        pytest.skip("TTS service not available")


class TestVoiceCloneE2E:
    """End-to-end test: clone voice -> synthesize -> verify with Whisper."""

    @pytest.mark.skipif(not FIXTURE_AUDIO.exists(), reason="Test fixture not found")
    def test_clone_and_synthesize_verifies_with_whisper(self, tts_client, check_service):
        """Test full clone pipeline with Whisper verification."""
        with open(FIXTURE_AUDIO, "rb") as f:
            response = tts_client.post(
                "/voices/clone",
                files={"audio": ("stephen_fry.wav", f, "audio/wav")},
                data={
                    "name": "test_stephen_fry",
                    "transcript": FIXTURE_TRANSCRIPT,
                },
            )
        assert response.status_code == 200
        voice_id = response.json()["voice_id"]

        try:
            synth_response = tts_client.post(
                "/synthesize",
                json={
                    "text": TEST_PROMPT,
                    "voice_id": voice_id,
                    "voice_mode": "clone",
                    "output_format": "wav",
                },
            )
            assert synth_response.status_code == 200
            audio_base64 = synth_response.json()["audio_base64"]
            audio_bytes = base64.b64decode(audio_base64)

            verify_response = tts_client.post(
                "/transcribe",
                files={"audio": ("output.wav", audio_bytes, "audio/wav")},
            )
            assert verify_response.status_code == 200
            transcribed = verify_response.json()["transcript"].lower()

            expected_words = ["dursley", "normal", "thank"]
            found_words = [w for w in expected_words if w in transcribed]
            assert len(found_words) >= 2, f"Expected key words in transcription: {transcribed}"

        finally:
            tts_client.delete(f"/voices/{voice_id}")

    @pytest.mark.skipif(not FIXTURE_AUDIO.exists(), reason="Test fixture not found")
    def test_auto_transcribe_produces_text(self, tts_client, check_service):
        """Verify auto-transcription produces reasonable result."""
        with open(FIXTURE_AUDIO, "rb") as f:
            response = tts_client.post(
                "/transcribe",
                files={"audio": ("stephen_fry.wav", f, "audio/wav")},
            )
        assert response.status_code == 200
        result = response.json()
        transcript = result["transcript"]

        assert len(transcript) > 50, "Transcript should have substantial content"
        assert result["duration_seconds"] > 1, "Should have audio duration"


class TestVoiceDesignE2E:
    """End-to-end tests for voice design workflow."""

    def test_voice_design_synthesizes(self, tts_client, check_service):
        """Verify voice design model produces audio."""
        response = tts_client.post(
            "/voices/design",
            json={
                "name": "test_warm_male",
                "description": "Warm male voice, mid-30s, friendly tone",
            },
        )
        assert response.status_code == 200
        voice_id = response.json()["voice_id"]

        try:
            synth = tts_client.post(
                "/synthesize",
                json={
                    "text": "Hello, this is a test of voice design.",
                    "voice_id": voice_id,
                    "voice_mode": "design",
                },
            )
            assert synth.status_code == 200
            assert len(synth.json()["audio_base64"]) > 1000

        finally:
            tts_client.delete(f"/voices/{voice_id}")


class TestMP3Output:
    """Tests for MP3 output format."""

    def test_synthesize_mp3_format(self, tts_client, check_service):
        """Test synthesis with MP3 output."""
        response = tts_client.post(
            "/synthesize",
            json={
                "text": "Testing MP3 output format.",
                "voice_id": "Aiden",
                "voice_mode": "prebuilt",
                "output_format": "mp3",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["format"] == "mp3"

        audio_bytes = base64.b64decode(data["audio_base64"])
        assert audio_bytes[:3] == b'\xff\xfb\x90' or audio_bytes[:2] == b'ID', "Should be valid MP3"


class TestModelWarming:
    """Tests for model warming endpoint."""

    def test_warm_models(self, tts_client, check_service):
        """Test model warming endpoint."""
        response = tts_client.post(
            "/warm",
            json={"modes": ["prebuilt"]},
        )
        assert response.status_code == 200
        data = response.json()
        assert "prebuilt" in data["warmed"]
        assert "memory_mb" in data

    def test_warm_default_models(self, tts_client, check_service):
        """Test warming with default modes."""
        response = tts_client.post("/warm")
        assert response.status_code == 200
        data = response.json()
        assert len(data["warmed"]) >= 1


class TestHealthEndpoint:
    """Tests for health endpoint with new features."""

    def test_health_shows_model_map(self, tts_client, check_service):
        """Test that health endpoint shows model configuration."""
        response = tts_client.get("/health")
        assert response.status_code == 200
        data = response.json()

        assert "model_map" in data
        assert "clone" in data["model_map"]
        assert "design" in data["model_map"]
        assert "output_formats" in data
        assert "mp3" in data["output_formats"]
