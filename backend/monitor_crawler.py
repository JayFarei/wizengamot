"""
Monitor crawler using Firecrawl for page fetching.
Handles crawling, snapshot storage, and change detection.
Includes screenshot capture support.
"""

import base64
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx

from .settings import get_firecrawl_api_key
from .monitors import get_monitor, update_monitor, _get_monitor_data_dir
from .search import get_embedding
from .monitor_analysis import analyze_with_diff

# Firecrawl API endpoints
FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"
FIRECRAWL_MAP_URL = "https://api.firecrawl.dev/v1/map"


async def map_website(url: str, limit: int = 200) -> dict:
    """
    Discover all pages on a website using Firecrawl's map endpoint.

    Args:
        url: The root URL of the website to map
        limit: Maximum number of URLs to return (default 200)

    Returns:
        {
            "success": bool,
            "pages": [{"url": str, "title": str | None}, ...],
            "total_found": int,
            "error": str | None
        }
    """
    api_key = get_firecrawl_api_key()
    if not api_key:
        return {
            "success": False,
            "pages": [],
            "total_found": 0,
            "error": "Firecrawl API key not configured"
        }

    # Debug: Log the URL being mapped
    print(f"[map_website] Mapping URL: {url}")

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            request_body = {
                "url": url,
                "limit": limit,
                "ignoreSitemap": False,
                "includeSubdomains": False
            }
            print(f"[map_website] Request body: {request_body}")

            response = await client.post(
                FIRECRAWL_MAP_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json=request_body
            )

            print(f"[map_website] Response status: {response.status_code}")

            if response.status_code != 200:
                # Log the full response body for debugging
                try:
                    error_body = response.json()
                    print(f"[map_website] Error response body: {error_body}")
                    error_detail = error_body.get("error", error_body.get("message", str(error_body)))
                except Exception:
                    error_detail = response.text[:500] if response.text else "No response body"
                    print(f"[map_website] Error response text: {error_detail}")

                return {
                    "success": False,
                    "pages": [],
                    "total_found": 0,
                    "error": f"Firecrawl API error ({response.status_code}): {error_detail}"
                }

            data = response.json()

            if not data.get("success"):
                error_msg = data.get("error", "Firecrawl failed to map the URL")
                print(f"[map_website] Firecrawl returned success=false: {error_msg}")
                print(f"[map_website] Full response: {data}")
                return {
                    "success": False,
                    "pages": [],
                    "total_found": 0,
                    "error": error_msg
                }

            # Map endpoint returns a list of URLs (may include titles in some cases)
            links = data.get("links", [])

            # Normalize to consistent format
            pages = []
            for link in links:
                if isinstance(link, str):
                    pages.append({"url": link, "title": None})
                elif isinstance(link, dict):
                    pages.append({
                        "url": link.get("url", link.get("link", "")),
                        "title": link.get("title")
                    })

            print(f"[map_website] Success! Found {len(pages)} pages")
            return {
                "success": True,
                "pages": pages,
                "total_found": len(pages),
                "error": None
            }

    except httpx.TimeoutException:
        return {
            "success": False,
            "pages": [],
            "total_found": 0,
            "error": "Request timed out"
        }
    except Exception as e:
        return {
            "success": False,
            "pages": [],
            "total_found": 0,
            "error": str(e)
        }


def compare_site_structure(current_map: list[dict], baseline_map: list[dict]) -> dict:
    """
    Compare current site map to baseline and identify structural changes.

    Args:
        current_map: List of {"url": str, "title": str | None} from current map
        baseline_map: List of {"url": str, "title": str | None} from baseline

    Returns:
        {
            "added": [{"url": str, "title": str | None}, ...],
            "removed": [{"url": str, "title": str | None}, ...],
            "total_current": int,
            "total_baseline": int,
            "has_changes": bool
        }
    """
    current_urls = {page.get("url") for page in current_map if page.get("url")}
    baseline_urls = {page.get("url") for page in baseline_map if page.get("url")}

    added_urls = current_urls - baseline_urls
    removed_urls = baseline_urls - current_urls

    # Get full page info for added/removed
    current_by_url = {p.get("url"): p for p in current_map}
    baseline_by_url = {p.get("url"): p for p in baseline_map}

    added = [current_by_url[url] for url in added_urls if url in current_by_url]
    removed = [baseline_by_url[url] for url in removed_urls if url in baseline_by_url]

    return {
        "added": added,
        "removed": removed,
        "total_current": len(current_urls),
        "total_baseline": len(baseline_urls),
        "has_changes": len(added) > 0 or len(removed) > 0
    }


def _get_snapshot_dir(monitor_id: str, competitor_id: str, page_id: str) -> Path:
    """Get the directory for storing snapshots of a specific page."""
    data_dir = _get_monitor_data_dir(monitor_id)
    snapshot_dir = data_dir / "snapshots" / competitor_id / page_id
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    return snapshot_dir


