"""
Debug script to test Firecrawl API against competitor URLs.
Run with: uv run python -m backend.tests.debug_firecrawl
"""

import asyncio
import sys
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(__file__).rsplit("/", 2)[0])

from backend.monitor_crawler import map_website
from backend.settings import get_firecrawl_api_key


# Security AI competitors to test
SECURITY_COMPETITORS = [
    {"name": "Virtue AI", "url": "https://www.virtueai.com/"},
    {"name": "SPLX AI", "url": "https://splx.ai/"},
    {"name": "Robust Intelligence", "url": "https://www.robustintelligence.com/"},
    {"name": "General Analysis", "url": "https://www.generalanalysis.com/"},
    {"name": "Lakera", "url": "https://lakera.ai/"},
    {"name": "Dynamo AI", "url": "https://dynamo.ai/"},
]

# Also test URL variations for Dynamo AI (the one that failed)
DYNAMO_VARIATIONS = [
    "https://dynamo.ai/",
    "http://dynamo.ai/",
    "https://www.dynamo.ai/",
    "https://dynamo.ai",  # Without trailing slash
]


async def test_single_url(name: str, url: str) -> dict:
    """Test a single URL with Firecrawl."""
    print(f"\n{'='*60}")
    print(f"Testing: {name}")
    print(f"URL: {url}")
    print("="*60)

    start = datetime.now()
    result = await map_website(url, limit=50)  # Limit to 50 for faster testing
    elapsed = (datetime.now() - start).total_seconds()

    return {
        "name": name,
        "url": url,
        "success": result.get("success", False),
        "pages_found": result.get("total_found", 0),
        "error": result.get("error"),
        "elapsed_seconds": elapsed
    }


async def main():
    """Run all tests."""
    print("\n" + "="*60)
    print("FIRECRAWL DEBUG TEST")
    print("="*60)

    # Check API key first
    api_key = get_firecrawl_api_key()
    if not api_key:
        print("ERROR: Firecrawl API key not configured!")
        print("Set it via the Settings UI or in data/config/settings.json")
        return

    print(f"API Key: {api_key[:8]}...{api_key[-4:]}")

    results = []

    # Test all competitors
    print("\n\n" + "="*60)
    print("TESTING ALL COMPETITORS")
    print("="*60)

    for competitor in SECURITY_COMPETITORS:
        result = await test_single_url(competitor["name"], competitor["url"])
        results.append(result)

        if result["success"]:
            print(f"SUCCESS: Found {result['pages_found']} pages in {result['elapsed_seconds']:.1f}s")
        else:
            print(f"FAILED: {result['error']}")

    # Test Dynamo AI URL variations
    print("\n\n" + "="*60)
    print("TESTING DYNAMO AI URL VARIATIONS")
    print("="*60)

    for url in DYNAMO_VARIATIONS:
        result = await test_single_url(f"Dynamo AI ({url})", url)

        if result["success"]:
            print(f"SUCCESS: Found {result['pages_found']} pages in {result['elapsed_seconds']:.1f}s")
        else:
            print(f"FAILED: {result['error']}")

    # Summary
    print("\n\n" + "="*60)
    print("SUMMARY")
    print("="*60)

    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]

    print(f"\nSuccessful ({len(successful)}/{len(results)}):")
    for r in successful:
        print(f"  - {r['name']}: {r['pages_found']} pages")

    print(f"\nFailed ({len(failed)}/{len(results)}):")
    for r in failed:
        print(f"  - {r['name']}: {r['error']}")

    # Return results for potential further processing
    return results


if __name__ == "__main__":
    asyncio.run(main())
