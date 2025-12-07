"""
Monitor scheduler for background crawling tasks.
Uses asyncio for simple timer-based scheduling.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Optional

from .monitors import list_monitors, get_monitor, increment_unread
from .monitor_crawler import crawl_monitor

# Global scheduler state
_scheduler_task: Optional[asyncio.Task] = None
_scheduler_running: bool = False


def _should_crawl(monitor: dict) -> bool:
    """
    Determine if a monitor should be crawled based on its configuration.
    For now, crawl if:
    - Monitor is not paused, AND
    - Never crawled before, OR
    - Last crawl was more than 1 hour ago
    """
    # Skip paused monitors
    if monitor.get("status") == "paused":
        return False

    last_crawl = monitor.get("last_crawl_at")

    if not last_crawl:
        return True

    try:
        last_crawl_time = datetime.fromisoformat(last_crawl.replace("Z", "+00:00"))
        now = datetime.now(last_crawl_time.tzinfo)
        time_since_crawl = now - last_crawl_time

        # Crawl every hour by default
        return time_since_crawl > timedelta(hours=1)
    except (ValueError, TypeError):
        return True


async def _scheduler_loop():
    """Main scheduler loop that runs continuously."""
    global _scheduler_running

    print("[Scheduler] Starting monitor scheduler")

    while _scheduler_running:
        try:
            monitors = list_monitors()

            for monitor_info in monitors:
                if not _scheduler_running:
                    break

                monitor = get_monitor(monitor_info["id"])
                if not monitor:
                    continue

                # Skip monitors with no competitors
                if not monitor.get("competitors"):
                    continue

                if _should_crawl(monitor):
                    print(f"[Scheduler] Crawling monitor: {monitor['name']}")
                    try:
                        result = await crawl_monitor(monitor["id"])
                        crawled_pages = result.get('crawled', [])
                        print(f"[Scheduler] Crawl complete: {len(crawled_pages)} pages")

                        # Count meaningful changes and increment unread counter
                        changes_found = sum(1 for p in crawled_pages if p.get('changed'))
                        if changes_found > 0:
                            for _ in range(changes_found):
                                increment_unread(monitor["id"])
                            print(f"[Scheduler] Found {changes_found} changes, updated unread count")
                    except Exception as e:
                        print(f"[Scheduler] Crawl error for {monitor['name']}: {e}")

            # Wait before next check (every 10 minutes)
            await asyncio.sleep(600)

        except asyncio.CancelledError:
            print("[Scheduler] Scheduler cancelled")
            break
        except Exception as e:
            print(f"[Scheduler] Error in scheduler loop: {e}")
            await asyncio.sleep(60)  # Wait a bit before retrying

    print("[Scheduler] Scheduler stopped")


def start_scheduler():
    """Start the background scheduler."""
    global _scheduler_task, _scheduler_running

    if _scheduler_running:
        print("[Scheduler] Scheduler already running")
        return

    _scheduler_running = True
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    print("[Scheduler] Scheduler started")


def stop_scheduler():
    """Stop the background scheduler."""
    global _scheduler_task, _scheduler_running

    _scheduler_running = False

    if _scheduler_task:
        _scheduler_task.cancel()
        _scheduler_task = None

    print("[Scheduler] Scheduler stopped")


async def trigger_crawl(monitor_id: str) -> dict:
    """
    Trigger an immediate crawl for a specific monitor.
    This bypasses the scheduler timing checks.
    """
    monitor = get_monitor(monitor_id)
    if not monitor:
        return {"error": "Monitor not found"}

    if not monitor.get("competitors"):
        return {"error": "No competitors to crawl"}

    print(f"[Scheduler] Manual crawl triggered for: {monitor['name']}")
    result = await crawl_monitor(monitor_id)
    return result


def is_scheduler_running() -> bool:
    """Check if the scheduler is currently running."""
    return _scheduler_running
