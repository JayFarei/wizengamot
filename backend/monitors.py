"""
Monitor CRUD operations and data management.
Stores monitor configurations and provides access to monitor data.
"""

import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional
import uuid


def _get_monitors_dir() -> Path:
    """Get the monitors directory path."""
    data_dir = os.environ.get("DATA_DIR", "data")
    monitors_dir = Path(data_dir) / "monitors"
    monitors_dir.mkdir(parents=True, exist_ok=True)
    return monitors_dir


def _get_monitor_path(monitor_id: str) -> Path:
    """Get the path to a monitor's config file."""
    return _get_monitors_dir() / f"{monitor_id}.json"


def _get_monitor_data_dir(monitor_id: str) -> Path:
    """Get the path to a monitor's data directory (snapshots, screenshots)."""
    data_dir = _get_monitors_dir() / monitor_id
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _generate_id() -> str:
    """Generate a unique monitor ID."""
    return f"monitor_{uuid.uuid4().hex[:8]}"


def _generate_slug(name: str) -> str:
    """Generate a URL-safe slug from a name."""
    slug = name.lower().strip()
    slug = "".join(c if c.isalnum() or c == " " else "" for c in slug)
    slug = slug.replace(" ", "_")
    return slug[:50] or "unnamed"


def list_monitors() -> list[dict]:
    """List all monitors with basic info."""
    monitors_dir = _get_monitors_dir()
    monitors = []

    for path in monitors_dir.glob("monitor_*.json"):
        try:
            with open(path, "r") as f:
                monitor = json.load(f)
                monitors.append({
                    "id": monitor["id"],
                    "name": monitor["name"],
                    "created_at": monitor["created_at"],
                    "competitor_count": len(monitor.get("competitors", [])),
                    "last_crawl_at": monitor.get("last_crawl_at"),
                    "stats": monitor.get("stats", {"total_updates": 0, "last_30d_updates": 0}),
                    "status": monitor.get("status", "running"),
                    "unread_updates": monitor.get("unread_updates", 0),
                    "last_viewed_at": monitor.get("last_viewed_at")
                })
        except (json.JSONDecodeError, KeyError):
            continue

    # Sort by created_at descending
    monitors.sort(key=lambda m: m["created_at"], reverse=True)
    return monitors


def get_monitor(monitor_id: str) -> Optional[dict]:
    """Get a monitor by ID."""
    path = _get_monitor_path(monitor_id)
    if not path.exists():
        return None

    with open(path, "r") as f:
        return json.load(f)


def create_monitor(name: str, question_set: str = "default_b2b_saas_v1") -> dict:
    """Create a new monitor."""
    monitor_id = _generate_id()
    now = datetime.utcnow().isoformat() + "Z"

    monitor = {
        "id": monitor_id,
        "name": name,
        "created_at": now,
        "question_set": question_set,
        "competitors": [],
        "last_crawl_at": None,
        "stats": {
            "total_updates": 0,
            "last_30d_updates": 0
        },
        "messages": [],  # Chat history for this monitor
        "status": "running",  # running | paused
        "unread_updates": 0,
        "last_viewed_at": None
    }

    path = _get_monitor_path(monitor_id)
    with open(path, "w") as f:
        json.dump(monitor, f, indent=2)

    # Create data directories
    data_dir = _get_monitor_data_dir(monitor_id)
    (data_dir / "snapshots").mkdir(exist_ok=True)
    (data_dir / "screenshots").mkdir(exist_ok=True)

    return monitor


