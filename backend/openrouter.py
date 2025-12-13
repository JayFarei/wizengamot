"""OpenRouter API client for making LLM requests."""

import httpx
from typing import List, Dict, Any, Optional
from .config import OPENROUTER_API_URL
from .settings import get_openrouter_api_key

# Base URL for OpenRouter API
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 120.0
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content', optional 'reasoning_details', and 'generation_id', or None if failed
    """
    api_key = get_openrouter_api_key()
    if not api_key:
        print("Error: No OpenRouter API key configured")
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            message = data['choices'][0]['message']

            return {
                'content': message.get('content'),
                'reasoning_details': message.get('reasoning_details'),
                'generation_id': data.get('id')
            }

    except Exception as e:
        print(f"Error querying model {model}: {e}")
        return None


async def get_generation_cost(generation_id: str) -> Optional[float]:
    """
    Fetch the cost for a specific generation from OpenRouter.

    Args:
        generation_id: The generation ID returned from a chat completion

    Returns:
        The total cost in dollars, or None if failed
    """
    if not generation_id:
        return None

    api_key = get_openrouter_api_key()
    if not api_key:
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{OPENROUTER_BASE_URL}/generation?id={generation_id}",
                headers=headers
            )
            response.raise_for_status()

            data = response.json()
            # The cost is in the data.total_cost field
            return data.get('data', {}).get('total_cost')

    except Exception as e:
        print(f"Error fetching generation cost for {generation_id}: {e}")
        return None


async def get_credits() -> Optional[Dict[str, Any]]:
    """
    Fetch the remaining credits from OpenRouter.

    Uses the /api/v1/credits endpoint which returns:
    - total_credits: Total credits purchased
    - total_usage: Total credits used

    Returns:
        Dict with 'total_credits', 'total_usage', and 'remaining' fields, or None if failed
    """
    api_key = get_openrouter_api_key()
    if not api_key:
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{OPENROUTER_BASE_URL}/credits",
                headers=headers
            )
            response.raise_for_status()

            data = response.json()
            credits_data = data.get('data', {})

            total_credits = credits_data.get('total_credits', 0)
            total_usage = credits_data.get('total_usage', 0)

            # Calculate remaining credits
            remaining = total_credits - total_usage

            return {
                'total_credits': total_credits,
                'total_usage': total_usage,
                'remaining': remaining
            }

    except Exception as e:
        print(f"Error fetching credits: {e}")
        return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]]
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to each model

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    # Create tasks for all models
    tasks = [query_model(model, messages) for model in models]

    # Wait for all to complete
    responses = await asyncio.gather(*tasks)

    # Map models to their responses
    return {model: response for model, response in zip(models, responses)}
