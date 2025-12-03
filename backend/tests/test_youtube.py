"""Test YouTube transcription functionality."""

import asyncio
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.workers.youtube import transcribe_youtube, extract_start_time
from backend.content import fetch_youtube_content, detect_url_type


def test_url_detection():
    """Test URL type detection."""
    print("Testing URL detection...")
    assert detect_url_type("https://www.youtube.com/watch?v=B_WtuOIJf50") == "youtube"
    assert detect_url_type("https://youtu.be/B_WtuOIJf50") == "youtube"
    assert detect_url_type("https://www.youtube.com/shorts/abc123") == "youtube"
    assert detect_url_type("https://example.com/article") == "article"
    print("  OK")


def test_start_time_extraction():
    """Test YouTube start time extraction from URL."""
    print("Testing start time extraction...")
    assert extract_start_time("https://youtube.com/watch?v=abc&t=123") == 123
    assert extract_start_time("https://youtube.com/watch?v=abc&t=123s") == 123
    assert extract_start_time("https://youtube.com/watch?v=abc&t=2m30s") == 150
    assert extract_start_time("https://youtube.com/watch?v=abc&t=1h2m30s") == 3750
    assert extract_start_time("https://youtube.com/watch?v=abc") is None
    print("  OK")


def test_transcription():
    """Test YouTube transcription - downloads and transcribes."""
    print("Testing YouTube transcription (this may take a while)...")
    url = "https://www.youtube.com/watch?v=B_WtuOIJf50"

    try:
        result = transcribe_youtube(url, whisper_model="tiny")

        assert "transcript" in result
        assert "title" in result
        assert result["transcript"] is not None
        assert len(result["transcript"]) > 0

        print(f"  Title: {result['title']}")
        print(f"  Duration: {result.get('duration', 'N/A')}s")
        print(f"  Channel: {result.get('channel', 'N/A')}")
        print(f"  Transcript length: {len(result['transcript'])} chars")
        print(f"  Transcript preview: {result['transcript'][:200]}...")
        print("  OK")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_async_fetch():
    """Test the async content fetching."""
    print("Testing async fetch...")
    url = "https://www.youtube.com/watch?v=B_WtuOIJf50"

    try:
        result = await fetch_youtube_content(url, whisper_model="tiny")

        assert result["source_type"] == "youtube"
        if result["error"]:
            print(f"  FAILED: {result['error']}")
            return False

        assert result["content"] is not None
        assert len(result["content"]) > 0

        print(f"  Title: {result['title']}")
        print(f"  Content length: {len(result['content'])} chars")
        print("  OK")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("YouTube Transcription Tests")
    print("=" * 60)

    test_url_detection()
    test_start_time_extraction()

    # Run the actual transcription test
    if test_transcription():
        # Only test async if sync works
        print("\n" + "-" * 60)
        asyncio.run(test_async_fetch())

    print("\n" + "=" * 60)
    print("Done!")
