"""
End-to-end tests for Podcast generation.
Tests the full flow from session creation to audio generation.

Run with:
  uv run pytest backend/tests/test_podcast_e2e.py -v -s

Or standalone (diagnostic mode):
  uv run python -m backend.tests.test_podcast_e2e --conversation-id <ID>
  uv run python -m backend.tests.test_podcast_e2e --list-conversations
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Optional pytest import for when running as test suite
try:
    import pytest
    HAS_PYTEST = True
except ImportError:
    HAS_PYTEST = False

    class DummyPytest:
        def fixture(self, *args, **kwargs):
            def decorator(f):
                return f
            return decorator

        class mark:
            @staticmethod
            def asyncio(f):
                return f

        def skip(self, msg):
            print(f"SKIP: {msg}")

    pytest = DummyPytest()

from backend.settings import (
    get_elevenlabs_api_key,
    get_host_voice_config,
    get_expert_voice_config,
    get_synthesizer_model,
    get_podcast_settings,
)
from backend.podcast import (
    create_podcast_session,
    generate_dialogue_script,
    generate_podcast_audio,
    extract_notes_from_conversation,
)
from backend.podcast_storage import (
    get_podcast_session,
    delete_podcast_session,
    list_podcast_sessions,
)
from backend.podcast_elevenlabs import (
    generate_speech_with_timestamps,
    get_podcast_audio_path,
    delete_podcast_audio,
)
import httpx
from backend.storage import get_conversation, list_conversations


# =============================================================================
# Test Configuration
# =============================================================================

# Default test conversation ID (can be overridden via CLI)
TEST_CONVERSATION_ID: Optional[str] = None

# Test output directory
TEST_OUTPUT_DIR = Path("data/test_runs/podcast")


# =============================================================================
# Helper Functions
# =============================================================================

def ensure_test_dir():
    """Ensure test output directory exists."""
    TEST_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def print_header(title: str):
    """Print a section header."""
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


def print_config(label: str, value: Any, masked: bool = False):
    """Print a configuration value."""
    if masked and value:
        display = f"{str(value)[:8]}...{str(value)[-4:]}" if len(str(value)) > 12 else "****"
    else:
        display = value
    print(f"  {label}: {display}")


def find_synthesizer_conversation() -> Optional[str]:
    """Find a synthesizer conversation with notes to use for testing."""
    conversations = list_conversations()
    for conv in conversations:
        if conv.get("mode") == "synthesizer":
            full_conv = get_conversation(conv["id"])
            if full_conv:
                notes = extract_notes_from_conversation(full_conv)
                if notes:
                    return conv["id"]
    return None


def list_synthesizer_conversations():
    """List all synthesizer conversations with notes."""
    conversations = list_conversations()
    synth_convs = []
    for conv in conversations:
        if conv.get("mode") == "synthesizer":
            full_conv = get_conversation(conv["id"])
            if full_conv:
                notes = extract_notes_from_conversation(full_conv)
                if notes:
                    synth_convs.append({
                        "id": conv["id"],
                        "title": conv.get("title", "Untitled"),
                        "note_count": len(notes),
                        "created_at": conv.get("created_at", ""),
                    })
    return synth_convs


# =============================================================================
# Test Class
# =============================================================================

class TestPodcastGeneration:
    """E2E tests for podcast generation using real ElevenLabs API."""

    session_id: Optional[str] = None
    conversation_id: Optional[str] = None
    notes: List[Dict[str, Any]] = []

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures."""
        # Check API key
        api_key = get_elevenlabs_api_key()
        if not api_key:
            pytest.skip("ElevenLabs API key not configured")

        # Use TEST_CONVERSATION_ID or find one
        if TEST_CONVERSATION_ID:
            TestPodcastGeneration.conversation_id = TEST_CONVERSATION_ID
        else:
            conv_id = find_synthesizer_conversation()
            if not conv_id:
                pytest.skip("No synthesizer conversation with notes found")
            TestPodcastGeneration.conversation_id = conv_id

        ensure_test_dir()
        yield

    @pytest.mark.asyncio
    async def test_01_check_configuration(self):
        """Verify all required configuration is present."""
        print_header("TEST 1: Configuration Check")

        # ElevenLabs API key
        api_key = get_elevenlabs_api_key()
        print_config("ElevenLabs API Key", api_key, masked=True)
        assert api_key is not None, "ElevenLabs API key not configured"

        # Host voice config
        host_config = get_host_voice_config()
        print("\n  Host Voice Config:")
        print_config("    voice_id", host_config.get("voice_id"))
        print_config("    model", host_config.get("model"))
        print_config("    voice_settings", host_config.get("voice_settings"))
        assert host_config.get("voice_id"), "Host voice_id not configured"

        # Expert voice config
        expert_config = get_expert_voice_config()
        print("\n  Expert Voice Config:")
        print_config("    voice_id", expert_config.get("voice_id"))
        print_config("    model", expert_config.get("model"))
        print_config("    voice_settings", expert_config.get("voice_settings"))
        assert expert_config.get("voice_id"), "Expert voice_id not configured"

        # Synthesizer model (for dialogue generation)
        synth_model = get_synthesizer_model()
        print_config("\n  Synthesizer Model", synth_model)
        assert synth_model, "Synthesizer model not configured"

        # Full podcast settings
        settings = get_podcast_settings()
        print("\n  Podcast Settings Status:")
        print_config("    podcast_configured", settings.get("podcast_configured"))
        print_config("    elevenlabs_configured", settings.get("elevenlabs_configured"))

        print("\n  [PASS] All configuration verified")

    @pytest.mark.asyncio
    async def test_02_validate_voice_ids(self):
        """Verify voice IDs are accessible via ElevenLabs API."""
        print_header("TEST 2: Validate Voice IDs")

        api_key = get_elevenlabs_api_key()
        host_config = get_host_voice_config()
        expert_config = get_expert_voice_config()

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Check host voice
            host_voice_id = host_config.get("voice_id")
            print(f"\n  Checking host voice: {host_voice_id}")

            try:
                response = await client.get(
                    f"https://api.elevenlabs.io/v1/voices/{host_voice_id}",
                    headers={"xi-api-key": api_key}
                )
                if response.status_code == 200:
                    voice_data = response.json()
                    print_config("    Name", voice_data.get("name"))
                    print_config("    Category", voice_data.get("category"))
                    print("    [OK] Host voice accessible")
                else:
                    print(f"    [WARN] Response: {response.status_code} - {response.text}")
            except Exception as e:
                print(f"    [WARN] Could not verify: {e}")

            # Check expert voice
            expert_voice_id = expert_config.get("voice_id")
            print(f"\n  Checking expert voice: {expert_voice_id}")

            try:
                response = await client.get(
                    f"https://api.elevenlabs.io/v1/voices/{expert_voice_id}",
                    headers={"xi-api-key": api_key}
                )
                if response.status_code == 200:
                    voice_data = response.json()
                    print_config("    Name", voice_data.get("name"))
                    print_config("    Category", voice_data.get("category"))
                    print("    [OK] Expert voice accessible")
                else:
                    print(f"    [WARN] Response: {response.status_code} - {response.text}")
            except Exception as e:
                print(f"    [WARN] Could not verify: {e}")

        print("\n  [PASS] Voice ID validation complete")

    @pytest.mark.asyncio
    async def test_03_verify_source_conversation(self):
        """Verify the source conversation exists and has notes."""
        print_header("TEST 3: Source Conversation Verification")

        conv_id = TestPodcastGeneration.conversation_id
        print_config("Conversation ID", conv_id)

        conversation = get_conversation(conv_id)
        assert conversation is not None, f"Conversation {conv_id} not found"

        print_config("Mode", conversation.get("mode"))
        print_config("Title", conversation.get("title"))
        print_config("Created", conversation.get("created_at"))

        assert conversation.get("mode") == "synthesizer", "Conversation is not a synthesizer conversation"

        notes = extract_notes_from_conversation(conversation)
        print_config("Notes found", len(notes))

        assert len(notes) > 0, "No notes found in conversation"

        # Store notes for later tests
        TestPodcastGeneration.notes = notes

        # Print first note preview
        if notes:
            print("\n  First note preview:")
            print_config("    Title", notes[0].get("title", "Untitled"))
            body = notes[0].get("body", "")[:100]
            print_config("    Body", f"{body}..." if len(body) >= 100 else body)

        print("\n  [PASS] Source conversation verified")

    @pytest.mark.asyncio
    async def test_04_create_session(self):
        """Test creating a podcast session."""
        print_header("TEST 4: Create Podcast Session")

        conv_id = TestPodcastGeneration.conversation_id
        print_config("Creating session for conversation", conv_id)

        try:
            result = create_podcast_session(
                conversation_id=conv_id,
                note_ids=None,  # Use all notes
                style="rest-is-politics"
            )

            print_config("Session ID", result.get("session_id"))
            print_config("Status", result.get("status"))
            print_config("Title", result.get("title"))
            print_config("Note count", result.get("note_count"))

            assert result.get("session_id"), "No session_id returned"
            TestPodcastGeneration.session_id = result["session_id"]

            # Verify session was saved
            session = get_podcast_session(result["session_id"])
            assert session is not None, "Session not saved to storage"
            print_config("Session saved", True)

            print("\n  [PASS] Session created successfully")

        except Exception as e:
            print(f"\n  [FAIL] Error creating session: {e}")
            import traceback
            traceback.print_exc()
            raise

    @pytest.mark.asyncio
    async def test_05_generate_dialogue_script(self):
        """Test dialogue script generation (isolated)."""
        print_header("TEST 5: Generate Dialogue Script")

        notes = TestPodcastGeneration.notes
        if not notes:
            pytest.skip("No notes available")

        print_config("Using notes", len(notes))
        print_config("Style", "rest-is-politics")

        try:
            print("\n  Calling generate_dialogue_script()...")

            dialogue = await generate_dialogue_script(
                notes=notes,
                style="rest-is-politics",
                host_prompt="",
                expert_prompt="",
            )

            print_config("Segments generated", len(dialogue))

            if dialogue:
                print("\n  First 3 segments:")
                for i, seg in enumerate(dialogue[:3]):
                    speaker = seg.get("speaker", "?")
                    text = seg.get("text", "")[:60]
                    print(f"    [{i+1}] {speaker}: {text}...")

            assert len(dialogue) > 0, "No dialogue segments generated"
            assert all("speaker" in s and "text" in s for s in dialogue), "Invalid segment structure"

            print("\n  [PASS] Dialogue script generated successfully")

        except Exception as e:
            print(f"\n  [FAIL] Error generating dialogue: {e}")
            import traceback
            traceback.print_exc()
            raise

    @pytest.mark.asyncio
    async def test_06_generate_single_audio_segment(self):
        """Test TTS generation for a single segment (isolated)."""
        print_header("TEST 6: Generate Single Audio Segment")

        api_key = get_elevenlabs_api_key()
        host_config = get_host_voice_config()

        test_text = "Hello, welcome to our podcast. Today we'll be discussing some fascinating topics."
        print_config("Test text", test_text[:50] + "...")
        print_config("Voice ID", host_config.get("voice_id"))
        print_config("Model", host_config.get("model"))

        try:
            print("\n  Calling generate_speech_with_timestamps()...")

            audio_bytes, word_timings = await generate_speech_with_timestamps(
                text=test_text,
                voice_id=host_config["voice_id"],
                model=host_config["model"],
                voice_settings=host_config["voice_settings"],
                api_key=api_key,
            )

            print_config("Audio bytes", len(audio_bytes))
            print_config("Word timings", len(word_timings))

            if word_timings:
                print("\n  First 5 word timings:")
                for timing in word_timings[:5]:
                    word = timing.get("word", "?")
                    start = timing.get("start_ms", 0)
                    end = timing.get("end_ms", 0)
                    print(f"    '{word}': {start}ms - {end}ms")

            assert len(audio_bytes) > 0, "No audio bytes generated"

            print("\n  [PASS] Single audio segment generated successfully")

        except Exception as e:
            print(f"\n  [FAIL] Error generating audio segment: {e}")
            import traceback
            traceback.print_exc()
            raise

    @pytest.mark.asyncio
    async def test_07_full_audio_generation(self):
        """Test full audio generation with progress logging."""
        print_header("TEST 7: Full Audio Generation")

        session_id = TestPodcastGeneration.session_id
        if not session_id:
            pytest.skip("No session_id available")

        print_config("Session ID", session_id)

        progress_log = []

        def progress_callback(progress: float, status: str):
            progress_log.append({
                "progress": progress,
                "status": status,
                "timestamp": datetime.utcnow().isoformat()
            })
            print(f"  Progress: {progress:.1%} - {status}")

        try:
            print("\n  Starting audio generation...")
            print("  (This may take a few minutes)\n")

            result = await generate_podcast_audio(
                session_id=session_id,
                progress_callback=progress_callback,
            )

            print("\n  Generation result:")
            print_config("    error", result.get("error"))
            print_config("    audio_path", result.get("audio_path"))
            print_config("    duration_ms", result.get("duration_ms"))
            print_config("    word_timings count", len(result.get("word_timings", [])))
            print_config("    dialogue_segments count", len(result.get("dialogue_segments", [])))

            if result.get("error"):
                print(f"\n  [FAIL] Generation error: {result['error']}")
                raise AssertionError(f"Generation failed: {result['error']}")

            # Verify audio file exists
            audio_path = get_podcast_audio_path(session_id)
            print_config("\n    Audio file exists", audio_path is not None)

            # Verify session status
            session = get_podcast_session(session_id)
            print_config("    Session status", session.get("status"))

            assert result.get("audio_path"), "No audio path returned"
            assert session.get("status") == "ready", f"Session status is {session.get('status')}, expected 'ready'"

            print("\n  Progress log:")
            for entry in progress_log:
                print(f"    {entry['progress']:.1%}: {entry['status']}")

            print("\n  [PASS] Full audio generation completed successfully")

        except Exception as e:
            print(f"\n  [FAIL] Error during full generation: {e}")
            import traceback
            traceback.print_exc()

            # Print progress log even on failure
            if progress_log:
                print("\n  Progress log before failure:")
                for entry in progress_log:
                    print(f"    {entry['progress']:.1%}: {entry['status']}")

            raise

    @pytest.mark.asyncio
    async def test_98_cleanup(self):
        """Clean up test session."""
        print_header("CLEANUP")

        session_id = TestPodcastGeneration.session_id
        if session_id:
            print_config("Cleaning up session", session_id)

            # Delete audio file
            deleted_audio = delete_podcast_audio(session_id)
            print_config("  Audio deleted", deleted_audio)

            # Delete session
            deleted_session = delete_podcast_session(session_id)
            print_config("  Session deleted", deleted_session)

            TestPodcastGeneration.session_id = None

        print("\n  [PASS] Cleanup complete")


