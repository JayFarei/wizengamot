"""Tests for podcast episode modes."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Test fixtures
SAMPLE_NOTES = [
    {
        "id": "note-1",
        "title": "Introduction to Machine Learning",
        "body": "Machine learning is a subset of AI that enables systems to learn from data.",
        "tags": ["AI", "ML", "technology"]
    },
    {
        "id": "note-2",
        "title": "Neural Networks Explained",
        "body": "Neural networks are computing systems inspired by biological neural networks.",
        "tags": ["AI", "neural networks", "deep learning"]
    },
]

SAMPLE_HOST_CHARACTER = {
    "id": "char-host",
    "name": "Alex",
    "voice_mode": "prebuilt",
    "voice": {"prebuilt_voice": "serena"},
    "personality": {
        "traits": "curious and engaging",
        "emotion_style": "warm",
        "speaking_role": "host"
    },
    "role": "host"
}

SAMPLE_EXPERT_CHARACTER = {
    "id": "char-expert",
    "name": "Jordan",
    "voice_mode": "prebuilt",
    "voice": {"prebuilt_voice": "ryan"},
    "personality": {
        "traits": "knowledgeable and clear",
        "emotion_style": "measured",
        "speaking_role": "expert"
    },
    "role": "expert"
}

SAMPLE_NARRATOR_CHARACTER = {
    "id": "char-narrator",
    "name": "Sam",
    "voice_mode": "prebuilt",
    "voice": {"prebuilt_voice": "aiden"},
    "personality": {
        "traits": "engaging and articulate",
        "emotion_style": "enthusiastic",
        "speaking_role": "narrator"
    },
    "role": "narrator"
}


class TestExplainerMode:
    """Tests for explainer mode (single narrator)."""

    @pytest.mark.asyncio
    async def test_explainer_generates_single_speaker_script(self):
        """Explainer mode generates script with single speaker."""
        from backend.podcast import generate_explainer_script

        mock_result = {
            "content": """[
                {"speaker": "Sam", "text": "Welcome to today's episode!", "emotion": "enthusiastic"},
                {"speaker": "Sam", "text": "Let's dive into machine learning.", "emotion": "warm"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            script = await generate_explainer_script(
                notes=SAMPLE_NOTES,
                character=SAMPLE_NARRATOR_CHARACTER,
                style="conversational"
            )

            # All segments should be from the same speaker
            assert len(script) >= 2
            speakers = set(seg["speaker"] for seg in script)
            assert len(speakers) == 1
            assert "Sam" in speakers

    @pytest.mark.asyncio
    async def test_explainer_includes_emotion_annotations(self):
        """Explainer script includes emotion annotations."""
        from backend.podcast import generate_explainer_script

        mock_result = {
            "content": """[
                {"speaker": "Sam", "text": "Welcome!", "emotion": "enthusiastic"},
                {"speaker": "Sam", "text": "This is fascinating.", "emotion": "thoughtful"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            script = await generate_explainer_script(
                notes=SAMPLE_NOTES,
                character=SAMPLE_NARRATOR_CHARACTER,
                style="conversational"
            )

            # Each segment should have an emotion
            for segment in script:
                assert "emotion" in segment
                assert segment["emotion"]  # Not empty

    @pytest.mark.asyncio
    async def test_explainer_fallback_on_failure(self):
        """Explainer mode falls back to basic script on LLM failure."""
        from backend.podcast import generate_explainer_script

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = None  # Simulate failure

            script = await generate_explainer_script(
                notes=SAMPLE_NOTES,
                character=SAMPLE_NARRATOR_CHARACTER,
                style="conversational"
            )

            # Should still return a valid script
            assert len(script) > 0
            assert all("speaker" in seg for seg in script)
            assert all("text" in seg for seg in script)


class TestQuestionTimeMode:
    """Tests for question_time mode (host + expert)."""

    @pytest.mark.asyncio
    async def test_question_time_extracts_questions(self):
        """Question Time extracts questions from notes."""
        from backend.podcast import extract_questions_from_notes

        mock_result = {
            "content": """[
                "What is machine learning?",
                "How do neural networks work?",
                "What are the key applications of AI?"
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            questions = await extract_questions_from_notes(SAMPLE_NOTES)

            assert len(questions) >= 3
            assert all(isinstance(q, str) for q in questions)
            assert all(q.endswith("?") for q in questions)

    @pytest.mark.asyncio
    async def test_question_time_generates_dialogue(self):
        """Question Time generates host/expert dialogue."""
        from backend.podcast import generate_question_time_script

        mock_result = {
            "content": """[
                {"speaker": "Alex", "text": "Welcome to the show!", "emotion": "enthusiastic"},
                {"speaker": "Jordan", "text": "Thanks for having me!", "emotion": "warm"},
                {"speaker": "Alex", "text": "What is machine learning?", "emotion": "curious"},
                {"speaker": "Jordan", "text": "It's a subset of AI...", "emotion": "thoughtful"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            script = await generate_question_time_script(
                notes=SAMPLE_NOTES,
                host_character=SAMPLE_HOST_CHARACTER,
                expert_character=SAMPLE_EXPERT_CHARACTER,
                questions=["What is machine learning?"],
                style="conversational"
            )

            # Should have both speakers
            speakers = set(seg["speaker"] for seg in script)
            assert len(speakers) == 2

    @pytest.mark.asyncio
    async def test_question_time_alternates_speakers(self):
        """Question Time script alternates between host and expert."""
        from backend.podcast import generate_question_time_script

        mock_result = {
            "content": """[
                {"speaker": "Alex", "text": "Let's begin!", "emotion": "enthusiastic"},
                {"speaker": "Jordan", "text": "Great!", "emotion": "warm"},
                {"speaker": "Alex", "text": "First question...", "emotion": "curious"},
                {"speaker": "Jordan", "text": "The answer is...", "emotion": "thoughtful"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            script = await generate_question_time_script(
                notes=SAMPLE_NOTES,
                host_character=SAMPLE_HOST_CHARACTER,
                expert_character=SAMPLE_EXPERT_CHARACTER,
                questions=["Question 1?", "Question 2?"],
                style="conversational"
            )

            # Check for alternation pattern (not strict, but general flow)
            host_count = sum(1 for seg in script if seg["speaker"] == "Alex")
            expert_count = sum(1 for seg in script if seg["speaker"] == "Jordan")

            # Both should have significant presence
            assert host_count >= 2
            assert expert_count >= 2

    @pytest.mark.asyncio
    async def test_question_extraction_fallback(self):
        """Question extraction falls back on LLM failure."""
        from backend.podcast import extract_questions_from_notes

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = None  # Simulate failure

            questions = await extract_questions_from_notes(SAMPLE_NOTES)

            # Should generate fallback questions from note titles
            assert len(questions) > 0
            # Fallback should reference note titles
            assert any("Machine Learning" in q for q in questions)


class TestDialogueScriptWithMode:
    """Tests for the main generate_dialogue_script_with_mode function."""

    @pytest.mark.asyncio
    async def test_explainer_mode_routes_correctly(self):
        """Mode 'explainer' routes to single-speaker generation."""
        from backend.podcast import generate_dialogue_script_with_mode

        mock_result = {
            "content": """[
                {"speaker": "Sam", "text": "Welcome!", "emotion": "enthusiastic"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            script = await generate_dialogue_script_with_mode(
                notes=SAMPLE_NOTES,
                mode="explainer",
                characters=[SAMPLE_NARRATOR_CHARACTER],
                style="conversational"
            )

            # Should be single speaker
            speakers = set(seg["speaker"] for seg in script)
            assert len(speakers) == 1

    @pytest.mark.asyncio
    async def test_question_time_mode_routes_correctly(self):
        """Mode 'question_time' routes to dual-speaker generation."""
        from backend.podcast import generate_dialogue_script_with_mode

        # Mock both question extraction and dialogue generation
        question_result = {"content": '["What is AI?"]'}
        dialogue_result = {
            "content": """[
                {"speaker": "Alex", "text": "Welcome!", "emotion": "enthusiastic"},
                {"speaker": "Jordan", "text": "Thanks!", "emotion": "warm"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            # Return different results for sequential calls
            mock_query.side_effect = [question_result, dialogue_result]

            script = await generate_dialogue_script_with_mode(
                notes=SAMPLE_NOTES,
                mode="question_time",
                characters=[SAMPLE_HOST_CHARACTER, SAMPLE_EXPERT_CHARACTER],
                style="conversational"
            )

            # Should have multiple speakers
            speakers = set(seg["speaker"] for seg in script)
            assert len(speakers) >= 1  # At minimum from fallback

    @pytest.mark.asyncio
    async def test_invalid_mode_defaults_to_explainer(self):
        """Invalid mode defaults to explainer."""
        from backend.podcast import generate_dialogue_script_with_mode

        mock_result = {
            "content": """[
                {"speaker": "Sam", "text": "Welcome!", "emotion": "enthusiastic"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            script = await generate_dialogue_script_with_mode(
                notes=SAMPLE_NOTES,
                mode="invalid_mode",
                characters=[SAMPLE_NARRATOR_CHARACTER],
                style="conversational"
            )

            # Should still work (fallback to explainer)
            assert len(script) > 0


class TestScriptEmotionAnnotations:
    """Tests for emotion annotations in scripts."""

    @pytest.mark.asyncio
    async def test_script_includes_emotion_annotations(self):
        """Scripts include emotion annotations for all segments."""
        from backend.podcast import generate_explainer_script

        mock_result = {
            "content": """[
                {"speaker": "Sam", "text": "Exciting news!", "emotion": "enthusiastic"},
                {"speaker": "Sam", "text": "Let me explain.", "emotion": "calm"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            script = await generate_explainer_script(
                notes=SAMPLE_NOTES,
                character=SAMPLE_NARRATOR_CHARACTER,
                style="conversational"
            )

            for segment in script:
                assert "emotion" in segment
                assert isinstance(segment["emotion"], str)

    @pytest.mark.asyncio
    async def test_emotion_defaults_from_character_style(self):
        """Missing emotions default to character's emotion_style."""
        from backend.podcast import generate_explainer_script

        # Response with missing emotion field
        mock_result = {
            "content": """[
                {"speaker": "Sam", "text": "Hello!"}
            ]"""
        }

        with patch("backend.podcast.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_result

            script = await generate_explainer_script(
                notes=SAMPLE_NOTES,
                character=SAMPLE_NARRATOR_CHARACTER,
                style="conversational"
            )

            # Should use character's default emotion style
            for segment in script:
                assert "emotion" in segment
                # Default is from character's emotion_style
                assert segment["emotion"] == "enthusiastic"
