"""
End-to-end tests for the Monitor Competitor feature.
Uses real Firecrawl API calls against live security AI competitor sites.

Run with:
  uv run pytest backend/tests/test_monitor_e2e.py -v -s

Or standalone:
  uv run python -m backend.tests.test_monitor_e2e
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Ensure we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Optional pytest import for when running as test suite
try:
    import pytest
    HAS_PYTEST = True
except ImportError:
    HAS_PYTEST = False
    # Create a dummy pytest module for standalone mode
    class DummyPytest:
        def fixture(self, *args, **kwargs):
            def decorator(f):
                return f
            return decorator
        class mark:
            @staticmethod
            def asyncio(f):
                return f
        def skip(self, msg):
            print(f"SKIP: {msg}")
    pytest = DummyPytest()

from backend.monitor_crawler import map_website, crawl_page, crawl_monitor
from backend.monitor_analysis import analyze_pages_for_tracking
from backend.monitors import (
    create_monitor, get_monitor, delete_monitor, add_competitor, list_monitors
)
from backend.settings import get_firecrawl_api_key


# =============================================================================
# Test Configuration
# =============================================================================

SECURITY_COMPETITORS = [
    {"name": "Virtue AI", "url": "https://www.virtueai.com/"},
    {"name": "SPLX AI", "url": "https://splx.ai/"},
    {"name": "Robust Intelligence", "url": "https://www.robustintelligence.com/"},
    {"name": "General Analysis", "url": "https://www.generalanalysis.com/"},
    {"name": "Lakera", "url": "https://lakera.ai/"},
    {"name": "Dynamo AI", "url": "https://dynamo.ai/"},
]

# Test state directory
TEST_STATE_DIR = Path("data/test_runs")
TEST_STATE_FILE = TEST_STATE_DIR / "security_competitors_baseline.json"

# Rate limit handling: seconds to wait between API calls
RATE_LIMIT_DELAY = 12  # Firecrawl free tier: 6 req/min = 1 every 10s, add buffer


# =============================================================================
# Helper Functions
# =============================================================================

def ensure_test_dir():
    """Ensure test state directory exists."""
    TEST_STATE_DIR.mkdir(parents=True, exist_ok=True)


def load_baseline() -> Optional[dict]:
    """Load existing baseline state if available."""
    if TEST_STATE_FILE.exists():
        with open(TEST_STATE_FILE, "r") as f:
            return json.load(f)
    return None


def save_baseline(state: dict):
    """Save test state as baseline for future comparisons."""
    ensure_test_dir()
    with open(TEST_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    print(f"\nBaseline saved to: {TEST_STATE_FILE}")


def compare_with_baseline(current: dict, baseline: dict) -> dict:
    """Compare current state with baseline and return diff."""
    diff = {
        "changed_pages": [],
        "new_pages": [],
        "removed_pages": [],
        "unchanged_pages": [],
        "errors": []
    }

    # Build lookup from baseline
    baseline_snapshots = {}
    for comp in baseline.get("competitors", []):
        for snapshot in comp.get("snapshots", []):
            key = f"{comp['name']}:{snapshot['page_id']}"
            baseline_snapshots[key] = snapshot

    # Compare current to baseline
    for comp in current.get("competitors", []):
        for snapshot in comp.get("snapshots", []):
            key = f"{comp['name']}:{snapshot['page_id']}"

            if key in baseline_snapshots:
                old = baseline_snapshots[key]
                if snapshot.get("text_hash") != old.get("text_hash"):
                    diff["changed_pages"].append({
                        "competitor": comp["name"],
                        "page_id": snapshot["page_id"],
                        "old_hash": old.get("text_hash", "")[:16],
                        "new_hash": snapshot.get("text_hash", "")[:16],
                    })
                else:
                    diff["unchanged_pages"].append({
                        "competitor": comp["name"],
                        "page_id": snapshot["page_id"],
                    })
                del baseline_snapshots[key]
            else:
                diff["new_pages"].append({
                    "competitor": comp["name"],
                    "page_id": snapshot["page_id"],
                })

    # Remaining in baseline are removed pages
    for key, snapshot in baseline_snapshots.items():
        comp_name = key.split(":")[0]
        diff["removed_pages"].append({
            "competitor": comp_name,
            "page_id": snapshot["page_id"],
        })

    return diff


# =============================================================================
# Test Class
# =============================================================================

class TestMonitorCompetitors:
    """E2E tests for monitor competitor feature using real Firecrawl API."""

    monitor_id: Optional[str] = None
    test_state: dict = {}

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures."""
        # Check API key
        api_key = get_firecrawl_api_key()
        if not api_key:
            pytest.skip("Firecrawl API key not configured")

        ensure_test_dir()
        yield

    @pytest.mark.asyncio
    async def test_01_create_monitor(self):
        """Test creating a Security Competitors monitor."""
        monitor = create_monitor("Security Competitors Test", "default_b2b_saas_v1")
        assert monitor is not None
        assert "id" in monitor

        TestMonitorCompetitors.monitor_id = monitor["id"]
        TestMonitorCompetitors.test_state = {
            "monitor_id": monitor["id"],
            "created_at": datetime.utcnow().isoformat() + "Z",
            "competitors": []
        }

        print(f"\nCreated monitor: {monitor['id']}")

    @pytest.mark.asyncio
    async def test_02_discover_pages(self):
        """Test discovering pages for each competitor (with rate limiting)."""
        assert TestMonitorCompetitors.monitor_id is not None

        results = []

        for i, competitor in enumerate(SECURITY_COMPETITORS[:3]):  # Test first 3 to avoid rate limits
            print(f"\n[{i+1}/3] Discovering pages for {competitor['name']}...")

            # Wait for rate limit
            if i > 0:
                print(f"  Waiting {RATE_LIMIT_DELAY}s for rate limit...")
                await asyncio.sleep(RATE_LIMIT_DELAY)

            result = await map_website(competitor["url"], limit=30)

            results.append({
                "name": competitor["name"],
                "url": competitor["url"],
                "success": result.get("success", False),
                "pages_found": result.get("total_found", 0),
                "error": result.get("error")
            })

            if result.get("success"):
                print(f"  SUCCESS: Found {result['total_found']} pages")
            else:
                print(f"  FAILED: {result.get('error')}")

        # At least 2 of 3 should succeed
        successful = [r for r in results if r["success"]]
        assert len(successful) >= 2, f"Only {len(successful)}/3 sites succeeded"

    @pytest.mark.asyncio
    async def test_03_add_competitors(self):
        """Test adding competitors to monitor."""
        assert TestMonitorCompetitors.monitor_id is not None
        monitor_id = TestMonitorCompetitors.monitor_id

        # Add first 2 competitors (to stay within rate limits)
        for i, competitor in enumerate(SECURITY_COMPETITORS[:2]):
            print(f"\n[{i+1}/2] Adding {competitor['name']}...")

            if i > 0:
                await asyncio.sleep(RATE_LIMIT_DELAY)

            # Discover pages
            result = await map_website(competitor["url"], limit=20)

            if not result.get("success"):
                print(f"  Skipping {competitor['name']}: {result.get('error')}")
                continue

            # Analyze pages for tracking
            pages = result.get("pages", [])
            tiers = await analyze_pages_for_tracking(pages, competitor["name"])

            if not tiers:
                # Fallback tier
                tiers = {
                    "minimum": [{"url": pages[0]["url"], "type": "homepage", "reason": "Main page"}] if pages else [],
                    "suggested": [],
                    "generous": [],
                    "all": [{"url": p["url"], "type": "other", "reason": ""} for p in pages[:5]],
                }

            # Add competitor with suggested tier
            tier_pages = tiers.get("suggested", tiers.get("minimum", []))[:5]  # Limit pages
            comp = add_competitor(
                monitor_id,
                competitor["name"],
                domain=competitor["url"],
                pages=tier_pages,
                site_map_baseline=pages,
                tier="suggested"
            )

            if comp:
                print(f"  Added with {len(tier_pages)} pages to track")
                TestMonitorCompetitors.test_state["competitors"].append({
                    "name": competitor["name"],
                    "id": comp["id"],
                    "pages_tracked": len(tier_pages),
                    "snapshots": []
                })
            else:
                print(f"  Failed to add competitor")

        # Verify at least 1 competitor added
        monitor = get_monitor(monitor_id)
        assert len(monitor.get("competitors", [])) >= 1

    @pytest.mark.asyncio
    async def test_04_crawl_pages(self):
        """Test crawling pages and creating snapshots."""
        assert TestMonitorCompetitors.monitor_id is not None
        monitor_id = TestMonitorCompetitors.monitor_id

        monitor = get_monitor(monitor_id)
        assert monitor is not None

        crawl_count = 0

        for comp in monitor.get("competitors", []):
            print(f"\nCrawling {comp['name']}...")

            for page in comp.get("pages", [])[:2]:  # Limit to 2 pages per competitor
                if crawl_count > 0:
                    await asyncio.sleep(RATE_LIMIT_DELAY)

                print(f"  Crawling {page['type']}: {page['url'][:50]}...")

                snapshot = await crawl_page(monitor_id, comp["id"], page["id"])
                crawl_count += 1

                if snapshot:
                    print(f"    Snapshot created: {snapshot['snapshot_id']}")
                    print(f"    Content hash: {snapshot.get('text_hash', 'N/A')[:16]}...")

                    # Record in test state
                    for test_comp in TestMonitorCompetitors.test_state["competitors"]:
                        if test_comp["name"] == comp["name"]:
                            test_comp["snapshots"].append({
                                "page_id": page["id"],
                                "snapshot_id": snapshot["snapshot_id"],
                                "text_hash": snapshot.get("text_hash"),
                                "timestamp": snapshot.get("timestamp"),
                            })
                else:
                    print(f"    Failed to create snapshot")

        assert crawl_count > 0, "No pages were crawled"

    @pytest.mark.asyncio
    async def test_05_compare_with_baseline(self):
        """Compare current state with baseline (if exists)."""
        baseline = load_baseline()

        if baseline is None:
            print("\nNo baseline exists. Saving current state as baseline.")
            save_baseline(TestMonitorCompetitors.test_state)
            return

        print("\nComparing with baseline...")
        diff = compare_with_baseline(TestMonitorCompetitors.test_state, baseline)

        print(f"\n  Changed pages: {len(diff['changed_pages'])}")
        for p in diff['changed_pages']:
            print(f"    - {p['competitor']}/{p['page_id']}: {p['old_hash']} -> {p['new_hash']}")

        print(f"  New pages: {len(diff['new_pages'])}")
        print(f"  Removed pages: {len(diff['removed_pages'])}")
        print(f"  Unchanged pages: {len(diff['unchanged_pages'])}")

        # Update baseline with current state
        save_baseline(TestMonitorCompetitors.test_state)

    @pytest.mark.asyncio
    async def test_99_cleanup(self):
        """Clean up test monitor."""
        if TestMonitorCompetitors.monitor_id:
            print(f"\nCleaning up monitor: {TestMonitorCompetitors.monitor_id}")
            delete_monitor(TestMonitorCompetitors.monitor_id)
            TestMonitorCompetitors.monitor_id = None