# =============================================================================
# CLI Runner (Diagnostic Mode)
# =============================================================================

async def run_diagnostic(conversation_id: Optional[str] = None):
    """Run diagnostic tests to identify podcast generation issues."""
    print_header("PODCAST GENERATION DIAGNOSTIC")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")

    # Step 1: Configuration
    print_header("STEP 1: Configuration Check")

    api_key = get_elevenlabs_api_key()
    if not api_key:
        print("  [FAIL] ElevenLabs API key not configured!")
        print("  Configure via Settings > Podcast > ElevenLabs API Key")
        return False
    print_config("ElevenLabs API Key", api_key, masked=True)

    host_config = get_host_voice_config()
    print_config("Host voice_id", host_config.get("voice_id"))
    if not host_config.get("voice_id"):
        print("  [WARN] Host voice_id not set, using default")

    expert_config = get_expert_voice_config()
    print_config("Expert voice_id", expert_config.get("voice_id"))
    if not expert_config.get("voice_id"):
        print("  [WARN] Expert voice_id not set, using default")

    synth_model = get_synthesizer_model()
    print_config("Synthesizer model", synth_model)
    if not synth_model:
        print("  [FAIL] Synthesizer model not configured!")
        return False

    # Step 2: Find or verify conversation
    print_header("STEP 2: Source Conversation")

    if not conversation_id:
        print("  Looking for synthesizer conversation with notes...")
        conversation_id = find_synthesizer_conversation()
        if not conversation_id:
            print("  [FAIL] No synthesizer conversation with notes found!")
            print("  Create some notes in Synthesizer mode first.")
            return False

    print_config("Using conversation", conversation_id)

    conversation = get_conversation(conversation_id)
    if not conversation:
        print(f"  [FAIL] Conversation {conversation_id} not found!")
        return False

    print_config("Title", conversation.get("title"))
    print_config("Mode", conversation.get("mode"))

    notes = extract_notes_from_conversation(conversation)
    print_config("Notes found", len(notes))

    if not notes:
        print("  [FAIL] No notes found in conversation!")
        return False

    # Step 3: Test dialogue generation
    print_header("STEP 3: Dialogue Script Generation")
    print("  Generating dialogue script...")

    try:
        dialogue = await generate_dialogue_script(
            notes=notes[:2],  # Use first 2 notes to speed up test
            style="conversational",
        )
        print_config("Segments generated", len(dialogue))

        if not dialogue:
            print("  [FAIL] No dialogue segments generated!")
            return False

        print("  [PASS] Dialogue generation works")

    except Exception as e:
        print(f"  [FAIL] Dialogue generation error: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Step 4: Test single TTS call
    print_header("STEP 4: ElevenLabs TTS Test")
    print("  Testing TTS with short text...")

    try:
        audio_bytes, word_timings = await generate_speech_with_timestamps(
            text="Hello, this is a test.",
            voice_id=host_config["voice_id"],
            model=host_config["model"],
            voice_settings=host_config["voice_settings"],
            api_key=api_key,
        )
        print_config("Audio bytes", len(audio_bytes))
        print_config("Word timings", len(word_timings))

        if not audio_bytes:
            print("  [FAIL] No audio generated!")
            return False

        print("  [PASS] TTS works")

    except Exception as e:
        print(f"  [FAIL] TTS error: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Step 5: Create session and run full generation
    print_header("STEP 5: Full Generation Test")

    session_id = None
    try:
        print("  Creating session...")
        result = create_podcast_session(
            conversation_id=conversation_id,
            style="conversational",
        )
        session_id = result["session_id"]
        print_config("Session ID", session_id)

        print("\n  Starting audio generation...")
        print("  (Progress updates will appear below)\n")

        def progress_callback(progress: float, status: str):
            print(f"    [{progress:.1%}] {status}")

        gen_result = await generate_podcast_audio(
            session_id=session_id,
            progress_callback=progress_callback,
        )

        if gen_result.get("error"):
            print(f"\n  [FAIL] Generation error: {gen_result['error']}")
            return False

        print_config("\n  Audio path", gen_result.get("audio_path"))
        print_config("  Duration", f"{gen_result.get('duration_ms', 0) / 1000:.1f}s")

        # Verify session
        session = get_podcast_session(session_id)
        print_config("  Session status", session.get("status"))

        if session.get("status") != "ready":
            print(f"  [FAIL] Session status is {session.get('status')}, expected 'ready'")
            return False

        print("\n  [PASS] Full generation successful!")
        return True

    except Exception as e:
        print(f"\n  [FAIL] Full generation error: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup
        if session_id:
            print("\n  Cleaning up test session...")
            delete_podcast_audio(session_id)
            delete_podcast_session(session_id)


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Podcast Generation E2E Tests")
    parser.add_argument(
        "--conversation-id", "-c",
        help="Synthesizer conversation ID to use for testing"
    )
    parser.add_argument(
        "--list-conversations", "-l",
        action="store_true",
        help="List available synthesizer conversations"
    )
    args = parser.parse_args()

    if args.list_conversations:
        print_header("SYNTHESIZER CONVERSATIONS WITH NOTES")
        convs = list_synthesizer_conversations()
        if not convs:
            print("  No synthesizer conversations with notes found.")
        else:
            for conv in convs:
                print(f"\n  ID: {conv['id']}")
                print(f"  Title: {conv['title']}")
                print(f"  Notes: {conv['note_count']}")
                print(f"  Created: {conv['created_at']}")
        return

    success = asyncio.run(run_diagnostic(args.conversation_id))
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
