"""Podcast transcription worker using Firecrawl, feedparser, and Whisper.

Extracts MP3 URLs from podcast episode pages (Pocket Casts, etc.) and transcribes them.
"""

import re
import tempfile
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse

import httpx
import whisper

logger = logging.getLogger(__name__)

# Known podcast platform patterns
PODCAST_PATTERNS = [
    r'pca\.st/episode/',           # Pocket Casts
    r'podcasts\.apple\.com/',      # Apple Podcasts
    r'open\.spotify\.com/episode/', # Spotify (note: may not have direct MP3)
    r'overcast\.fm/',              # Overcast
    r'castro\.fm/',                # Castro
    r'podcast\.app/',              # Generic podcast apps
]


def is_podcast_url(url: str) -> bool:
    """Check if URL is from a known podcast platform."""
    for pattern in PODCAST_PATTERNS:
        if re.search(pattern, url, re.IGNORECASE):
            return True
    return False


async def scrape_page_html(url: str, api_key: str) -> Optional[str]:
    """
    Scrape a page using Firecrawl and return raw HTML.

    Args:
        url: Page URL to scrape
        api_key: Firecrawl API key

    Returns:
        Raw HTML string or None on failure
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            "https://api.firecrawl.dev/v1/scrape",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "url": url,
                "formats": ["rawHtml"],
                "onlyMainContent": False,  # We need script tags and metadata
                "timeout": 90000
            }
        )

        if response.status_code != 200:
            logger.error(f"Firecrawl API error {response.status_code}: {response.text}")
            return None

        data = response.json()

        if not data.get("success"):
            logger.error("Firecrawl failed to scrape URL")
            return None

        return data.get("data", {}).get("rawHtml", "")


def extract_mp3_urls(html: str) -> List[str]:
    """
    Extract MP3 URLs from HTML content.

    Args:
        html: Raw HTML string

    Returns:
        List of unique MP3 URLs found
    """
    import html as html_module

    # Find all URLs ending in .mp3 (with optional query params)
    mp3_pattern = r'https?://[^\s"\'<>]+\.mp3(?:\?[^\s"\'<>]*)?'
    urls = re.findall(mp3_pattern, html, re.IGNORECASE)

    # Deduplicate while preserving order
    seen = set()
    unique_urls = []
    for url in urls:
        # Clean up escaped characters
        url = url.replace('\\u002F', '/').replace('\\/', '/')
        # Decode HTML entities (e.g., &amp; -> &)
        url = html_module.unescape(url)
        if url not in seen:
            seen.add(url)
            unique_urls.append(url)

    return unique_urls


def extract_rss_feed_url(html: str) -> Optional[str]:
    """
    Extract RSS feed URL from HTML link tags.

    Args:
        html: Raw HTML string

    Returns:
        RSS feed URL or None if not found
    """
    # Look for RSS link tag
    rss_pattern = r'<link[^>]+type=["\']application/rss\+xml["\'][^>]+href=["\']([^"\']+)["\']'
    match = re.search(rss_pattern, html, re.IGNORECASE)

    if match:
        return match.group(1)

    # Also try reverse order (href before type)
    rss_pattern_alt = r'<link[^>]+href=["\']([^"\']+)["\'][^>]+type=["\']application/rss\+xml["\']'
    match = re.search(rss_pattern_alt, html, re.IGNORECASE)

    if match:
        return match.group(1)

    return None


def extract_episode_metadata(html: str) -> Dict[str, str]:
    """
    Extract episode metadata from HTML (title, description, etc.).

    Args:
        html: Raw HTML string

    Returns:
        Dict with title, description, etc.
    """
    metadata = {}

    # Try og:title first
    og_title = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
    if og_title:
        metadata['title'] = og_title.group(1)

    # Fallback to <title> tag
    if 'title' not in metadata:
        title_match = re.search(r'<title>([^<]+)</title>', html, re.IGNORECASE)
        if title_match:
            metadata['title'] = title_match.group(1)

    # Try og:description
    og_desc = re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
    if og_desc:
        metadata['description'] = og_desc.group(1)

    return metadata


async def find_mp3_from_rss(rss_url: str, episode_identifier: str) -> Optional[str]:
    """
    Parse RSS feed to find MP3 URL for a specific episode.

    Args:
        rss_url: RSS feed URL
        episode_identifier: Part of episode URL/ID to match

    Returns:
        MP3 URL or None if not found
    """
    try:
        import feedparser
    except ImportError:
        logger.warning("feedparser not installed, RSS fallback unavailable")
        return None

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(rss_url)
        if response.status_code != 200:
            logger.error(f"Failed to fetch RSS feed: {response.status_code}")
            return None

        feed = feedparser.parse(response.text)

        for entry in feed.entries:
            # Check if this entry matches our episode
            entry_link = entry.get('link', '')
            entry_id = entry.get('id', '')

            if episode_identifier in entry_link or episode_identifier in entry_id:
                # Found the episode, get enclosure URL
                if hasattr(entry, 'enclosures') and entry.enclosures:
                    for enclosure in entry.enclosures:
                        if enclosure.get('type', '').startswith('audio/'):
                            return enclosure.get('href')
                break

        # If no exact match, try title matching or just return first audio enclosure
        logger.warning("Could not find exact episode match in RSS, trying fuzzy match")

        for entry in feed.entries:
            if hasattr(entry, 'enclosures') and entry.enclosures:
                for enclosure in entry.enclosures:
                    if enclosure.get('type', '').startswith('audio/'):
                        return enclosure.get('href')

    return None


def score_mp3_url(url: str) -> int:
    """
    Score an MP3 URL based on likelihood of being the episode audio.
    Higher score = more likely to be the right URL.

    Args:
        url: MP3 URL to score

    Returns:
        Integer score (higher is better)
    """
    score = 0
    url_lower = url.lower()

    # Positive signals
    if 'cdn' in url_lower:
        score += 10
    if 'media' in url_lower:
        score += 5
    if 'audio' in url_lower:
        score += 5
    if 'podcast' in url_lower:
        score += 10
    if 'episode' in url_lower:
        score += 5
    if 'mp3' in url_lower:
        score += 3

    # Negative signals
    if 'preview' in url_lower:
        score -= 20
    if 'sample' in url_lower:
        score -= 20
    if 'trailer' in url_lower:
        score -= 10
    if 'ad' in url_lower and 'load' not in url_lower:
        score -= 5

    # Length heuristic: longer URLs often have more specific episode info
    if len(url) > 100:
        score += 2

    return score


async def extract_podcast_mp3(url: str, api_key: str) -> Dict[str, Any]:
    """
    Extract MP3 URL from a podcast episode page.

    Strategy:
    1. Scrape page with Firecrawl (raw HTML)
    2. Look for .mp3 URLs directly in HTML
    3. If multiple found, score and pick best one
    4. If none found, try RSS feed fallback

    Args:
        url: Podcast episode page URL
        api_key: Firecrawl API key

    Returns:
        {
            "mp3_url": str or None,
            "title": str,
            "description": str,
            "error": str or None
        }
    """
    logger.info(f"Extracting MP3 from podcast URL: {url}")

    # 1. Scrape the page
    html = await scrape_page_html(url, api_key)

    if not html:
        return {
            "mp3_url": None,
            "title": None,
            "description": None,
            "error": "Failed to scrape podcast page"
        }

    # 2. Extract metadata
    metadata = extract_episode_metadata(html)
    title = metadata.get('title', 'Unknown Episode')
    description = metadata.get('description', '')

    # 3. Look for MP3 URLs directly
    mp3_urls = extract_mp3_urls(html)

    if mp3_urls:
        logger.info(f"Found {len(mp3_urls)} MP3 URL(s) in page")

        # Score and pick the best one
        if len(mp3_urls) == 1:
            mp3_url = mp3_urls[0]
        else:
            scored = [(url, score_mp3_url(url)) for url in mp3_urls]
            scored.sort(key=lambda x: x[1], reverse=True)
            mp3_url = scored[0][0]
            logger.info(f"Selected MP3 URL with score {scored[0][1]}: {mp3_url[:80]}...")

        return {
            "mp3_url": mp3_url,
            "title": title,
            "description": description,
            "error": None
        }

    # 4. Fallback: try RSS feed
    logger.info("No direct MP3 found, trying RSS fallback")
    rss_url = extract_rss_feed_url(html)

    if rss_url:
        logger.info(f"Found RSS feed: {rss_url}")

        # Extract episode identifier from URL
        parsed = urlparse(url)
        path_parts = parsed.path.strip('/').split('/')
        episode_id = path_parts[-1] if path_parts else ''

        mp3_url = await find_mp3_from_rss(rss_url, episode_id)

        if mp3_url:
            return {
                "mp3_url": mp3_url,
                "title": title,
                "description": description,
                "error": None
            }

    return {
        "mp3_url": None,
        "title": title,
        "description": description,
        "error": "Could not find MP3 URL in page or RSS feed"
    }


async def download_mp3(mp3_url: str, output_path: str) -> bool:
    """
    Download MP3 file from URL.

    Args:
        mp3_url: URL of MP3 file
        output_path: Local path to save file

    Returns:
        True if download succeeded, False otherwise
    """
    logger.info(f"Downloading MP3 from: {mp3_url[:80]}...")

    try:
        async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
            async with client.stream('GET', mp3_url) as response:
                if response.status_code != 200:
                    logger.error(f"Failed to download MP3: HTTP {response.status_code}")
                    return False

                with open(output_path, 'wb') as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        f.write(chunk)

        logger.info(f"Downloaded MP3 to: {output_path}")
        return True

    except Exception as e:
        logger.error(f"Error downloading MP3: {e}")
        return False


def transcribe_audio(audio_path: str, whisper_model: str = "base") -> str:
    """
    Transcribe audio file with Whisper.

    Args:
        audio_path: Path to audio file
        whisper_model: Whisper model size

    Returns:
        Transcribed text
    """
    logger.info(f"Loading Whisper model: {whisper_model}")
    model = whisper.load_model(whisper_model)

    logger.info("Transcribing audio...")
    result = model.transcribe(audio_path)

    transcript = result.get("text", "").strip()
    logger.info(f"Transcription complete: {len(transcript)} characters")

    return transcript


async def transcribe_podcast(
    url: str,
    api_key: str,
    whisper_model: str = "base"
) -> Dict[str, Any]:
    """
    Main entry point: extract MP3 from podcast page and transcribe.

    Args:
        url: Podcast episode page URL
        api_key: Firecrawl API key
        whisper_model: Whisper model size for transcription

    Returns:
        {
            "transcript": str,
            "title": str,
            "description": str,
            "mp3_url": str,
            "error": Optional[str]
        }
    """
    # 1. Extract MP3 URL
    extraction = await extract_podcast_mp3(url, api_key)

    if extraction.get("error"):
        return {
            "transcript": None,
            "title": extraction.get("title"),
            "description": extraction.get("description"),
            "mp3_url": None,
            "error": extraction["error"]
        }

    mp3_url = extraction["mp3_url"]
    title = extraction["title"]
    description = extraction["description"]

    # 2. Download and transcribe
    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = str(Path(tmpdir) / "episode.mp3")

        if not await download_mp3(mp3_url, audio_path):
            return {
                "transcript": None,
                "title": title,
                "description": description,
                "mp3_url": mp3_url,
                "error": "Failed to download MP3"
            }

        # 3. Transcribe (synchronous, runs in thread pool from caller)
        try:
            transcript = transcribe_audio(audio_path, whisper_model)
        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            return {
                "transcript": None,
                "title": title,
                "description": description,
                "mp3_url": mp3_url,
                "error": f"Transcription failed: {e}"
            }

    return {
        "transcript": transcript,
        "title": title,
        "description": description,
        "mp3_url": mp3_url,
        "error": None
    }