# =============================================================================
# CLI Runner
# =============================================================================

async def run_full_test():
    """Run all tests programmatically."""
    print("="*60)
    print("MONITOR COMPETITOR E2E TEST")
    print("="*60)

    # Check prerequisites
    api_key = get_firecrawl_api_key()
    if not api_key:
        print("ERROR: Firecrawl API key not configured!")
        return False

    print(f"API Key: {api_key[:8]}...{api_key[-4:]}")
    ensure_test_dir()

    test = TestMonitorCompetitors()

    try:
        print("\n" + "="*60)
        print("TEST 1: Create Monitor")
        print("="*60)
        await test.test_01_create_monitor()

        print("\n" + "="*60)
        print("TEST 2: Discover Pages")
        print("="*60)
        await test.test_02_discover_pages()

        print("\n" + "="*60)
        print("TEST 3: Add Competitors")
        print("="*60)
        await test.test_03_add_competitors()

        print("\n" + "="*60)
        print("TEST 4: Crawl Pages")
        print("="*60)
        await test.test_04_crawl_pages()

        print("\n" + "="*60)
        print("TEST 5: Compare with Baseline")
        print("="*60)
        await test.test_05_compare_with_baseline()

        print("\n" + "="*60)
        print("ALL TESTS PASSED!")
        print("="*60)
        return True

    except Exception as e:
        print(f"\nTEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup
        await test.test_99_cleanup()


async def check_changes_only():
    """Quick check for changes without full test."""
    print("="*60)
    print("CHECKING FOR CHANGES")
    print("="*60)

    baseline = load_baseline()
    if not baseline:
        print("No baseline exists. Run full test first.")
        return

    print(f"Baseline from: {baseline.get('created_at', 'unknown')}")
    print(f"Monitor ID: {baseline.get('monitor_id', 'unknown')}")

    # Re-crawl and compare
    # (This is a simplified version, full implementation would re-crawl)
    print("\nTo check for changes, run the full test:")
    print("  uv run python -m backend.tests.test_monitor_e2e")


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Monitor Competitor E2E Tests")
    parser.add_argument("--check-changes", action="store_true",
                       help="Quick check for changes without full test")
    args = parser.parse_args()

    if args.check_changes:
        asyncio.run(check_changes_only())
    else:
        success = asyncio.run(run_full_test())
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
