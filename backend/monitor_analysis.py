"""
Monitor semantic analysis using LLM.
Analyzes page content to extract structured information and detect meaningful changes.
"""

import json
from typing import Optional
import numpy as np

from .openrouter import query_model
from .settings import get_openrouter_api_key
from .search import get_embedding


# Question sets for different use cases
# Prompt for analyzing discovered pages and selecting which to track
PAGE_SELECTION_PROMPT = """You are a competitive intelligence analyst. Given a list of pages discovered on {company_name}'s website, recommend which pages to track for ongoing competitive monitoring.

An analyst tracking a competitor wants to understand:
1. OFFERINGS: What products/services do they sell? Features? Pricing?
2. POSITIONING: How do they differentiate? Who do they compare against?
3. CUSTOMERS: Who trusts them? Logo walls, case studies, press releases
4. DIRECTION: What's new? Roadmap, changelog, recent announcements
5. HIRING: How are they growing? Careers page, open roles, team expansion
6. PARTNERSHIPS: Integrations, ecosystem, technology partners

Given these discovered pages:
{pages_list}

Categorize them into tracking tiers:

MINIMUM (3-5 pages): Core pages, pricing, main product, and one signal page
SUGGESTED (8-15 pages): Full analyst watchlist, product, pricing, customers, careers, blog
GENEROUS (20-30 pages): Comprehensive, add case studies, integrations, press, all features
ALL: Every page (for maximum coverage)

IMPORTANT: Always include careers/jobs pages in SUGGESTED and above, hiring is a key signal.
IMPORTANT: Always include customer logos/case studies pages, social proof changes matter.

For each tier, list the specific URLs and categorize each page by type (pricing, features, careers, customers, blog, press, integrations, docs, about, homepage, other).

Return ONLY valid JSON in this exact format:
{{
  "minimum": [
    {{"url": "https://...", "type": "pricing", "reason": "Core pricing info"}}
  ],
  "suggested": [
    {{"url": "https://...", "type": "careers", "reason": "Hiring signals"}}
  ],
  "generous": [
    {{"url": "https://...", "type": "case_study", "reason": "Customer wins"}}
  ],
  "all": [
    {{"url": "https://...", "type": "blog", "reason": "Content strategy"}}
  ],
  "reasoning": "Brief explanation of tier selections and key pages identified"
}}
"""

STRUCTURE_CHANGE_PROMPT = """You are a competitive intelligence analyst. The following pages have appeared/disappeared from {company_name}'s website since last check:

ADDED PAGES:
{added_pages}

REMOVED PAGES:
{removed_pages}

What might these changes indicate about {company_name}'s strategy?
Consider: new products, discontinued offerings, rebrands, pivots, new target markets, partnerships, team changes.

Return ONLY valid JSON:
{{
  "analysis": "Your strategic interpretation of these changes",
  "signals": ["list of strategic signals detected"],
  "confidence": "high|medium|low",
  "recommended_actions": ["suggestions for what to investigate further"]
}}
"""

HIRING_ANALYSIS_PROMPT = """Analyze the following careers/jobs page content from {company_name}:

{page_content}

Extract hiring information and return ONLY valid JSON:
{{
  "total_open_roles": 0,
  "departments": {{
    "engineering": 0,
    "sales": 0,
    "marketing": 0,
    "product": 0,
    "operations": 0,
    "customer_success": 0,
    "other": 0
  }},
  "locations": ["list of locations mentioned"],
  "seniority_breakdown": {{
    "leadership": 0,
    "senior": 0,
    "mid": 0,
    "entry": 0
  }},
  "notable_roles": ["any interesting/revealing job titles"],
  "tech_stack_hints": ["technologies mentioned in job descriptions"],
  "growth_signal": "expanding|stable|contracting",
  "analysis": "Brief interpretation of what this hiring pattern suggests about company strategy"
}}
"""

