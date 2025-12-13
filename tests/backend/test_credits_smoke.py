import os

import httpx
import pytest

from backend.settings import get_openrouter_api_key

OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits"
RUN_ENV = "RUN_OPENROUTER_SMOKE"


def _should_run() -> bool:
    return os.getenv(RUN_ENV, "").strip() == "1"


def test_credits_endpoint():
    """Test the OpenRouter credits API returns expected fields."""
    if not _should_run():
        pytest.skip(f"Set {RUN_ENV}=1 to run paid network smoke tests")

    api_key = get_openrouter_api_key()
    if not api_key:
        pytest.skip("OpenRouter API key not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
    }

    with httpx.Client(timeout=30.0) as client:
        response = client.get(OPENROUTER_CREDITS_URL, headers=headers)
        response.raise_for_status()
        data = response.json()

    print(f"Credits API response: {data}")

    # Verify response structure
    assert "data" in data, f"Missing 'data' key in response: {data}"
    credits_data = data["data"]

    assert "total_credits" in credits_data, f"Missing 'total_credits': {credits_data}"
    assert "total_usage" in credits_data, f"Missing 'total_usage': {credits_data}"

    # Verify we can calculate remaining
    total_credits = credits_data["total_credits"]
    total_usage = credits_data["total_usage"]
    remaining = total_credits - total_usage

    print(f"Total credits: {total_credits}")
    print(f"Total usage: {total_usage}")
    print(f"Remaining: {remaining}")

    assert isinstance(total_credits, (int, float)), "total_credits should be numeric"
    assert isinstance(total_usage, (int, float)), "total_usage should be numeric"
