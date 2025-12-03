"""Content fetching for Synthesizer mode.

Handles URL detection and content extraction from:
- YouTube videos (via transcription)
- Articles/blogs (via Firecrawl)
"""

import re
import logging
import asyncio
from typing import Dict, Any, Optional
from functools import partial

import httpx

from .settings import get_firecrawl_api_key
from .workers.youtube import transcribe_youtube, extract_start_time

logger = logging.getLogger(__name__)

# Firecrawl API endpoint
FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"


def detect_url_type(url: str) -> str:
    """
    Detect if URL is YouTube or a general article.

    Args:
        url: URL to analyze

    Returns:
        'youtube' or 'article'
    """
    youtube_patterns = [
        r'youtube\.com/watch',
        r'youtu\.be/',
        r'youtube\.com/shorts/',
        r'youtube\.com/live/',
        r'm\.youtube\.com/watch',
    ]

    for pattern in youtube_patterns:
        if re.search(pattern, url, re.IGNORECASE):
            return 'youtube'

    return 'article'


async def fetch_youtube_content(url: str, whisper_model: str = "base") -> Dict[str, Any]:
    """
    Fetch content from a YouTube video via transcription.

    Args:
        url: YouTube video URL
        whisper_model: Whisper model to use for transcription

    Returns:
        {
            "source_type": "youtube",
            "content": str (transcript),
            "title": str,
            "error": Optional[str]
        }
    """
    try:
        # Check for start time in URL
        start_seconds = extract_start_time(url)

        # Run synchronous transcription in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                transcribe_youtube,
                url=url,
                whisper_model=whisper_model,
                start_seconds=start_seconds
            )
        )

        return {
            "source_type": "youtube",
            "content": result["transcript"],
            "title": result["title"],
            "duration": result.get("duration"),
            "channel": result.get("channel"),
            "error": None
        }

    except Exception as e:
        logger.error(f"Failed to fetch YouTube content: {e}")
        return {
            "source_type": "youtube",
            "content": None,
            "title": None,
            "error": str(e)
        }


async def fetch_article_content(url: str) -> Dict[str, Any]:
    """
    Fetch article content using Firecrawl API.

    Args:
        url: Article URL

    Returns:
        {
            "source_type": "article",
            "content": str (markdown),
            "title": str,
            "error": Optional[str]
        }
    """
    api_key = get_firecrawl_api_key()
    if not api_key:
        return {
            "source_type": "article",
            "content": None,
            "title": None,
            "error": "Firecrawl API key not configured. Please add it in Settings > Integrations."
        }

    try:
        # Firecrawl can take a while for some pages, use longer timeout
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                FIRECRAWL_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "url": url,
                    "formats": ["markdown"],
                    "timeout": 90000  # Tell Firecrawl to wait up to 90 seconds
                }
            )

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"Firecrawl API error {response.status_code}: {error_text}")
                return {
                    "source_type": "article",
                    "content": None,
                    "title": None,
                    "error": f"Firecrawl API error: {response.status_code}"
                }

            data = response.json()

            if not data.get("success"):
                return {
                    "source_type": "article",
                    "content": None,
                    "title": None,
                    "error": "Firecrawl failed to scrape the URL"
                }

            result_data = data.get("data", {})
            markdown = result_data.get("markdown", "")
            metadata = result_data.get("metadata", {})
            title = metadata.get("title", metadata.get("ogTitle", ""))

            return {
                "source_type": "article",
                "content": markdown,
                "title": title,
                "description": metadata.get("description", ""),
                "error": None
            }

    except httpx.TimeoutException:
        logger.error(f"Firecrawl request timed out for: {url}")
        return {
            "source_type": "article",
            "content": None,
            "title": None,
            "error": "Request timed out"
        }
    except Exception as e:
        logger.error(f"Failed to fetch article content: {e}")
        return {
            "source_type": "article",
            "content": None,
            "title": None,
            "error": str(e)
        }


async def fetch_content(url: str, whisper_model: str = "base") -> Dict[str, Any]:
    """
    Main entry point: detect URL type and fetch content.

    Args:
        url: URL to fetch content from
        whisper_model: Whisper model for YouTube transcription

    Returns:
        {
            "source_type": "youtube" | "article",
            "content": str (transcript or markdown),
            "title": Optional[str],
            "error": Optional[str]
        }
    """
    source_type = detect_url_type(url)

    if source_type == 'youtube':
        return await fetch_youtube_content(url, whisper_model)
    else:
        return await fetch_article_content(url)