CUSTOMER_EXTRACTION_PROMPT = """Analyze the following page content from {company_name} that may contain customer evidence:

{page_content}

Extract customer information and return ONLY valid JSON:
{{
  "customer_logos_detected": ["list of company names visible as logos or mentioned as customers"],
  "named_customers": ["companies explicitly mentioned as customers"],
  "case_studies": ["customer names with case studies mentioned"],
  "industries_represented": ["industries these customers represent"],
  "company_sizes": ["enterprise", "mid-market", "smb"],
  "partnerships_announced": ["any partnership/integration announcements"],
  "total_customers_claimed": null,
  "analysis": "Brief interpretation of customer base and market positioning"
}}
"""


QUESTION_SETS = {
    "default_b2b_saas_v1": {
        "icp": "Who is the ideal customer? What company size, industry, and role does this product target?",
        "problem": "What problem does this product solve? What pain points does it address?",
        "value_props": "What are the main value propositions? What benefits does the product claim to provide?",
        "pricing": "What is the pricing model? Are there tiers? Is there a free tier or trial?",
        "security": "What security or compliance claims are made? (SOC 2, HIPAA, GDPR, etc.)",
        "themes": "What are the key messaging themes and positioning? How does the product differentiate itself?"
    }
}


def get_question_set(name: str = "default_b2b_saas_v1") -> dict:
    """Get a question set by name."""
    return QUESTION_SETS.get(name, QUESTION_SETS["default_b2b_saas_v1"])


ANALYSIS_PROMPT = """Analyze the following web page content and answer each question in JSON format.
Be concise but capture the key points. If information is not available, respond with "Not specified" or "Unknown".

Content:
{content}

Questions to answer:
{questions}

Respond ONLY with valid JSON in this exact format:
{{
  "icp": "your answer about ideal customer profile",
  "problem": "your answer about the problem solved",
  "value_props": "your answer about value propositions",
  "pricing": "your answer about pricing",
  "security": "your answer about security/compliance",
  "themes": "your answer about key themes",
  "summary": "A 1-2 sentence summary of the most important points"
}}
"""


async def analyze_page(text: str, question_set_name: str = "default_b2b_saas_v1") -> Optional[dict]:
    """
    Analyze page content using LLM to extract structured information.

    Returns a dict with answers to each question in the question set, plus a summary.
    """
    api_key = get_openrouter_api_key()
    if not api_key:
        return None

    question_set = get_question_set(question_set_name)

    # Format questions for the prompt
    questions_text = "\n".join([
        f"- {key}: {question}"
        for key, question in question_set.items()
    ])

    # Truncate content if too long
    max_content_length = 15000
    content = text[:max_content_length] if len(text) > max_content_length else text

    prompt = ANALYSIS_PROMPT.format(
        content=content,
        questions=questions_text
    )

    response = await query_model(
        model="anthropic/claude-sonnet-4",
        messages=[{"role": "user", "content": prompt}]
    )

    if not response or not response.get("content"):
        return None

    # Parse JSON response
    try:
        # Try to extract JSON from the response
        response_text = response["content"]

        # Look for JSON block
        if "```json" in response_text:
            json_start = response_text.index("```json") + 7
            json_end = response_text.index("```", json_start)
            response_text = response_text[json_start:json_end].strip()
        elif "```" in response_text:
            json_start = response_text.index("```") + 3
            json_end = response_text.index("```", json_start)
            response_text = response_text[json_start:json_end].strip()

        answers = json.loads(response_text)
        return answers

    except (json.JSONDecodeError, ValueError) as e:
        print(f"Error parsing analysis response: {e}")
        # Return a minimal structure with the raw response
        return {
            "summary": response.get("content", "")[:500],
            "parse_error": str(e)
        }


