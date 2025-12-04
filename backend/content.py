"""Content fetching for Synthesizer mode.

Handles URL detection and content extraction from:
- YouTube videos (via transcription)
- Podcasts (via MP3 extraction and transcription)
- PDFs and arXiv papers (via Firecrawl PDF parser)
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
from .workers.podcast import is_podcast_url, transcribe_podcast

logger = logging.getLogger(__name__)

# Firecrawl API endpoints
FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"
FIRECRAWL_API_URL_V2 = "https://api.firecrawl.dev/v2/scrape"


def detect_url_type(url: str) -> str:
    """
    Detect if URL is YouTube, podcast, or a general article.

    Args:
        url: URL to analyze

    Returns:
        'youtube', 'podcast', or 'article'
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

    # Check for podcast platforms
    if is_podcast_url(url):
        return 'podcast'

    # Check for PDF or arXiv links
    if is_pdf_url(url):
        return 'pdf'

    return 'article'


def is_pdf_url(url: str) -> bool:
    """
    Detect if URL is a PDF or arXiv link.

    Args:
        url: URL to analyze

    Returns:
        True if URL is a PDF or arXiv paper
    """
    # Direct PDF links
    if url.lower().endswith('.pdf'):
        return True
    # arXiv abstract or PDF pages
    if 'arxiv.org/abs/' in url or 'arxiv.org/pdf/' in url:
        return True
    return False


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


async def fetch_podcast_content(url: str, whisper_model: str = "base") -> Dict[str, Any]:
    """
    Fetch content from a podcast episode via MP3 extraction and transcription.

    Args:
        url: Podcast episode page URL (Pocket Casts, Apple Podcasts, etc.)
        whisper_model: Whisper model to use for transcription

    Returns:
        {
            "source_type": "podcast",
            "content": str (transcript),
            "title": str,
            "description": str,
            "mp3_url": str,
            "error": Optional[str]
        }
    """
    api_key = get_firecrawl_api_key()
    if not api_key:
        return {
            "source_type": "podcast",
            "content": None,
            "title": None,
            "error": "Firecrawl API key not configured. Please add it in Settings > Integrations."
        }

    try:
        result = await transcribe_podcast(
            url=url,
            api_key=api_key,
            whisper_model=whisper_model
        )

        if result.get("error"):
            return {
                "source_type": "podcast",
                "content": None,
                "title": result.get("title"),
                "description": result.get("description"),
                "mp3_url": result.get("mp3_url"),
                "error": result["error"]
            }

        return {
            "source_type": "podcast",
            "content": result["transcript"],
            "title": result["title"],
            "description": result.get("description"),
            "mp3_url": result.get("mp3_url"),
            "error": None
        }

    except Exception as e:
        logger.error(f"Failed to fetch podcast content: {e}")
        return {
            "source_type": "podcast",
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


async def fetch_pdf_content(url: str) -> Dict[str, Any]:
    """
    Fetch PDF content using Firecrawl API with PDF parser.
    Handles both direct PDF URLs and arXiv links.

    Args:
        url: PDF URL or arXiv link

    Returns:
        {
            "source_type": "pdf",
            "content": str (markdown),
            "title": str,
            "error": Optional[str]
        }
    """
    api_key = get_firecrawl_api_key()
    if not api_key:
        return {
            "source_type": "pdf",
            "content": None,
            "title": None,
            "error": "Firecrawl API key not configured. Please add it in Settings > Integrations."
        }

    # Convert arXiv abstract URLs to PDF URLs for full paper parsing
    original_url = url
    if 'arxiv.org/abs/' in url:
        url = url.replace('/abs/', '/pdf/') + '.pdf'
        logger.info(f"Converted arXiv URL: {original_url} -> {url}")
    elif 'arxiv.org/pdf/' in url and not url.endswith('.pdf'):
        url = url + '.pdf'

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                FIRECRAWL_API_URL_V2,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "url": url,
                    "formats": ["markdown"],
                    "parsers": ["pdf"],
                    "timeout": 150000
                }
            )

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"Firecrawl API error {response.status_code}: {error_text}")
                return {
                    "source_type": "pdf",
                    "content": None,
                    "title": None,
                    "error": f"Firecrawl API error: {response.status_code}"
                }

            data = response.json()

            if not data.get("success"):
                return {
                    "source_type": "pdf",
                    "content": None,
                    "title": None,
                    "error": "Firecrawl failed to parse the PDF"
                }

            result_data = data.get("data", {})
            markdown = result_data.get("markdown", "")
            metadata = result_data.get("metadata", {})
            title = metadata.get("title", metadata.get("ogTitle", ""))

            # Try to extract title from arXiv URL if not in metadata
            if not title and 'arxiv.org' in original_url:
                title = f"arXiv Paper"

            return {
                "source_type": "pdf",
                "content": markdown,
                "title": title,
                "description": metadata.get("description", ""),
                "error": None
            }

    except httpx.TimeoutException:
        logger.error(f"Firecrawl PDF request timed out for: {url}")
        return {
            "source_type": "pdf",
            "content": None,
            "title": None,
            "error": "PDF parsing request timed out"
        }
    except Exception as e:
        logger.error(f"Failed to fetch PDF content: {e}")
        return {
            "source_type": "pdf",
            "content": None,
            "title": None,
            "error": str(e)
        }


async def fetch_content(url: str, whisper_model: str = "base") -> Dict[str, Any]:
    """
    Main entry point: detect URL type and fetch content.

    Args:
        url: URL to fetch content from
        whisper_model: Whisper model for YouTube/podcast transcription

    Returns:
        {
            "source_type": "youtube" | "podcast" | "pdf" | "article",
            "content": str (transcript or markdown),
            "title": Optional[str],
            "error": Optional[str]
        }
    """
    source_type = detect_url_type(url)

    if source_type == 'youtube':
        return await fetch_youtube_content(url, whisper_model)
    elif source_type == 'podcast':
        return await fetch_podcast_content(url, whisper_model)
    elif source_type == 'pdf':
        return await fetch_pdf_content(url)
    else:
        return await fetch_article_content(url)
