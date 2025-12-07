"""
Monitor updates query and aggregation.
Provides functions for querying snapshots and generating summaries.
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .monitors import get_monitor, _get_monitor_data_dir


def get_updates(
    monitor_id: str,
    since: Optional[str] = None,
    tags: Optional[list[str]] = None,
    competitor_id: Optional[str] = None,
    limit: int = 50
) -> list[dict]:
    """
    Get updates (snapshots with meaningful changes) for a monitor.

    Args:
        monitor_id: The monitor ID
        since: ISO timestamp to filter updates after this time
        tags: List of impact tags to filter by
        competitor_id: Filter by specific competitor
        limit: Maximum number of updates to return

    Returns:
        List of update dicts with snapshot info
    """
    monitor = get_monitor(monitor_id)
    if not monitor:
        return []

    data_dir = _get_monitor_data_dir(monitor_id)
    snapshots_dir = data_dir / "snapshots"

    if not snapshots_dir.exists():
        return []

    updates = []

    # Parse since timestamp if provided
    since_dt = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            pass

    # Iterate through competitor directories
    for comp_dir in snapshots_dir.iterdir():
        if not comp_dir.is_dir():
            continue

        # Filter by competitor if specified
        if competitor_id and comp_dir.name != competitor_id:
            continue

        # Get competitor name from monitor config
        comp_name = comp_dir.name
        for comp in monitor.get("competitors", []):
            if comp["id"] == comp_dir.name:
                comp_name = comp["name"]
                break

        # Iterate through page directories
        for page_dir in comp_dir.iterdir():
            if not page_dir.is_dir():
                continue

            # Get page type from monitor config
            page_type = page_dir.name
            for comp in monitor.get("competitors", []):
                if comp["id"] == comp_dir.name:
                    for page in comp.get("pages", []):
                        if page["id"] == page_dir.name:
                            page_type = page["type"]
                            break

            # Read snapshots
            for snapshot_file in page_dir.glob("*.json"):
                try:
                    with open(snapshot_file, "r") as f:
                        snapshot = json.load(f)

                    # Filter by time
                    if since_dt:
                        snapshot_time = snapshot.get("timestamp", "")
                        try:
                            snap_dt = datetime.fromisoformat(snapshot_time.replace("Z", "+00:00"))
                            if snap_dt < since_dt:
                                continue
                        except ValueError:
                            pass

                    # Filter by tags
                    snapshot_tags = snapshot.get("impact_tags", [])
                    if tags:
                        if not any(tag in snapshot_tags for tag in tags):
                            continue

                    # Only include snapshots with meaningful changes
                    if not snapshot.get("content_changed", False):
                        continue

                    updates.append({
                        "snapshot_id": snapshot.get("snapshot_id"),
                        "monitor_id": monitor_id,
                        "competitor_id": comp_dir.name,
                        "competitor_name": comp_name,
                        "page_id": page_dir.name,
                        "page_type": page_type,
                        "timestamp": snapshot.get("timestamp"),
                        "url": snapshot.get("url"),
                        "summary": snapshot.get("summary", ""),
                        "impact_tags": snapshot_tags,
                        "answers": snapshot.get("answers"),
                        "diff": snapshot.get("diff")
                    })

                except (json.JSONDecodeError, KeyError) as e:
                    continue

    # Sort by timestamp descending
    updates.sort(key=lambda u: u.get("timestamp", ""), reverse=True)

    return updates[:limit]


def get_summary(monitor_id: str) -> dict:
    """
    Get aggregate summary stats for a monitor.

    Returns:
        dict with:
        - total_competitors: int
        - total_pages: int
        - total_snapshots: int
        - updates_last_7d: int
        - updates_last_30d: int
        - top_impact_tags: list of (tag, count) tuples
        - recent_updates: list of last 5 updates
    """
    monitor = get_monitor(monitor_id)
    if not monitor:
        return {}

    # Basic counts
    total_competitors = len(monitor.get("competitors", []))
    total_pages = sum(len(c.get("pages", [])) for c in monitor.get("competitors", []))

    # Get all updates
    all_updates = get_updates(monitor_id, limit=1000)
    total_snapshots = len(all_updates)

    # Time-filtered counts
    now = datetime.utcnow()
    seven_days_ago = (now - timedelta(days=7)).isoformat() + "Z"
    thirty_days_ago = (now - timedelta(days=30)).isoformat() + "Z"

    updates_7d = get_updates(monitor_id, since=seven_days_ago, limit=1000)
    updates_30d = get_updates(monitor_id, since=thirty_days_ago, limit=1000)

    # Count impact tags
    tag_counts = {}
    for update in all_updates:
        for tag in update.get("impact_tags", []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "total_competitors": total_competitors,
        "total_pages": total_pages,
        "total_snapshots": total_snapshots,
        "updates_last_7d": len(updates_7d),
        "updates_last_30d": len(updates_30d),
        "top_impact_tags": top_tags,
        "recent_updates": all_updates[:5],
        "last_crawl_at": monitor.get("last_crawl_at")
    }


def get_comparison(
    monitor_id: str,
    question: str,
    competitor_ids: Optional[list[str]] = None
) -> list[dict]:
    """
    Get comparison data for a specific question across competitors over time.

    Args:
        monitor_id: The monitor ID
        question: The question key (e.g., "pricing", "icp")
        competitor_ids: Optional list of competitor IDs to include

    Returns:
        List of dicts with competitor, timestamp, and answer
    """
    monitor = get_monitor(monitor_id)
    if not monitor:
        return []

    data_dir = _get_monitor_data_dir(monitor_id)
    snapshots_dir = data_dir / "snapshots"

    if not snapshots_dir.exists():
        return []

    comparison = []

    for comp_dir in snapshots_dir.iterdir():
        if not comp_dir.is_dir():
            continue

        if competitor_ids and comp_dir.name not in competitor_ids:
            continue

        # Get competitor name
        comp_name = comp_dir.name
        for comp in monitor.get("competitors", []):
            if comp["id"] == comp_dir.name:
                comp_name = comp["name"]
                break

        # Collect all snapshots with answers
        comp_snapshots = []

        for page_dir in comp_dir.iterdir():
            if not page_dir.is_dir():
                continue

            for snapshot_file in page_dir.glob("*.json"):
                try:
                    with open(snapshot_file, "r") as f:
                        snapshot = json.load(f)

                    answers = snapshot.get("answers")
                    if answers and question in answers:
                        comp_snapshots.append({
                            "timestamp": snapshot.get("timestamp"),
                            "answer": answers.get(question),
                            "page_type": page_dir.name
                        })
                except (json.JSONDecodeError, KeyError):
                    continue

        # Sort by timestamp
        comp_snapshots.sort(key=lambda s: s.get("timestamp", ""))

        if comp_snapshots:
            comparison.append({
                "competitor_id": comp_dir.name,
                "competitor_name": comp_name,
                "history": comp_snapshots
            })

    return comparison