def detect_change(current_text: str, previous_snapshot: Optional[dict], threshold: float = 0.15) -> dict:
    """
    Detect if content has meaningfully changed using hash comparison and semantic similarity.

    Returns:
        dict with:
        - changed: bool - whether content changed at all
        - meaningful: bool - whether the change is semantically meaningful
        - similarity: float - cosine similarity (1.0 = identical, 0.0 = completely different)
    """
    if not previous_snapshot:
        return {"changed": True, "meaningful": True, "similarity": 0.0}

    # Quick hash check
    import hashlib
    current_hash = hashlib.sha256(current_text.encode('utf-8')).hexdigest()
    previous_hash = previous_snapshot.get("text_hash")

    if current_hash == previous_hash:
        return {"changed": False, "meaningful": False, "similarity": 1.0}

    # Content changed - check semantic similarity
    try:
        current_embedding = get_embedding(current_text[:8000])
        previous_embedding = previous_snapshot.get("embedding")

        if previous_embedding is None:
            return {"changed": True, "meaningful": True, "similarity": 0.0}

        # Convert to numpy arrays
        current_vec = np.array(current_embedding)
        previous_vec = np.array(previous_embedding)

        # Cosine similarity
        similarity = np.dot(current_vec, previous_vec) / (
            np.linalg.norm(current_vec) * np.linalg.norm(previous_vec)
        )

        # Meaningful if similarity is below threshold (content is different enough)
        meaningful = (1.0 - similarity) > threshold

        return {
            "changed": True,
            "meaningful": meaningful,
            "similarity": float(similarity)
        }

    except Exception as e:
        print(f"Error computing similarity: {e}")
        return {"changed": True, "meaningful": True, "similarity": 0.0}


def compute_diff(current_answers: dict, previous_answers: Optional[dict]) -> dict:
    """
    Compute semantic diff between current and previous answers.

    Returns a dict mapping each field to its change status:
    - "unchanged": values are the same
    - "changed": value was modified
    - "added": value is new (was not specified before)
    - "removed": value was removed (now not specified)
    """
    if not previous_answers:
        return {key: "added" for key in current_answers if key != "summary" and key != "parse_error"}

    diff = {}

    for key in set(list(current_answers.keys()) + list(previous_answers.keys())):
        if key in ["summary", "parse_error"]:
            continue

        current_val = current_answers.get(key, "").lower().strip()
        previous_val = previous_answers.get(key, "").lower().strip()

        # Handle "not specified" and similar
        current_empty = current_val in ["", "not specified", "unknown", "n/a"]
        previous_empty = previous_val in ["", "not specified", "unknown", "n/a"]

        if current_empty and previous_empty:
            diff[key] = "unchanged"
        elif current_empty and not previous_empty:
            diff[key] = "removed"
        elif not current_empty and previous_empty:
            diff[key] = "added"
        elif current_val == previous_val:
            diff[key] = "unchanged"
        else:
            diff[key] = "changed"

    return diff


def derive_impact_tags(diff: dict) -> list[str]:
    """
    Derive impact tags from a diff.

    Returns a list of field names that have meaningful changes.
    """
    tags = []

    # High-impact fields
    high_impact = ["pricing", "security", "icp"]

    for key, status in diff.items():
        if status in ["changed", "added", "removed"]:
            tags.append(key)

            # Add a "high_impact" tag if a critical field changed
            if key in high_impact and "high_impact" not in tags:
                tags.append("high_impact")

    return tags


async def analyze_with_diff(
    current_text: str,
    previous_snapshot: Optional[dict],
    question_set_name: str = "default_b2b_saas_v1"
) -> dict:
    """
    Full analysis pipeline: analyze current content and compute diff from previous.

    Returns:
        dict with:
        - answers: dict of extracted information
        - summary: string summary of the page
        - diff: dict of changes from previous
        - impact_tags: list of affected areas
        - change_detection: dict with similarity info
    """
    # Detect change first
    change_detection = detect_change(current_text, previous_snapshot)

    # If no meaningful change, skip expensive LLM analysis
    if not change_detection["meaningful"]:
        return {
            "answers": previous_snapshot.get("answers") if previous_snapshot else None,
            "summary": "No meaningful changes detected",
            "diff": {},
            "impact_tags": [],
            "change_detection": change_detection
        }

    # Analyze current content
    answers = await analyze_page(current_text, question_set_name)

    if not answers:
        return {
            "answers": None,
            "summary": "Analysis failed",
            "diff": {},
            "impact_tags": [],
            "change_detection": change_detection
        }

    # Compute diff from previous
    previous_answers = previous_snapshot.get("answers") if previous_snapshot else None
    diff = compute_diff(answers, previous_answers)

    # Derive impact tags
    impact_tags = derive_impact_tags(diff)

    return {
        "answers": answers,
        "summary": answers.get("summary", ""),
        "diff": diff,
        "impact_tags": impact_tags,
        "change_detection": change_detection
    }


