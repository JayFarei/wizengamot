import os
import re

import httpx
import pytest

from backend.config import OPENROUTER_API_URL
from backend.settings import get_council_models, get_model_pool, get_openrouter_api_key


RUN_ENV = "RUN_OPENROUTER_SMOKE"


def _should_run() -> bool:
    return os.getenv(RUN_ENV, "").strip() == "1"


def _ping_model(model: str) -> str:
    api_key = get_openrouter_api_key()
    if not api_key:
        pytest.skip("OpenRouter API key not configured (set OPENROUTER_API_KEY or settings.json)")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with the single word: pong"}],
        "max_tokens": 8,
        "temperature": 0,
    }

    with httpx.Client(timeout=45.0) as client:
        response = client.post(OPENROUTER_API_URL, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"].get("content") or ""
    return content.strip()


def test_council_models_are_in_pool():
    pool = get_model_pool()
    council = get_council_models()
    assert len(pool) == len(set(pool))
    assert len(council) == len(set(council))
    assert set(council).issubset(set(pool))


@pytest.mark.parametrize("model", get_model_pool())
def test_openrouter_model_smoke(model: str):
    if not _should_run():
        pytest.skip(f"Set {RUN_ENV}=1 to run paid network smoke tests")

    content = _ping_model(model)
    assert content, f"Empty response content for {model}"
    assert re.match(r"^pong\\b", content.lower()), f"Unexpected response for {model}: {content!r}"

