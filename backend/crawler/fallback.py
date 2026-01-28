"""Fallback logic for crawler providers.

Provides a unified interface that uses Crawl4AI as primary
and falls back to Firecrawl when Crawl4AI is unavailable.
"""

import logging
from typing import Any, Callable, Dict, Optional

import httpx

from .adapter import Crawl4AIAdapter
from .config import (
    DEFAULT_ARTICLE_TIMEOUT,
    DEFAULT_MAP_TIMEOUT,
    DEFAULT_PDF_TIMEOUT,
    DEFAULT_RAW_HTML_TIMEOUT,
    DEFAULT_SCREENSHOT_TIMEOUT,
)
from .errors import CrawlerConnectionError, CrawlerError
from .site_mapper import SiteMapper

logger = logging.getLogger(__name__)

# Firecrawl API endpoints
FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"
FIRECRAWL_API_URL_V2 = "https://api.firecrawl.dev/v2/scrape"
FIRECRAWL_MAP_URL = "https://api.firecrawl.dev/v1/map"


async def _firecrawl_scrape(
    url: str,
    api_key: str,
    formats: list = None,
    timeout: float = 120.0,
    endpoint: str = FIRECRAWL_API_URL,
    extra_params: dict = None,
) -> Dict[str, Any]:
    """
    Execute a Firecrawl scrape request.

    This is the fallback implementation that matches the original
    Firecrawl API calls from the codebase.
    """
    if formats is None:
        formats = ["markdown"]

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    body = {
        "url": url,
        "formats": formats,
        "timeout": int(timeout * 1000),  # Convert to milliseconds
    }

    if extra_params:
        body.update(extra_params)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(endpoint, headers=headers, json=body)

            if response.status_code != 200:
                return {
                    "success": False,
                    "data": {},
                    "error": f"HTTP {response.status_code}: {response.text[:200]}",
                }

            return response.json()

    except httpx.TimeoutException:
        return {
            "success": False,
            "data": {},
            "error": f"Request timed out after {timeout}s",
        }
    except Exception as e:
        return {
            "success": False,
            "data": {},
            "error": str(e),
        }