def _parse_json_response(response_text: str) -> Optional[dict]:
    """Helper to extract and parse JSON from LLM response."""
    try:
        # Look for JSON block
        if "```json" in response_text:
            json_start = response_text.index("```json") + 7
            json_end = response_text.index("```", json_start)
            response_text = response_text[json_start:json_end].strip()
        elif "```" in response_text:
            json_start = response_text.index("```") + 3
            json_end = response_text.index("```", json_start)
            response_text = response_text[json_start:json_end].strip()

        return json.loads(response_text)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"Error parsing JSON response: {e}")
        return None


async def analyze_pages_for_tracking(pages: list[dict], company_name: str) -> Optional[dict]:
    """
    Analyze discovered pages and categorize them into tracking tiers.

    Args:
        pages: List of {"url": str, "title": str | None} from map_website()
        company_name: Name of the company being analyzed

    Returns:
        {
            "minimum": [{"url": str, "type": str, "reason": str}, ...],
            "suggested": [...],
            "generous": [...],
            "all": [...],
            "reasoning": str
        }
    """
    api_key = get_openrouter_api_key()
    if not api_key:
        return None

    # Format pages list for prompt
    pages_text = "\n".join([
        f"- {p.get('url')}" + (f" ({p.get('title')})" if p.get('title') else "")
        for p in pages[:200]  # Limit to avoid token overflow
    ])

    prompt = PAGE_SELECTION_PROMPT.format(
        company_name=company_name,
        pages_list=pages_text
    )

    response = await query_model(
        model="anthropic/claude-sonnet-4",
        messages=[{"role": "user", "content": prompt}]
    )

    if not response or not response.get("content"):
        return None

    result = _parse_json_response(response["content"])

    if not result:
        # Return a basic structure if parsing fails
        return {
            "minimum": [{"url": pages[0]["url"], "type": "homepage", "reason": "Main page"} for p in pages[:3] if pages],
            "suggested": [],
            "generous": [],
            "all": [{"url": p["url"], "type": "other", "reason": ""} for p in pages],
            "reasoning": "Auto-fallback due to parsing error"
        }

    return result


async def analyze_structural_changes(
    changes: dict,
    company_name: str
) -> Optional[dict]:
    """
    Analyze site structure changes and provide strategic interpretation.

    Args:
        changes: Output from compare_site_structure() with "added" and "removed" pages
        company_name: Name of the company

    Returns:
        {
            "analysis": str,
            "signals": [str, ...],
            "confidence": str,
            "recommended_actions": [str, ...]
        }
    """
    if not changes.get("has_changes"):
        return {
            "analysis": "No structural changes detected",
            "signals": [],
            "confidence": "high",
            "recommended_actions": []
        }

    api_key = get_openrouter_api_key()
    if not api_key:
        return None

    # Format pages for prompt
    added_text = "\n".join([
        f"- {p.get('url')}" + (f" ({p.get('title')})" if p.get('title') else "")
        for p in changes.get("added", [])
    ]) or "None"

    removed_text = "\n".join([
        f"- {p.get('url')}" + (f" ({p.get('title')})" if p.get('title') else "")
        for p in changes.get("removed", [])
    ]) or "None"

    prompt = STRUCTURE_CHANGE_PROMPT.format(
        company_name=company_name,
        added_pages=added_text,
        removed_pages=removed_text
    )

    response = await query_model(
        model="anthropic/claude-sonnet-4",
        messages=[{"role": "user", "content": prompt}]
    )

    if not response or not response.get("content"):
        return None

    return _parse_json_response(response["content"])