def _get_screenshot_dir(monitor_id: str, competitor_id: str, page_id: str) -> Path:
    """Get the directory for storing screenshots of a specific page."""
    data_dir = _get_monitor_data_dir(monitor_id)
    screenshot_dir = data_dir / "screenshots" / competitor_id / page_id
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    return screenshot_dir


def _compute_text_hash(text: str) -> str:
    """Compute SHA256 hash of text for change detection."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _get_latest_snapshot(monitor_id: str, competitor_id: str, page_id: str) -> Optional[dict]:
    """Get the most recent snapshot for a page."""
    snapshot_dir = _get_snapshot_dir(monitor_id, competitor_id, page_id)

    snapshots = sorted(snapshot_dir.glob("*.json"), reverse=True)
    if not snapshots:
        return None

    with open(snapshots[0], "r") as f:
        return json.load(f)


async def _fetch_with_screenshot(url: str) -> dict:
    """
    Fetch page content and screenshot using Firecrawl API.

    Returns:
        {
            "content": str (markdown),
            "screenshot": str (base64) | None,
            "title": str,
            "error": str | None
        }
    """
    api_key = get_firecrawl_api_key()
    if not api_key:
        return {
            "content": None,
            "screenshot": None,
            "title": None,
            "error": "Firecrawl API key not configured"
        }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                FIRECRAWL_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "url": url,
                    "formats": ["markdown", "screenshot"],
                    "timeout": 90000
                }
            )

            if response.status_code != 200:
                return {
                    "content": None,
                    "screenshot": None,
                    "title": None,
                    "error": f"Firecrawl API error: {response.status_code}"
                }

            data = response.json()

            if not data.get("success"):
                return {
                    "content": None,
                    "screenshot": None,
                    "title": None,
                    "error": "Firecrawl failed to scrape the URL"
                }

            result_data = data.get("data", {})
            markdown = result_data.get("markdown", "")
            screenshot = result_data.get("screenshot")  # base64 encoded
            metadata = result_data.get("metadata", {})
            title = metadata.get("title", metadata.get("ogTitle", ""))

            return {
                "content": markdown,
                "screenshot": screenshot,
                "title": title,
                "error": None
            }

    except httpx.TimeoutException:
        return {
            "content": None,
            "screenshot": None,
            "title": None,
            "error": "Request timed out"
        }
    except Exception as e:
        return {
            "content": None,
            "screenshot": None,
            "title": None,
            "error": str(e)
        }


def get_snapshots(monitor_id: str, competitor_id: str = None, page_id: str = None, limit: int = 100) -> list[dict]:
    """List snapshots for a monitor, optionally filtered by competitor and page."""
    data_dir = _get_monitor_data_dir(monitor_id)
    snapshots_root = data_dir / "snapshots"

    if not snapshots_root.exists():
        return []

    snapshots = []

    # Determine which directories to search
    if competitor_id:
        competitor_dirs = [snapshots_root / competitor_id] if (snapshots_root / competitor_id).exists() else []
    else:
        competitor_dirs = [d for d in snapshots_root.iterdir() if d.is_dir()]

    for comp_dir in competitor_dirs:
        if page_id:
            page_dirs = [comp_dir / page_id] if (comp_dir / page_id).exists() else []
        else:
            page_dirs = [d for d in comp_dir.iterdir() if d.is_dir()]

        for page_dir in page_dirs:
            for snapshot_file in page_dir.glob("*.json"):
                try:
                    with open(snapshot_file, "r") as f:
                        snapshot = json.load(f)
                        # Add minimal info for listing
                        snapshots.append({
                            "snapshot_id": snapshot.get("snapshot_id"),
                            "monitor_id": snapshot.get("monitor_id"),
                            "competitor_id": snapshot.get("competitor_id"),
                            "page_id": snapshot.get("page_id"),
                            "timestamp": snapshot.get("timestamp"),
                            "summary": snapshot.get("summary"),
                            "impact_tags": snapshot.get("impact_tags", []),
                            "has_change": snapshot.get("text_hash") != snapshot.get("previous_text_hash")
                        })
                except (json.JSONDecodeError, KeyError):
                    continue

    # Sort by timestamp descending and limit
    snapshots.sort(key=lambda s: s.get("timestamp", ""), reverse=True)
    return snapshots[:limit]


async def crawl_page(monitor_id: str, competitor_id: str, page_id: str) -> Optional[dict]:
    """
    Crawl a single page and store the snapshot with screenshot.

    Returns the snapshot dict if successful, None otherwise.
    """
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    # Find the page config
    page_config = None
    for comp in monitor.get("competitors", []):
        if comp["id"] == competitor_id:
            for page in comp.get("pages", []):
                if page["id"] == page_id:
                    page_config = page
                    break
            break

    if not page_config:
        return None

    url = page_config["url"]

    # Fetch content with screenshot using Firecrawl
    try:
        content_result = await _fetch_with_screenshot(url)
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

    if content_result.get("error"):
        print(f"Error fetching {url}: {content_result['error']}")
        return None

    text = content_result.get("content", "")
    if not text:
        return None

    # Generate timestamp-based ID early (needed for screenshot path)
    now = datetime.utcnow()
    timestamp = now.isoformat() + "Z"
    snapshot_id = now.strftime("%Y-%m-%dT%H-%M-%SZ")

    # Save screenshot if available
    screenshot_path = None
    screenshot_data = content_result.get("screenshot")
    if screenshot_data:
        try:
            screenshot_dir = _get_screenshot_dir(monitor_id, competitor_id, page_id)
            screenshot_file = screenshot_dir / f"{snapshot_id}.png"

            # Firecrawl returns base64 with data URL prefix, strip it
            if screenshot_data.startswith("data:image"):
                screenshot_data = screenshot_data.split(",", 1)[1]

            with open(screenshot_file, "wb") as f:
                f.write(base64.b64decode(screenshot_data))

            # Store relative path for portability
            screenshot_path = f"screenshots/{competitor_id}/{page_id}/{snapshot_id}.png"
        except Exception as e:
            print(f"Error saving screenshot: {e}")

    # Compute hash for change detection
    text_hash = _compute_text_hash(text)

    # Get previous snapshot
    previous_snapshot = _get_latest_snapshot(monitor_id, competitor_id, page_id)
    previous_snapshot_id = previous_snapshot.get("snapshot_id") if previous_snapshot else None
    previous_text_hash = previous_snapshot.get("text_hash") if previous_snapshot else None

    # Check if content changed
    content_changed = text_hash != previous_text_hash

    # Compute embedding for semantic search/comparison
    embedding = None
    try:
        embedding = get_embedding(text[:8000])  # Limit text for embedding
    except Exception as e:
        print(f"Error computing embedding: {e}")

    # Run semantic analysis if content changed
    analysis_result = None
    if content_changed:
        try:
            question_set = monitor.get("question_set", "default_b2b_saas_v1")
            analysis_result = await analyze_with_diff(text, previous_snapshot, question_set)
        except Exception as e:
            print(f"Error running semantic analysis: {e}")

    # Create snapshot
    snapshot = {
        "snapshot_id": snapshot_id,
        "monitor_id": monitor_id,
        "competitor_id": competitor_id,
        "page_id": page_id,
        "timestamp": timestamp,
        "url": url,
        "text": text,
        "text_hash": text_hash,
        "previous_snapshot_id": previous_snapshot_id,
        "previous_text_hash": previous_text_hash,
        "content_changed": content_changed,
        "screenshot_path": screenshot_path,
        "embedding": embedding.tolist() if embedding is not None else None,
        "answers": analysis_result.get("answers") if analysis_result else None,
        "summary": analysis_result.get("summary") if analysis_result else f"Crawled {url}" + (" - content changed" if content_changed else " - no change"),
        "diff": analysis_result.get("diff") if analysis_result else None,
        "impact_tags": analysis_result.get("impact_tags", []) if analysis_result else []
    }

    # Save snapshot
    snapshot_dir = _get_snapshot_dir(monitor_id, competitor_id, page_id)
    snapshot_path_file = snapshot_dir / f"{snapshot_id}.json"

    with open(snapshot_path_file, "w") as f:
        json.dump(snapshot, f, indent=2)

    return snapshot


async def crawl_monitor(monitor_id: str) -> dict:
    """
    Crawl all pages for a monitor.

    Returns a summary of the crawl results.
    """
    monitor = get_monitor(monitor_id)
    if not monitor:
        return {"error": "Monitor not found"}

    results = {
        "monitor_id": monitor_id,
        "crawled": [],
        "failed": [],
        "skipped": []
    }

    for competitor in monitor.get("competitors", []):
        for page in competitor.get("pages", []):
            try:
                snapshot = await crawl_page(monitor_id, competitor["id"], page["id"])
                if snapshot:
                    results["crawled"].append({
                        "competitor": competitor["name"],
                        "page": page["type"],
                        "url": page["url"],
                        "changed": snapshot.get("content_changed", False)
                    })
                else:
                    results["failed"].append({
                        "competitor": competitor["name"],
                        "page": page["type"],
                        "url": page["url"],
                        "reason": "No content returned"
                    })
            except Exception as e:
                results["failed"].append({
                    "competitor": competitor["name"],
                    "page": page["type"],
                    "url": page["url"],
                    "reason": str(e)
                })

    # Update monitor's last_crawl_at
    now = datetime.utcnow().isoformat() + "Z"
    update_monitor(monitor_id, {"last_crawl_at": now})

    # Update stats
    total_snapshots = len(get_snapshots(monitor_id, limit=10000))
    update_monitor(monitor_id, {
        "stats": {
            "total_updates": total_snapshots,
            "last_30d_updates": total_snapshots  # Will be calculated properly later
        }
    })

    return results
