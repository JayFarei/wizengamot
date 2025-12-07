"""
Monitor conversational interface.
Parses natural language commands into monitor operations and handles Q&A.
"""

import json
import re
from typing import Optional, AsyncIterator

from .monitors import (
    get_monitor, update_monitor, add_competitor, remove_competitor,
    add_page, remove_page, add_message, get_messages
)
from .openrouter import query_model
from .settings import get_openrouter_api_key


MONITOR_SYSTEM_PROMPT = """You are a competitive intelligence assistant helping users track and analyze competitor websites over time.

Your role is to:
1. Help users set up monitors to track competitor websites
2. Parse their natural language descriptions into structured competitor/page configurations
3. Answer questions about tracked competitors and changes
4. Generate insights and reports from the collected data

When a user wants to set up tracking, extract:
- Competitor names
- URLs to track (homepage, pricing, security/trust pages, etc.)
- Page types (homepage, pricing, security, blog, etc.)

When responding about configuration changes, always confirm what you understood and what actions you're taking.

IMPORTANT: When the user provides competitors to track, respond with a JSON block in your response that I can parse. Format:
```json
{
  "action": "add_competitors",
  "competitors": [
    {
      "name": "CompanyName",
      "pages": [
        {"url": "https://example.com/", "type": "homepage"},
        {"url": "https://example.com/pricing", "type": "pricing"}
      ]
    }
  ]
}
```

Other supported actions:
- "remove_competitor": {"action": "remove_competitor", "competitor_id": "company_name"}
- "add_page": {"action": "add_page", "competitor_id": "company_name", "url": "...", "type": "..."}
- "remove_page": {"action": "remove_page", "competitor_id": "company_name", "page_id": "..."}
- "trigger_crawl": {"action": "trigger_crawl"}

If the user is just chatting or asking questions (not configuring), respond normally without a JSON block.
"""