async def extract_hiring_data(page_content: str, company_name: str) -> Optional[dict]:
    """
    Extract structured hiring data from a careers/jobs page.

    Args:
        page_content: Markdown content of the careers page
        company_name: Name of the company

    Returns:
        {
            "total_open_roles": int,
            "departments": {...},
            "locations": [...],
            "seniority_breakdown": {...},
            "notable_roles": [...],
            "tech_stack_hints": [...],
            "growth_signal": str,
            "analysis": str
        }
    """
    api_key = get_openrouter_api_key()
    if not api_key:
        return None

    # Truncate content if too long
    max_length = 15000
    content = page_content[:max_length] if len(page_content) > max_length else page_content

    prompt = HIRING_ANALYSIS_PROMPT.format(
        company_name=company_name,
        page_content=content
    )

    response = await query_model(
        model="anthropic/claude-sonnet-4",
        messages=[{"role": "user", "content": prompt}]
    )

    if not response or not response.get("content"):
        return None

    return _parse_json_response(response["content"])


async def extract_customer_data(page_content: str, company_name: str) -> Optional[dict]:
    """
    Extract structured customer data from a customers/case studies page.

    Args:
        page_content: Markdown content of the page
        company_name: Name of the company

    Returns:
        {
            "customer_logos_detected": [...],
            "named_customers": [...],
            "case_studies": [...],
            "industries_represented": [...],
            "company_sizes": [...],
            "partnerships_announced": [...],
            "total_customers_claimed": int | None,
            "analysis": str
        }
    """
    api_key = get_openrouter_api_key()
    if not api_key:
        return None

    # Truncate content if too long
    max_length = 15000
    content = page_content[:max_length] if len(page_content) > max_length else page_content

    prompt = CUSTOMER_EXTRACTION_PROMPT.format(
        company_name=company_name,
        page_content=content
    )

    response = await query_model(
        model="anthropic/claude-sonnet-4",
        messages=[{"role": "user", "content": prompt}]
    )

    if not response or not response.get("content"):
        return None

    return _parse_json_response(response["content"])


def compare_extracted_data(current: dict, previous: dict, data_type: str) -> dict:
    """
    Compare current and previous extracted data to identify changes.

    Args:
        current: Current extracted data (hiring or customer)
        previous: Previous extracted data
        data_type: "hiring" or "customers"

    Returns:
        {
            "has_changes": bool,
            "changes": [...],
            "summary": str
        }
    """
    if not previous:
        return {
            "has_changes": True,
            "changes": ["Initial data capture"],
            "summary": "First extraction, no previous data to compare"
        }

    changes = []

    if data_type == "hiring":
        # Compare total roles
        prev_roles = previous.get("total_open_roles", 0)
        curr_roles = current.get("total_open_roles", 0)
        if curr_roles != prev_roles:
            diff = curr_roles - prev_roles
            direction = "increased" if diff > 0 else "decreased"
            changes.append(f"Open roles {direction} from {prev_roles} to {curr_roles}")

        # Compare growth signal
        prev_signal = previous.get("growth_signal")
        curr_signal = current.get("growth_signal")
        if prev_signal != curr_signal:
            changes.append(f"Growth signal changed from {prev_signal} to {curr_signal}")

        # Compare departments
        prev_depts = previous.get("departments", {})
        curr_depts = current.get("departments", {})
        for dept, count in curr_depts.items():
            prev_count = prev_depts.get(dept, 0)
            if count != prev_count:
                changes.append(f"{dept.title()} roles: {prev_count} -> {count}")

    elif data_type == "customers":
        # Compare customer lists
        prev_customers = set(previous.get("customer_logos_detected", []))
        curr_customers = set(current.get("customer_logos_detected", []))

        new_customers = curr_customers - prev_customers
        lost_customers = prev_customers - curr_customers

        if new_customers:
            changes.append(f"New customers: {', '.join(list(new_customers)[:5])}")
        if lost_customers:
            changes.append(f"Removed customers: {', '.join(list(lost_customers)[:5])}")

        # Compare industries
        prev_industries = set(previous.get("industries_represented", []))
        curr_industries = set(current.get("industries_represented", []))
        new_industries = curr_industries - prev_industries
        if new_industries:
            changes.append(f"New industries: {', '.join(new_industries)}")

    summary = "; ".join(changes) if changes else "No significant changes"

    return {
        "has_changes": len(changes) > 0,
        "changes": changes,
        "summary": summary
    }