def update_monitor(monitor_id: str, updates: dict) -> Optional[dict]:
    """Update a monitor's configuration."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    # Only allow updating certain fields
    allowed_fields = ["name", "question_set", "competitors", "last_crawl_at", "stats", "messages", "status", "unread_updates", "last_viewed_at"]
    for key, value in updates.items():
        if key in allowed_fields:
            monitor[key] = value

    path = _get_monitor_path(monitor_id)
    with open(path, "w") as f:
        json.dump(monitor, f, indent=2)

    return monitor


def delete_monitor(monitor_id: str) -> bool:
    """Delete a monitor and all its data."""
    path = _get_monitor_path(monitor_id)
    if not path.exists():
        return False

    # Delete config file
    path.unlink()

    # Delete data directory
    data_dir = _get_monitors_dir() / monitor_id
    if data_dir.exists():
        shutil.rmtree(data_dir)

    return True


def add_competitor(
    monitor_id: str,
    name: str,
    domain: str = None,
    pages: list[dict] = None,
    site_map_baseline: list[dict] = None,
    tier: str = "suggested"
) -> Optional[dict]:
    """
    Add a competitor to a monitor.

    Args:
        monitor_id: The monitor to add to
        name: Competitor name
        domain: Root domain URL (e.g., https://competitor.com)
        pages: List of pages to track, each with url, type, and reason
        site_map_baseline: Full site map for baseline comparison
        tier: Selected tracking tier (minimum, suggested, generous, all)
    """
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    competitor_id = _generate_slug(name)

    # Check for duplicate
    for comp in monitor["competitors"]:
        if comp["id"] == competitor_id:
            return None

    now = datetime.utcnow().isoformat() + "Z"

    competitor = {
        "id": competitor_id,
        "name": name,
        "domain": domain,
        "tier": tier,
        "site_map_baseline": site_map_baseline or [],
        "site_map_updated_at": now if site_map_baseline else None,
        "pages": [],
        "tracking_summary": {
            "last_hiring_snapshot": None,
            "last_customer_snapshot": None,
            "hiring_trend": None,
            "customer_count_trend": None
        }
    }

    # Add pages if provided (new format with type and reason)
    if pages:
        for i, page in enumerate(pages):
            # Generate unique page ID from type + index
            page_type = page.get("type", "page")
            page_id = _generate_slug(f"{page_type}_{i}")

            competitor["pages"].append({
                "id": page_id,
                "url": page["url"],
                "type": page_type,
                "reason": page.get("reason", ""),
                "category": _categorize_page_type(page_type),
                "crawl_frequency": page.get("crawl_frequency", "daily")
            })

    monitor["competitors"].append(competitor)
    update_monitor(monitor_id, {"competitors": monitor["competitors"]})

    # Create directories for this competitor
    data_dir = _get_monitor_data_dir(monitor_id)
    (data_dir / "snapshots" / competitor_id).mkdir(parents=True, exist_ok=True)
    (data_dir / "screenshots" / competitor_id).mkdir(parents=True, exist_ok=True)

    return competitor


def _categorize_page_type(page_type: str) -> str:
    """Categorize page type for special extraction handling."""
    page_type_lower = page_type.lower()

    if page_type_lower in ["careers", "jobs", "hiring", "join", "team"]:
        return "careers"
    elif page_type_lower in ["customers", "case_study", "case_studies", "testimonials", "logos"]:
        return "customers"
    elif page_type_lower in ["press", "news", "newsroom", "media"]:
        return "press"
    elif page_type_lower in ["pricing", "plans", "packages"]:
        return "pricing"
    elif page_type_lower in ["integrations", "partners", "marketplace", "apps"]:
        return "integrations"
    else:
        return "general"


def update_competitor_site_map(
    monitor_id: str,
    competitor_id: str,
    site_map: list[dict]
) -> Optional[dict]:
    """Update a competitor's site map baseline."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    for comp in monitor["competitors"]:
        if comp["id"] == competitor_id:
            now = datetime.utcnow().isoformat() + "Z"
            comp["site_map_baseline"] = site_map
            comp["site_map_updated_at"] = now
            update_monitor(monitor_id, {"competitors": monitor["competitors"]})
            return comp

    return None


def update_competitor_tracking_summary(
    monitor_id: str,
    competitor_id: str,
    summary_updates: dict
) -> Optional[dict]:
    """Update a competitor's tracking summary (hiring/customer trends)."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    for comp in monitor["competitors"]:
        if comp["id"] == competitor_id:
            if "tracking_summary" not in comp:
                comp["tracking_summary"] = {}
            comp["tracking_summary"].update(summary_updates)
            update_monitor(monitor_id, {"competitors": monitor["competitors"]})
            return comp

    return None


def get_competitor(monitor_id: str, competitor_id: str) -> Optional[dict]:
    """Get a specific competitor from a monitor."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    for comp in monitor["competitors"]:
        if comp["id"] == competitor_id:
            return comp

    return None


def remove_competitor(monitor_id: str, competitor_id: str) -> bool:
    """Remove a competitor from a monitor."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return False

    original_count = len(monitor["competitors"])
    monitor["competitors"] = [c for c in monitor["competitors"] if c["id"] != competitor_id]

    if len(monitor["competitors"]) == original_count:
        return False

    update_monitor(monitor_id, {"competitors": monitor["competitors"]})

    # Clean up competitor data
    data_dir = _get_monitor_data_dir(monitor_id)
    snapshots_dir = data_dir / "snapshots" / competitor_id
    screenshots_dir = data_dir / "screenshots" / competitor_id

    if snapshots_dir.exists():
        shutil.rmtree(snapshots_dir)
    if screenshots_dir.exists():
        shutil.rmtree(screenshots_dir)

    return True


def add_page(monitor_id: str, competitor_id: str, url: str, page_type: str = "page",
             visual_critical: bool = False, crawl_frequency: str = "daily") -> Optional[dict]:
    """Add a page to track for a competitor."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    competitor = None
    for comp in monitor["competitors"]:
        if comp["id"] == competitor_id:
            competitor = comp
            break

    if not competitor:
        return None

    page_id = _generate_slug(page_type)

    # Check for duplicate
    for page in competitor["pages"]:
        if page["url"] == url:
            return None

    page = {
        "id": page_id,
        "url": url,
        "type": page_type,
        "visual_critical": visual_critical,
        "crawl_frequency": crawl_frequency
    }

    competitor["pages"].append(page)
    update_monitor(monitor_id, {"competitors": monitor["competitors"]})

    # Create directory for this page
    data_dir = _get_monitor_data_dir(monitor_id)
    (data_dir / "snapshots" / competitor_id / page_id).mkdir(parents=True, exist_ok=True)
    (data_dir / "screenshots" / competitor_id / page_id).mkdir(parents=True, exist_ok=True)

    return page


def remove_page(monitor_id: str, competitor_id: str, page_id: str) -> bool:
    """Remove a page from tracking."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return False

    for comp in monitor["competitors"]:
        if comp["id"] == competitor_id:
            original_count = len(comp["pages"])
            comp["pages"] = [p for p in comp["pages"] if p["id"] != page_id]

            if len(comp["pages"]) == original_count:
                return False

            update_monitor(monitor_id, {"competitors": monitor["competitors"]})

            # Clean up page data
            data_dir = _get_monitor_data_dir(monitor_id)
            snapshots_dir = data_dir / "snapshots" / competitor_id / page_id
            screenshots_dir = data_dir / "screenshots" / competitor_id / page_id

            if snapshots_dir.exists():
                shutil.rmtree(snapshots_dir)
            if screenshots_dir.exists():
                shutil.rmtree(screenshots_dir)

            return True

    return False


def add_message(monitor_id: str, role: str, content: str, metadata: dict = None) -> Optional[dict]:
    """Add a message to the monitor's chat history."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    message = {
        "role": role,
        "content": content,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }

    if metadata:
        message["metadata"] = metadata

    if "messages" not in monitor:
        monitor["messages"] = []

    monitor["messages"].append(message)
    update_monitor(monitor_id, {"messages": monitor["messages"]})

    return message


def get_messages(monitor_id: str) -> list[dict]:
    """Get all messages for a monitor."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return []

    return monitor.get("messages", [])


def mark_read(monitor_id: str) -> Optional[dict]:
    """Mark a monitor as read, resetting unread_updates counter."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    now = datetime.utcnow().isoformat() + "Z"
    updates = {
        "unread_updates": 0,
        "last_viewed_at": now
    }

    return update_monitor(monitor_id, updates)


def increment_unread(monitor_id: str) -> Optional[dict]:
    """Increment the unread_updates counter for a monitor."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    current_unread = monitor.get("unread_updates", 0)
    return update_monitor(monitor_id, {"unread_updates": current_unread + 1})
