"""
Tests for podcast note discovery functionality.

Run with:
    uv run pytest backend/tests/test_podcast_discovery.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class TestDiscoverRelevantNotes:
    """Tests for the discover_relevant_notes function."""

    @pytest.mark.asyncio
    async def test_discover_notes_by_topic(self):
        """Finds relevant notes from knowledge graph based on topic."""
        from backend.podcast import discover_relevant_notes

        # Mock the search module to return synthesizer conversations
        mock_search_results = [
            {
                "id": "conv-1",
                "title": "AI Research Notes",
                "score": 0.85,
                "similarity": 0.9,
                "mode": "synthesizer"
            },
            {
                "id": "conv-2",
                "title": "Machine Learning Guide",
                "score": 0.75,
                "similarity": 0.8,
                "mode": "synthesizer"
            },
            {
                "id": "conv-3",
                "title": "Council Discussion",
                "score": 0.70,
                "similarity": 0.75,
                "mode": "council"  # Should be filtered out
            }
        ]

        mock_conversation_1 = {
            "id": "conv-1",
            "mode": "synthesizer",
            "messages": [
                {
                    "role": "assistant",
                    "source_url": "https://example.com/ai-video",
                    "source_title": "AI Video",
                    "notes": [
                        {
                            "id": "note-1",
                            "title": "Neural Networks Basics",
                            "body": "Neural networks are computational models...",
                            "tags": ["#ai", "#ml"]
                        }
                    ]
                }
            ]
        }

        mock_conversation_2 = {
            "id": "conv-2",
            "mode": "synthesizer",
            "messages": [
                {
                    "role": "assistant",
                    "source_url": "https://example.com/ml-guide",
                    "source_title": "ML Guide",
                    "notes": [
                        {
                            "id": "note-2",
                            "title": "Gradient Descent",
                            "body": "Gradient descent is an optimization algorithm...",
                            "tags": ["#ml", "#optimization"]
                        }
                    ]
                }
            ]
        }

        def get_conv_side_effect(conv_id):
            if conv_id == "conv-1":
                return mock_conversation_1
            elif conv_id == "conv-2":
                return mock_conversation_2
            return None

        with patch('backend.search.search', return_value=mock_search_results) as mock_search, \
             patch('backend.storage.get_conversation', side_effect=get_conv_side_effect):

            # Call the function
            result = await discover_relevant_notes("artificial intelligence", limit=10)

            # Verify search was called with correct parameters
            mock_search.assert_called_once_with("artificial intelligence", limit=30)

            # Should only return notes from synthesizer conversations
            assert len(result) == 2
            assert result[0]["title"] == "Neural Networks Basics"
            assert result[1]["title"] == "Gradient Descent"

    @pytest.mark.asyncio
    async def test_discover_notes_returns_full_content(self):
        """Returns note body, not just metadata."""
        from backend.podcast import discover_relevant_notes

        mock_search_results = [
            {
                "id": "conv-1",
                "title": "Test Notes",
                "score": 0.9,
                "similarity": 0.95,
                "mode": "synthesizer"
            }
        ]

        mock_conversation = {
            "id": "conv-1",
            "mode": "synthesizer",
            "messages": [
                {
                    "role": "assistant",
                    "source_url": "https://example.com/test",
                    "source_title": "Test Source",
                    "notes": [
                        {
                            "id": "note-1",
                            "title": "Test Note Title",
                            "body": "This is the full body content of the note that should be returned.",
                            "tags": ["#test", "#example"]
                        }
                    ]
                }
            ]
        }

        with patch('backend.search.search', return_value=mock_search_results), \
             patch('backend.storage.get_conversation', return_value=mock_conversation):

            result = await discover_relevant_notes("test topic", limit=10)

            # Verify full content is returned
            assert len(result) == 1
            note = result[0]
            assert note["id"] == "note-1"
            assert note["title"] == "Test Note Title"
            assert note["body"] == "This is the full body content of the note that should be returned."
            assert note["tags"] == ["#test", "#example"]
            assert note["source_url"] == "https://example.com/test"
            assert note["source_title"] == "Test Source"
            assert note["conversation_id"] == "conv-1"
            assert note["score"] == 0.9
            assert note["similarity"] == 0.95

    @pytest.mark.asyncio
    async def test_discover_notes_respects_limit(self):
        """Limits results to requested count."""
        from backend.podcast import discover_relevant_notes

        # Create many mock results
        mock_search_results = [
            {
                "id": f"conv-{i}",
                "title": f"Notes {i}",
                "score": 0.9 - (i * 0.05),
                "similarity": 0.95 - (i * 0.05),
                "mode": "synthesizer"
            }
            for i in range(10)
        ]

        def make_mock_conversation(conv_id):
            return {
                "id": conv_id,
                "mode": "synthesizer",
                "messages": [
                    {
                        "role": "assistant",
                        "source_url": f"https://example.com/{conv_id}",
                        "notes": [
                            {
                                "id": f"note-{conv_id}",
                                "title": f"Note from {conv_id}",
                                "body": f"Body of note from {conv_id}",
                                "tags": ["#test"]
                            }
                        ]
                    }
                ]
            }

        with patch('backend.search.search', return_value=mock_search_results), \
             patch('backend.storage.get_conversation', side_effect=make_mock_conversation):

            # Request only 3 results
            result = await discover_relevant_notes("test topic", limit=3)

            # Should only return 3 notes
            assert len(result) == 3

    @pytest.mark.asyncio
    async def test_discover_notes_empty_topic(self):
        """Returns empty list for empty topic."""
        from backend.podcast import discover_relevant_notes

        result = await discover_relevant_notes("", limit=10)
        assert result == []

        result = await discover_relevant_notes("   ", limit=10)
        assert result == []

    @pytest.mark.asyncio
    async def test_discover_notes_no_results(self):
        """Returns empty list when no matching notes found."""
        from backend.podcast import discover_relevant_notes

        with patch('backend.search.search', return_value=[]):
            result = await discover_relevant_notes("obscure topic", limit=10)
            assert result == []

    @pytest.mark.asyncio
    async def test_discover_notes_filters_non_synthesizer(self):
        """Filters out non-synthesizer conversations."""
        from backend.podcast import discover_relevant_notes

        mock_search_results = [
            {
                "id": "council-conv",
                "title": "Council Discussion",
                "score": 0.95,
                "similarity": 0.98,
                "mode": "council"
            },
            {
                "id": "monitor-conv",
                "title": "Monitor Results",
                "score": 0.90,
                "similarity": 0.93,
                "mode": "monitor"
            },
            {
                "id": "synth-conv",
                "title": "Synthesizer Notes",
                "score": 0.85,
                "similarity": 0.88,
                "mode": "synthesizer"
            }
        ]

        mock_conversation = {
            "id": "synth-conv",
            "mode": "synthesizer",
            "messages": [
                {
                    "role": "assistant",
                    "source_url": "https://example.com/test",
                    "notes": [
                        {
                            "id": "note-1",
                            "title": "Real Note",
                            "body": "This note should be returned",
                            "tags": []
                        }
                    ]
                }
            ]
        }

        with patch('backend.search.search', return_value=mock_search_results), \
             patch('backend.storage.get_conversation', return_value=mock_conversation):

            result = await discover_relevant_notes("test", limit=10)

            # Only the synthesizer conversation's notes should be returned
            assert len(result) == 1
            assert result[0]["conversation_id"] == "synth-conv"

    @pytest.mark.asyncio
    async def test_discover_notes_multiple_notes_per_conversation(self):
        """Handles conversations with multiple notes."""
        from backend.podcast import discover_relevant_notes

        mock_search_results = [
            {
                "id": "conv-1",
                "title": "Multi-Note Conversation",
                "score": 0.9,
                "similarity": 0.95,
                "mode": "synthesizer"
            }
        ]

        mock_conversation = {
            "id": "conv-1",
            "mode": "synthesizer",
            "messages": [
                {
                    "role": "assistant",
                    "source_url": "https://example.com/test",
                    "notes": [
                        {
                            "id": "note-1",
                            "title": "First Note",
                            "body": "First note body",
                            "tags": ["#first"]
                        },
                        {
                            "id": "note-2",
                            "title": "Second Note",
                            "body": "Second note body",
                            "tags": ["#second"]
                        },
                        {
                            "id": "note-3",
                            "title": "Third Note",
                            "body": "Third note body",
                            "tags": ["#third"]
                        }
                    ]
                }
            ]
        }

        with patch('backend.search.search', return_value=mock_search_results), \
             patch('backend.storage.get_conversation', return_value=mock_conversation):

            result = await discover_relevant_notes("test", limit=10)

            # All three notes should be returned
            assert len(result) == 3
            titles = [n["title"] for n in result]
            assert "First Note" in titles
            assert "Second Note" in titles
            assert "Third Note" in titles