async def _firecrawl_map(
    url: str,
    api_key: str,
    limit: int = 200,
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    Execute a Firecrawl map request.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    body = {
        "url": url,
        "limit": limit,
        "ignoreSitemap": False,
        "includeSubdomains": False,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(FIRECRAWL_MAP_URL, headers=headers, json=body)

            if response.status_code != 200:
                return {
                    "success": False,
                    "links": [],
                    "error": f"HTTP {response.status_code}: {response.text[:200]}",
                }

            return response.json()

    except httpx.TimeoutException:
        return {
            "success": False,
            "links": [],
            "error": f"Request timed out after {timeout}s",
        }
    except Exception as e:
        return {
            "success": False,
            "links": [],
            "error": str(e),
        }


class CrawlerWithFallback:
    """
    Unified crawler interface with automatic fallback.

    Primary: Crawl4AI (self-hosted)
    Fallback: Firecrawl (API, requires key)
    """

    def __init__(
        self,
        crawl4ai_url: str = "http://localhost:11235",
        firecrawl_api_key: Optional[str] = None,
        is_crawl4ai_enabled: bool = True,
    ):
        """
        Initialize the crawler with fallback support.

        Args:
            crawl4ai_url: Crawl4AI service URL
            firecrawl_api_key: Optional Firecrawl API key for fallback
            is_crawl4ai_enabled: Whether Crawl4AI is the primary provider
        """
        self.crawl4ai_url = crawl4ai_url
        self.firecrawl_api_key = firecrawl_api_key
        self.is_crawl4ai_enabled = is_crawl4ai_enabled
        self._adapter: Optional[Crawl4AIAdapter] = None
        self._site_mapper: Optional[SiteMapper] = None

    @property
    def adapter(self) -> Crawl4AIAdapter:
        """Lazy-load the Crawl4AI adapter."""
        if self._adapter is None:
            self._adapter = Crawl4AIAdapter(self.crawl4ai_url)
        return self._adapter

    @property
    def site_mapper(self) -> SiteMapper:
        """Lazy-load the site mapper."""
        if self._site_mapper is None:
            self._site_mapper = SiteMapper(self.adapter.client)
        return self._site_mapper

    def _has_firecrawl(self) -> bool:
        """Check if Firecrawl fallback is available."""
        return self.firecrawl_api_key is not None

    async def scrape_article(
        self, url: str, timeout: int = DEFAULT_ARTICLE_TIMEOUT
    ) -> Dict[str, Any]:
        """
        Scrape article with automatic fallback.
        """
        if self.is_crawl4ai_enabled:
            try:
                result = await self.adapter.scrape_article(url, timeout)
                if result.get("success"):
                    return result
                # Crawl4AI failed, try fallback
                if self._has_firecrawl():
                    logger.info(f"Crawl4AI failed, falling back to Firecrawl for {url}")
                    return await _firecrawl_scrape(
                        url, self.firecrawl_api_key, ["markdown"], float(timeout)
                    )
                return result
            except CrawlerConnectionError:
                if self._has_firecrawl():
                    logger.warning(
                        f"Crawl4AI unavailable, falling back to Firecrawl for {url}"
                    )
                    return await _firecrawl_scrape(
                        url, self.firecrawl_api_key, ["markdown"], float(timeout)
                    )
                raise

        # Crawl4AI disabled, use Firecrawl directly
        if self._has_firecrawl():
            return await _firecrawl_scrape(
                url, self.firecrawl_api_key, ["markdown"], float(timeout)
            )

        raise CrawlerError(
            "No crawler configured. Enable Crawl4AI or provide Firecrawl API key."
        )

    async def scrape_pdf(
        self, url: str, timeout: int = DEFAULT_PDF_TIMEOUT
    ) -> Dict[str, Any]:
        """
        Scrape PDF with automatic fallback.
        """
        if self.is_crawl4ai_enabled:
            try:
                result = await self.adapter.scrape_pdf(url, timeout)
                if result.get("success"):
                    # Check that we got actual content, not just success flag
                    markdown = result.get("data", {}).get("markdown", "")
                    if markdown and len(markdown.strip()) > 100:
                        return result
                    # Empty content - fall through to Firecrawl
                    logger.info(
                        f"Crawl4AI returned empty PDF content, trying Firecrawl for {url}"
                    )
                    if self._has_firecrawl():
                        return await _firecrawl_scrape(
                            url,
                            self.firecrawl_api_key,
                            ["markdown"],
                            float(timeout),
                            endpoint=FIRECRAWL_API_URL_V2,
                            extra_params={"parsers": ["pdf"]},
                        )
                    return result
                if self._has_firecrawl():
                    logger.info(f"Crawl4AI PDF failed, falling back to Firecrawl for {url}")
                    return await _firecrawl_scrape(
                        url,
                        self.firecrawl_api_key,
                        ["markdown"],
                        float(timeout),
                        endpoint=FIRECRAWL_API_URL_V2,
                        extra_params={"parsers": ["pdf"]},
                    )
                return result
            except CrawlerConnectionError:
                if self._has_firecrawl():
                    logger.warning(f"Crawl4AI unavailable, falling back to Firecrawl for {url}")
                    return await _firecrawl_scrape(
                        url,
                        self.firecrawl_api_key,
                        ["markdown"],
                        float(timeout),
                        endpoint=FIRECRAWL_API_URL_V2,
                        extra_params={"parsers": ["pdf"]},
                    )
                raise

        if self._has_firecrawl():
            return await _firecrawl_scrape(
                url,
                self.firecrawl_api_key,
                ["markdown"],
                float(timeout),
                endpoint=FIRECRAWL_API_URL_V2,
                extra_params={"parsers": ["pdf"]},
            )

        raise CrawlerError("No crawler configured.")

    async def scrape_with_screenshot(
        self, url: str, timeout: int = DEFAULT_SCREENSHOT_TIMEOUT
    ) -> Dict[str, Any]:
        """
        Scrape with screenshot, automatic fallback.
        """
        if self.is_crawl4ai_enabled:
            try:
                result = await self.adapter.scrape_with_screenshot(url, timeout)
                if result.get("success"):
                    return result
                if self._has_firecrawl():
                    logger.info(f"Crawl4AI screenshot failed, falling back to Firecrawl")
                    return await _firecrawl_scrape(
                        url,
                        self.firecrawl_api_key,
                        ["markdown", "screenshot"],
                        float(timeout),
                    )
                return result
            except CrawlerConnectionError:
                if self._has_firecrawl():
                    logger.warning(f"Crawl4AI unavailable, falling back to Firecrawl")
                    return await _firecrawl_scrape(
                        url,
                        self.firecrawl_api_key,
                        ["markdown", "screenshot"],
                        float(timeout),
                    )
                raise

        if self._has_firecrawl():
            return await _firecrawl_scrape(
                url,
                self.firecrawl_api_key,
                ["markdown", "screenshot"],
                float(timeout),
            )

        raise CrawlerError("No crawler configured.")

    async def scrape_raw_html(
        self, url: str, timeout: int = DEFAULT_RAW_HTML_TIMEOUT
    ) -> Dict[str, Any]:
        """
        Scrape raw HTML with automatic fallback.
        """
        if self.is_crawl4ai_enabled:
            try:
                result = await self.adapter.scrape_raw_html(url, timeout)
                if result.get("success"):
                    return result
                if self._has_firecrawl():
                    logger.info(f"Crawl4AI raw HTML failed, falling back to Firecrawl")
                    return await _firecrawl_scrape(
                        url,
                        self.firecrawl_api_key,
                        ["rawHtml"],
                        float(timeout),
                        extra_params={"onlyMainContent": False},
                    )
                return result
            except CrawlerConnectionError:
                if self._has_firecrawl():
                    logger.warning(f"Crawl4AI unavailable, falling back to Firecrawl")
                    return await _firecrawl_scrape(
                        url,
                        self.firecrawl_api_key,
                        ["rawHtml"],
                        float(timeout),
                        extra_params={"onlyMainContent": False},
                    )
                raise

        if self._has_firecrawl():
            return await _firecrawl_scrape(
                url,
                self.firecrawl_api_key,
                ["rawHtml"],
                float(timeout),
                extra_params={"onlyMainContent": False},
            )

        raise CrawlerError("No crawler configured.")

    async def map_website(
        self, url: str, limit: int = 200, timeout: float = DEFAULT_MAP_TIMEOUT
    ) -> Dict[str, Any]:
        """
        Map website with automatic fallback.
        """
        if self.is_crawl4ai_enabled:
            try:
                result = await self.site_mapper.map_website(url, limit, timeout=timeout)
                if result.get("success"):
                    return result
                if self._has_firecrawl():
                    logger.info(f"Crawl4AI mapping failed, falling back to Firecrawl")
                    return await _firecrawl_map(
                        url, self.firecrawl_api_key, limit, timeout
                    )
                return result
            except CrawlerConnectionError:
                if self._has_firecrawl():
                    logger.warning(f"Crawl4AI unavailable, falling back to Firecrawl")
                    return await _firecrawl_map(
                        url, self.firecrawl_api_key, limit, timeout
                    )
                raise

        if self._has_firecrawl():
            return await _firecrawl_map(url, self.firecrawl_api_key, limit, timeout)

        raise CrawlerError("No crawler configured.")

    async def health_check(self) -> bool:
        """Check if the primary crawler is healthy."""
        if self.is_crawl4ai_enabled:
            return await self.adapter.health_check()
        # Firecrawl doesn't have a health endpoint, assume available if key present
        return self._has_firecrawl()


def get_crawler(
    crawl4ai_url: Optional[str] = None,
    firecrawl_api_key: Optional[str] = None,
    is_crawl4ai_enabled: Optional[bool] = None,
) -> CrawlerWithFallback:
    """
    Get a configured crawler instance using settings.

    If parameters are not provided, reads from settings module.
    """
    # Import here to avoid circular imports
    from ..settings import (
        get_crawl4ai_url as settings_get_crawl4ai_url,
        get_firecrawl_api_key,
        is_crawl4ai_enabled as settings_is_crawl4ai_enabled,
    )

    return CrawlerWithFallback(
        crawl4ai_url=crawl4ai_url or settings_get_crawl4ai_url(),
        firecrawl_api_key=firecrawl_api_key or get_firecrawl_api_key(),
        is_crawl4ai_enabled=(
            is_crawl4ai_enabled
            if is_crawl4ai_enabled is not None
            else settings_is_crawl4ai_enabled()
        ),
    )
