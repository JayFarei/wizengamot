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
from backend.podcast_qwen import (
    generate_single_audio,
    get_podcast_audio_path,
    delete_podcast_audio,
    check_tts_service,
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
    """E2E tests for podcast generation using Qwen3-TTS service."""

    session_id: Optional[str] = None
    conversation_id: Optional[str] = None
    notes: List[Dict[str, Any]] = []

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures."""
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

        # Qwen3-TTS service health
        tts_health = await check_tts_service()
        print_config("TTS Service Healthy", tts_health.get("healthy"))
        print_config("TTS Service Details", tts_health.get("details"))

        if not tts_health.get("healthy"):
            pytest.skip("Qwen3-TTS service not available")

        # Synthesizer model (for dialogue generation)
        synth_model = get_synthesizer_model()
        print_config("\n  Synthesizer Model", synth_model)
        assert synth_model, "Synthesizer model not configured"

        # Full podcast settings
        settings = get_podcast_settings()
        print("\n  Podcast Settings Status:")
        print_config("    podcast_configured", settings.get("podcast_configured"))

        print("\n  [PASS] All configuration verified")

    @pytest.mark.asyncio
    async def test_02_validate_tts_service(self):
        """Verify Qwen3-TTS service is accessible."""
        print_header("TEST 2: Validate TTS Service")

        tts_health = await check_tts_service()
        print_config("Service Healthy", tts_health.get("healthy"))

        if tts_health.get("healthy"):
            details = tts_health.get("details", {})
            print_config("Service Name", details.get("service"))
            print_config("Version", details.get("version"))
            print_config("Model Loaded", details.get("model_loaded"))
            print("  [OK] TTS service accessible")
        else:
            print(f"  [WARN] TTS service not healthy: {tts_health.get('details')}")

        print("\n  [PASS] TTS service validation complete")

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

        # Check TTS service is available
        tts_health = await check_tts_service()
        if not tts_health.get("healthy"):
            pytest.skip("Qwen3-TTS service not available")

        # Use a default character config for testing
        test_character = {
            "name": "TestHost",
            "voice_mode": "prebuilt",
            "voice": {"prebuilt_voice": "serena"},
            "personality": {"emotion_style": "warm"}
        }

        test_text = "Hello, welcome to our podcast. Today we'll be discussing some fascinating topics."
        print_config("Test text", test_text[:50] + "...")
        print_config("Voice mode", test_character.get("voice_mode"))
        print_config("Voice ID", test_character["voice"]["prebuilt_voice"])

        try:
            print("\n  Calling generate_single_audio()...")

            audio_bytes, word_timings, duration_ms = await generate_single_audio(
                text=test_text,
                character=test_character,
                emotion="warm",
            )

            print_config("Audio bytes", len(audio_bytes))
            print_config("Word timings", len(word_timings))
            print_config("Duration (ms)", duration_ms)

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

    # Check Qwen3-TTS service
    tts_health = await check_tts_service()
    print_config("TTS Service Healthy", tts_health.get("healthy"))
    if not tts_health.get("healthy"):
        print(f"  [FAIL] Qwen3-TTS service not available!")
        print(f"  Details: {tts_health.get('details')}")
        print("  Start the TTS service with: cd services/qwen3-tts && python server.py")
        return False

    details = tts_health.get("details", {})
    print_config("TTS Service", details.get("service"))
    print_config("TTS Version", details.get("version"))
    print_config("Model Loaded", details.get("model_loaded"))

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
    print_header("STEP 4: Qwen3-TTS Test")
    print("  Testing TTS with short text...")

    test_character = {
        "name": "TestHost",
        "voice_mode": "prebuilt",
        "voice": {"prebuilt_voice": "serena"},
        "personality": {"emotion_style": "warm"}
    }

    try:
        audio_bytes, word_timings, duration_ms = await generate_single_audio(
            text="Hello, this is a test.",
            character=test_character,
            emotion="warm",
        )
        print_config("Audio bytes", len(audio_bytes))
        print_config("Word timings", len(word_timings))
        print_config("Duration (ms)", duration_ms)

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
