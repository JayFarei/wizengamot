"""
Weekly digest generation for monitor mode.
Generates markdown summaries of competitive intelligence updates.
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from collections import defaultdict

from .monitors import get_monitor, _get_monitor_data_dir
from .monitor_updates import get_updates


def _get_digest_dir(monitor_id: str) -> Path:
    """Get the directory for storing digests."""
    data_dir = _get_monitor_data_dir(monitor_id)
    digest_dir = data_dir / "digests"
    digest_dir.mkdir(parents=True, exist_ok=True)
    return digest_dir


def generate_digest(monitor_id: str, period: str = "weekly") -> Optional[dict]:
    """
    Generate a digest summary for the specified period.

    Args:
        monitor_id: The monitor ID
        period: 'weekly' or 'monthly'

    Returns:
        Digest dict with id, period, markdown, stats
    """
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None

    # Calculate date range
    now = datetime.utcnow()
    if period == "weekly":
        since = now - timedelta(days=7)
    elif period == "monthly":
        since = now - timedelta(days=30)
    else:
        since = now - timedelta(days=7)

    # Get updates for the period
    updates = get_updates(monitor_id, since=since.isoformat() + "Z")

    if not updates:
        return {
            "id": now.strftime("%Y-%m-%dT%H-%M-%SZ"),
            "monitor_id": monitor_id,
            "period": period,
            "created_at": now.isoformat() + "Z",
            "start_date": since.isoformat() + "Z",
            "end_date": now.isoformat() + "Z",
            "markdown": f"# {period.title()} Digest: {monitor.get('name', 'Monitor')}\n\nNo updates during this period.",
            "stats": {
                "total_updates": 0,
                "competitors_changed": 0,
                "top_impact_tags": []
            }
        }

    # Aggregate by competitor
    competitor_updates = defaultdict(list)
    for update in updates:
        competitor_updates[update.get("competitor_name", "Unknown")].append(update)

    # Aggregate by impact tag
    tag_counts = defaultdict(int)
    for update in updates:
        for tag in update.get("impact_tags", []):
            tag_counts[tag] += 1

    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:5]

    # Build markdown
    md_lines = []
    md_lines.append(f"# {period.title()} Digest: {monitor.get('name', 'Monitor')}")
    md_lines.append("")
    md_lines.append(f"**Period:** {since.strftime('%B %d, %Y')} - {now.strftime('%B %d, %Y')}")
    md_lines.append(f"**Total Updates:** {len(updates)}")
    md_lines.append(f"**Competitors with Changes:** {len(competitor_updates)}")
    md_lines.append("")

    # Executive summary
    md_lines.append("## Executive Summary")
    md_lines.append("")
    if top_tags:
        tag_summary = ", ".join([f"{tag} ({count})" for tag, count in top_tags])
        md_lines.append(f"Top areas of change: {tag_summary}")
    md_lines.append("")

    # Key changes summary
    high_impact_updates = [u for u in updates if "high_impact" in u.get("impact_tags", [])]
    if high_impact_updates:
        md_lines.append("### High-Impact Changes")
        md_lines.append("")
        for update in high_impact_updates[:5]:
            md_lines.append(f"- **{update.get('competitor_name')}** ({update.get('page_type')}): {update.get('summary', 'No summary')}")
        md_lines.append("")

    # Per-competitor breakdown
    md_lines.append("## Competitor Updates")
    md_lines.append("")

    for competitor_name, comp_updates in sorted(competitor_updates.items()):
        md_lines.append(f"### {competitor_name}")
        md_lines.append("")
        md_lines.append(f"**{len(comp_updates)} update(s)**")
        md_lines.append("")

        for update in comp_updates[:10]:  # Limit per competitor
            timestamp = update.get("timestamp", "")
            if timestamp:
                try:
                    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                    date_str = dt.strftime("%b %d")
                except:
                    date_str = timestamp[:10]
            else:
                date_str = "Unknown"

            page_type = update.get("page_type", "page")
            summary = update.get("summary", "Content updated")
            tags = update.get("impact_tags", [])
            tag_str = f" [{', '.join(tags)}]" if tags else ""

            md_lines.append(f"- **{date_str}** ({page_type}): {summary}{tag_str}")

        md_lines.append("")

    # Changes by category
    if top_tags:
        md_lines.append("## Changes by Category")
        md_lines.append("")
        for tag, count in top_tags:
            md_lines.append(f"- **{tag.replace('_', ' ').title()}**: {count} update(s)")
        md_lines.append("")

    markdown = "\n".join(md_lines)

    # Create digest
    digest = {
        "id": now.strftime("%Y-%m-%dT%H-%M-%SZ"),
        "monitor_id": monitor_id,
        "period": period,
        "created_at": now.isoformat() + "Z",
        "start_date": since.isoformat() + "Z",
        "end_date": now.isoformat() + "Z",
        "markdown": markdown,
        "stats": {
            "total_updates": len(updates),
            "competitors_changed": len(competitor_updates),
            "top_impact_tags": [{"tag": t, "count": c} for t, c in top_tags]
        }
    }

    # Save digest
    digest_dir = _get_digest_dir(monitor_id)
    digest_path = digest_dir / f"{digest['id']}.json"

    with open(digest_path, "w") as f:
        json.dump(digest, f, indent=2)

    return digest


def get_digests(monitor_id: str, limit: int = 10) -> list[dict]:
    """
    List past digests for a monitor.

    Args:
        monitor_id: The monitor ID
        limit: Maximum digests to return

    Returns:
        List of digest dicts (without full markdown for listing)
    """
    digest_dir = _get_digest_dir(monitor_id)

    if not digest_dir.exists():
        return []

    digests = []
    for digest_file in sorted(digest_dir.glob("*.json"), reverse=True):
        try:
            with open(digest_file, "r") as f:
                digest = json.load(f)
                # Return summary for listing
                digests.append({
                    "id": digest.get("id"),
                    "period": digest.get("period"),
                    "created_at": digest.get("created_at"),
                    "start_date": digest.get("start_date"),
                    "end_date": digest.get("end_date"),
                    "stats": digest.get("stats")
                })
        except (json.JSONDecodeError, KeyError):
            continue

        if len(digests) >= limit:
            break

    return digests


def get_digest(monitor_id: str, digest_id: str) -> Optional[dict]:
    """
    Get a specific digest by ID.

    Args:
        monitor_id: The monitor ID
        digest_id: The digest ID

    Returns:
        Full digest dict including markdown
    """
    digest_dir = _get_digest_dir(monitor_id)
    digest_path = digest_dir / f"{digest_id}.json"

    if not digest_path.exists():
        return None

    with open(digest_path, "r") as f:
        return json.load(f)
