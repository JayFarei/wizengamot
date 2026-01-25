"""
Debug test for podcast generation with real conversation.

This test generates a podcast from the AGI Timeline Accelerants notes
with detailed logging to identify where failures occur.

Run with:
    uv run pytest backend/tests/test_podcast_generation_debug.py -v -s
"""

import asyncio
import logging
import sys
import time
from pathlib import Path

import pytest

# Ensure we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Configure detailed logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler()]
)

logger = logging.getLogger(__name__)

# The AGI Timeline Accelerants conversation ID
TEST_CONVERSATION_ID = "2acec617-37cc-490b-a54d-59dc5b8cf718"


class TestPodcastGenerationDebug:
    """Debug tests for podcast generation pipeline."""

    @pytest.mark.asyncio
    async def test_tts_service_health(self):
        """Step 1: Verify TTS service is healthy and responding."""
        from backend.podcast_qwen import check_tts_service

        logger.info("=" * 60)
        logger.info("STEP 1: Checking TTS service health")
        logger.info("=" * 60)

        start = time.time()
        result = await check_tts_service()
        elapsed = time.time() - start

        logger.info(f"Health check completed in {elapsed:.2f}s")
        logger.info(f"Result: {result}")

        assert result["healthy"], f"TTS service not healthy: {result['details']}"
        logger.info("TTS service is healthy")

    @pytest.mark.asyncio
    async def test_load_conversation_notes(self):
        """Step 2: Load notes from the test conversation."""
        from backend.storage import get_conversation

        logger.info("=" * 60)
        logger.info("STEP 2: Loading conversation notes")
        logger.info("=" * 60)

        conversation = get_conversation(TEST_CONVERSATION_ID)
        assert conversation is not None, f"Conversation {TEST_CONVERSATION_ID} not found"

        logger.info(f"Title: {conversation.get('title')}")
        logger.info(f"Mode: {conversation.get('mode')}")

        # Extract notes from messages
        notes = []
        for msg in conversation.get("messages", []):
            if msg.get("role") == "assistant":
                msg_notes = msg.get("notes", [])
                notes.extend(msg_notes)

        logger.info(f"Found {len(notes)} notes")
        for i, note in enumerate(notes):
            logger.info(f"  Note {i+1}: {note.get('title', 'Untitled')[:50]}")
            body_preview = note.get('body', '')[:100].replace('\n', ' ')
            logger.info(f"    Body preview: {body_preview}...")

        assert len(notes) > 0, "No notes found in conversation"
        return notes

    def test_create_podcast_session(self):
        """Step 3: Create a podcast session with test configuration."""
        from backend.podcast import create_podcast_session

        logger.info("=" * 60)
        logger.info("STEP 3: Creating podcast session")
        logger.info("=" * 60)

        session = create_podcast_session(
            conversation_id=TEST_CONVERSATION_ID,
            style="conversational"
        )

        logger.info(f"Session ID: {session.get('session_id')}")
        logger.info(f"Status: {session.get('status')}")
        logger.info(f"Title: {session.get('title')}")
        logger.info(f"Note count: {session.get('note_count')}")

        assert session.get("session_id"), "No session ID returned"
        return session

    @pytest.mark.asyncio
    async def test_generate_script(self):
        """Step 4: Generate podcast script (dialogue generation)."""
        from backend.podcast import create_podcast_session, generate_podcast_audio

        logger.info("=" * 60)
        logger.info("STEP 4: Generating podcast (script + audio)")
        logger.info("=" * 60)

        # Create session first
        session = create_podcast_session(
            conversation_id=TEST_CONVERSATION_ID,
            style="conversational"
        )
        session_id = session["session_id"]
        logger.info(f"Session ID: {session_id}")
        logger.info(f"Title: {session.get('title')}")

        # generate_podcast_audio does both script and audio
        start = time.time()

        def progress_callback(progress, message):
            elapsed = time.time() - start
            logger.info(f"  Progress: {progress*100:.0f}% - {message} (elapsed: {elapsed:.1f}s)")

        try:
            result = await generate_podcast_audio(session_id, progress_callback=progress_callback)
            elapsed = time.time() - start

            logger.info(f"Generation completed in {elapsed:.2f}s")

            if result.get("error"):
                logger.error(f"Generation error: {result['error']}")
                pytest.fail(f"Generation failed: {result['error']}")

            dialogue = result.get("dialogue_segments", [])
            logger.info(f"Generated {len(dialogue)} dialogue segments")
            logger.info(f"Audio path: {result.get('audio_path')}")
            logger.info(f"Duration: {result.get('duration_ms')}ms")

        except Exception as e:
            elapsed = time.time() - start
            logger.error(f"FAILED after {elapsed:.2f}s: {type(e).__name__}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise

    @pytest.mark.asyncio
    async def test_generate_single_segment_audio(self):
        """Step 5: Test generating audio for a single short segment."""
        from backend.podcast_qwen import generate_single_audio

        logger.info("=" * 60)
        logger.info("STEP 5: Testing single segment audio generation")
        logger.info("=" * 60)

        # Simple test segment
        test_text = "Hello, and welcome to this podcast. Today we'll be discussing AI timelines."
        character = {
            "voice_mode": "prebuilt",
            "voice": {"prebuilt_voice": "aiden"}
        }

        logger.info(f"Test text: {test_text}")
        logger.info(f"Character config: {character}")

        start = time.time()
        try:
            audio_bytes, word_timings, duration_ms = await generate_single_audio(
                text=test_text,
                character=character,
                emotion="neutral"
            )
            elapsed = time.time() - start

            logger.info(f"Single segment completed in {elapsed:.2f}s")
            logger.info(f"Audio size: {len(audio_bytes)} bytes")
            logger.info(f"Duration: {duration_ms}ms")
            logger.info(f"Word timings count: {len(word_timings)}")

            assert len(audio_bytes) > 0, "No audio generated"

        except Exception as e:
            elapsed = time.time() - start
            logger.error(f"Single segment FAILED after {elapsed:.2f}s")
            logger.error(f"Error: {type(e).__name__}: {e}")
            raise

    @pytest.mark.asyncio
    async def test_full_podcast_generation(self):
        """Step 6: Full end-to-end podcast generation with detailed timing."""
        from backend.podcast import create_podcast_session, generate_podcast_audio

        logger.info("=" * 60)
        logger.info("STEP 6: Full podcast generation (script + audio)")
        logger.info("=" * 60)

        # Create session - simple API: just conversation_id and style
        session = create_podcast_session(
            conversation_id=TEST_CONVERSATION_ID,
            style="conversational"
        )
        session_id = session["session_id"]  # Note: returns session_id not id
        logger.info(f"Session ID: {session_id}")
        logger.info(f"Title: {session.get('title')}")
        logger.info(f"Note count: {session.get('note_count')}")

        # generate_podcast_audio does both script and TTS
        start = time.time()
        last_progress_time = [time.time()]

        def progress_callback(progress, message):
            now = time.time()
            elapsed_since_last = now - last_progress_time[0]
            total_elapsed = now - start
            logger.info(f"  {progress*100:.0f}% - {message} (elapsed: {total_elapsed:.1f}s, delta: {elapsed_since_last:.1f}s)")
            last_progress_time[0] = now

        try:
            result = await generate_podcast_audio(session_id, progress_callback=progress_callback)
            elapsed = time.time() - start

            if result.get("error"):
                logger.error(f"Generation error: {result['error']}")
                pytest.fail(f"Generation failed: {result['error']}")

            logger.info("=" * 60)
            logger.info(f"SUCCESS in {elapsed:.2f}s")
            logger.info(f"Audio path: {result.get('audio_path')}")
            logger.info(f"Duration: {result.get('duration_ms')}ms")
            logger.info(f"Dialogue segments: {len(result.get('dialogue_segments', []))}")
            logger.info(f"Word timings: {len(result.get('word_timings', []))} entries")
            logger.info("=" * 60)

        except Exception as e:
            elapsed = time.time() - start
            logger.error("=" * 60)
            logger.error(f"FAILED after {elapsed:.2f}s")
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Error message: {e}")
            logger.error("=" * 60)

            import traceback
            logger.error("Full traceback:")
            logger.error(traceback.format_exc())

            raise


    @pytest.mark.asyncio
    async def test_tts_with_mock_dialogue(self):
        """Step 7: Test TTS with mock dialogue segments (bypasses LLM script generation)."""
        from backend.podcast_qwen import generate_podcast_audio as generate_audio_qwen

        logger.info("=" * 60)
        logger.info("STEP 7: Testing TTS with mock dialogue (bypass script gen)")
        logger.info("=" * 60)

        # Mock dialogue segments that simulate what script generation produces
        # Using multiple segments to simulate a real podcast
        dialogue_segments = [
            {"speaker": "Narrator", "text": "Welcome to our podcast. Today we're exploring the fascinating topic of AGI timeline accelerants.", "emotion": "enthusiastic"},
            {"speaker": "Narrator", "text": "There are several key factors that could speed up the development of artificial general intelligence.", "emotion": "thoughtful"},
            {"speaker": "Narrator", "text": "First, let's consider the role of compute scaling. More powerful hardware enables larger models.", "emotion": "explanatory"},
            {"speaker": "Narrator", "text": "Second, algorithmic improvements continue to deliver efficiency gains, sometimes surpassing hardware advances.", "emotion": "analytical"},
            {"speaker": "Narrator", "text": "Third, data quality and curation have emerged as crucial factors in model capability.", "emotion": "measured"},
            {"speaker": "Narrator", "text": "The intersection of these factors creates interesting dynamics in AGI development timelines.", "emotion": "thoughtful"},
            {"speaker": "Narrator", "text": "Thank you for listening to this episode. Until next time.", "emotion": "warm"},
        ]

        # Mock character config
        characters = {
            "Narrator": {
                "name": "Narrator",
                "voice_mode": "prebuilt",
                "voice": {"prebuilt_voice": "aiden"}
            }
        }

        logger.info(f"Dialogue segments: {len(dialogue_segments)}")
        total_chars = sum(len(seg['text']) for seg in dialogue_segments)
        logger.info(f"Total text length: {total_chars} characters")

        start = time.time()
        last_progress_time = [time.time()]

        def progress_callback(progress, message):
            now = time.time()
            elapsed = now - start
            delta = now - last_progress_time[0]
            logger.info(f"  TTS: {progress*100:.0f}% - {message} (elapsed: {elapsed:.1f}s, delta: {delta:.1f}s)")
            last_progress_time[0] = now

        try:
            audio_bytes, word_timings, duration_ms = await generate_audio_qwen(
                dialogue_segments=dialogue_segments,
                characters=characters,
                progress_callback=progress_callback,
            )
            elapsed = time.time() - start

            logger.info("=" * 60)
            logger.info(f"TTS SUCCESS in {elapsed:.2f}s")
            logger.info(f"Audio size: {len(audio_bytes)} bytes")
            logger.info(f"Duration: {duration_ms}ms ({duration_ms/1000:.1f}s)")
            logger.info(f"Word timings: {len(word_timings)} entries")
            logger.info("=" * 60)

            assert len(audio_bytes) > 0, "No audio generated"

        except Exception as e:
            elapsed = time.time() - start
            logger.error("=" * 60)
            logger.error(f"TTS FAILED after {elapsed:.2f}s")
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Error message: {e}")
            logger.error("=" * 60)

            import traceback
            logger.error("Full traceback:")
            logger.error(traceback.format_exc())

            raise


if __name__ == "__main__":
    # Run with: python -m pytest backend/tests/test_podcast_generation_debug.py -v -s
    pytest.main([__file__, "-v", "-s"])