def _extract_json_action(text: str) -> Optional[dict]:
    """Extract JSON action block from assistant response."""
    # Look for ```json ... ``` blocks
    json_match = re.search(r'```json\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # Try to find raw JSON object
    json_match = re.search(r'\{[^{}]*"action"[^{}]*\}', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass

    return None


def _build_context(monitor: dict) -> str:
    """Build context string describing the current monitor state."""
    if not monitor["competitors"]:
        return "This monitor is not tracking any competitors yet."

    lines = [f"Monitor: {monitor['name']}", "Currently tracking:"]

    for comp in monitor["competitors"]:
        lines.append(f"\n{comp['name']} ({comp['id']}):")
        for page in comp["pages"]:
            lines.append(f"  - {page['type']}: {page['url']}")

    if monitor.get("last_crawl_at"):
        lines.append(f"\nLast crawl: {monitor['last_crawl_at']}")

    stats = monitor.get("stats", {})
    if stats.get("total_updates", 0) > 0:
        lines.append(f"Total updates recorded: {stats['total_updates']}")

    return "\n".join(lines)


async def process_monitor_message(monitor_id: str, user_message: str) -> dict:
    """Process a user message in the context of a monitor."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        return {"error": "Monitor not found"}

    # Save user message
    add_message(monitor_id, "user", user_message)

    # Build conversation history
    messages = get_messages(monitor_id)
    context = _build_context(monitor)

    # Prepare messages for LLM
    llm_messages = [
        {"role": "system", "content": MONITOR_SYSTEM_PROMPT + f"\n\nCurrent state:\n{context}"}
    ]

    # Add recent conversation history (last 10 messages)
    for msg in messages[-10:]:
        llm_messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    # Query LLM
    api_key = get_openrouter_api_key()
    if not api_key:
        return {"error": "API key not configured"}

    response = await query_model(
        model="anthropic/claude-sonnet-4",
        messages=llm_messages
    )

    if not response:
        return {"error": "Failed to get response from LLM"}

    assistant_content = response.get("content", "")

    # Check for action in response
    action = _extract_json_action(assistant_content)
    action_result = None

    if action:
        action_result = await _execute_action(monitor_id, action)

    # Save assistant message
    add_message(monitor_id, "assistant", assistant_content, metadata={"action": action, "action_result": action_result})

    # Refresh monitor to get updated state
    monitor = get_monitor(monitor_id)

    return {
        "content": assistant_content,
        "action": action,
        "action_result": action_result,
        "monitor": monitor
    }


async def process_monitor_message_stream(monitor_id: str, user_message: str) -> AsyncIterator[str]:
    """Process a user message with streaming response."""
    monitor = get_monitor(monitor_id)
    if not monitor:
        yield f"data: {json.dumps({'error': 'Monitor not found'})}\n\n"
        return

    # Save user message
    add_message(monitor_id, "user", user_message)

    # Build conversation history
    messages = get_messages(monitor_id)
    context = _build_context(monitor)

    # Prepare messages for LLM
    llm_messages = [
        {"role": "system", "content": MONITOR_SYSTEM_PROMPT + f"\n\nCurrent state:\n{context}"}
    ]

    # Add recent conversation history (last 10 messages)
    for msg in messages[-10:]:
        llm_messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    # Query LLM (non-streaming for now, will add streaming later)
    api_key = get_openrouter_api_key()
    if not api_key:
        yield f"data: {json.dumps({'error': 'API key not configured'})}\n\n"
        return

    response = await query_model(
        model="anthropic/claude-sonnet-4",
        messages=llm_messages
    )

    if not response:
        yield f"data: {json.dumps({'error': 'Failed to get response from LLM'})}\n\n"
        return

    assistant_content = response.get("content", "")

    # Check for action in response
    action = _extract_json_action(assistant_content)
    action_result = None

    if action:
        action_result = await _execute_action(monitor_id, action)

    # Save assistant message
    add_message(monitor_id, "assistant", assistant_content, metadata={"action": action, "action_result": action_result})

    # Stream content in chunks
    chunk_size = 50
    for i in range(0, len(assistant_content), chunk_size):
        chunk = assistant_content[i:i + chunk_size]
        yield f"data: {json.dumps({'content': chunk})}\n\n"

    # Send final message with action results
    yield f"data: {json.dumps({'done': True, 'action': action, 'action_result': action_result})}\n\n"


async def _execute_action(monitor_id: str, action: dict) -> dict:
    """Execute a parsed action on the monitor."""
    action_type = action.get("action")
    result = {"success": False, "message": "Unknown action"}

    if action_type == "add_competitors":
        added = []
        for comp_data in action.get("competitors", []):
            comp = add_competitor(
                monitor_id,
                comp_data["name"],
                comp_data.get("pages", [])
            )
            if comp:
                added.append(comp["name"])
        result = {"success": True, "message": f"Added competitors: {', '.join(added)}", "added": added}

    elif action_type == "remove_competitor":
        competitor_id = action.get("competitor_id")
        if remove_competitor(monitor_id, competitor_id):
            result = {"success": True, "message": f"Removed competitor: {competitor_id}"}
        else:
            result = {"success": False, "message": f"Competitor not found: {competitor_id}"}

    elif action_type == "add_page":
        page = add_page(
            monitor_id,
            action.get("competitor_id"),
            action.get("url"),
            action.get("type", "page")
        )
        if page:
            result = {"success": True, "message": f"Added page: {page['url']}"}
        else:
            result = {"success": False, "message": "Failed to add page"}

    elif action_type == "remove_page":
        if remove_page(monitor_id, action.get("competitor_id"), action.get("page_id")):
            result = {"success": True, "message": "Page removed"}
        else:
            result = {"success": False, "message": "Page not found"}

    elif action_type == "trigger_crawl":
        # Will be implemented in Milestone 2
        result = {"success": True, "message": "Crawl triggered (not yet implemented)"}

    return result
