"""
Stage prompt management for Council mode.
Stage prompts control the ranking (Stage 2) and synthesis (Stage 3) phases.
"""

import os
from pathlib import Path
from typing import Dict, Optional

# Directory for stage prompts (now part of council prompts)
PROMPTS_DIR = Path(os.getenv('PROMPTS_DIR', 'prompts'))
STAGE_PROMPTS_DIR = PROMPTS_DIR / 'council'

# Built-in default prompts (used when no custom prompt exists)
DEFAULT_RANKING_PROMPT = '''You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:'''

DEFAULT_CHAIRMAN_PROMPT = '''You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:'''


def _ensure_stage_dir():
    """Ensure the stage prompts directory exists."""
    STAGE_PROMPTS_DIR.mkdir(parents=True, exist_ok=True)


def _read_prompt_file(filename: str) -> Optional[str]:
    """Read a prompt file, extracting content after the markdown title."""
    filepath = STAGE_PROMPTS_DIR / filename
    if not filepath.exists():
        return None

    content = filepath.read_text(encoding='utf-8')

    # Skip the markdown title line if present
    lines = content.split('\n')
    if lines and lines[0].startswith('# '):
        content = '\n'.join(lines[1:]).strip()

    return content


def _write_prompt_file(filename: str, title: str, content: str):
    """Write a prompt file with markdown title."""
    _ensure_stage_dir()
    filepath = STAGE_PROMPTS_DIR / filename
    full_content = f'# {title}\n\n{content}'
    filepath.write_text(full_content, encoding='utf-8')


def get_stage_prompt(prompt_type: str) -> Dict:
    """
    Get a stage prompt (ranking or chairman).

    Args:
        prompt_type: Either 'ranking' or 'chairman'

    Returns:
        Dict with 'type', 'content', 'is_default', 'title'
    """
    if prompt_type not in ('ranking', 'chairman'):
        raise ValueError(f"Invalid prompt type: {prompt_type}. Must be 'ranking' or 'chairman'")

    filename = f'{prompt_type}.md'
    content = _read_prompt_file(filename)

    if content:
        return {
            'type': prompt_type,
            'content': content,
            'is_default': False,
            'title': 'Stage 2 Ranking Prompt' if prompt_type == 'ranking' else 'Stage 3 Chairman Synthesis Prompt'
        }

    # Return built-in default
    default_content = DEFAULT_RANKING_PROMPT if prompt_type == 'ranking' else DEFAULT_CHAIRMAN_PROMPT
    return {
        'type': prompt_type,
        'content': default_content,
        'is_default': True,
        'title': 'Stage 2 Ranking Prompt' if prompt_type == 'ranking' else 'Stage 3 Chairman Synthesis Prompt'
    }


def get_ranking_prompt_content() -> str:
    """Get the ranking prompt content for use in council.py."""
    return get_stage_prompt('ranking')['content']


def get_chairman_prompt_content() -> str:
    """Get the chairman prompt content for use in council.py."""
    return get_stage_prompt('chairman')['content']


def update_stage_prompt(prompt_type: str, content: str) -> Dict:
    """
    Update a stage prompt with custom content.

    Args:
        prompt_type: Either 'ranking' or 'chairman'
        content: New prompt content

    Returns:
        Dict with updated prompt info
    """
    if prompt_type not in ('ranking', 'chairman'):
        raise ValueError(f"Invalid prompt type: {prompt_type}. Must be 'ranking' or 'chairman'")

    title = 'Stage 2 Ranking Prompt' if prompt_type == 'ranking' else 'Stage 3 Chairman Synthesis Prompt'
    _write_prompt_file(f'{prompt_type}.md', title, content)

    return {
        'type': prompt_type,
        'content': content,
        'is_default': False,
        'title': title
    }


def reset_stage_prompt(prompt_type: str) -> Dict:
    """
    Reset a stage prompt to the built-in default.

    Args:
        prompt_type: Either 'ranking' or 'chairman'

    Returns:
        Dict with reset prompt info
    """
    if prompt_type not in ('ranking', 'chairman'):
        raise ValueError(f"Invalid prompt type: {prompt_type}. Must be 'ranking' or 'chairman'")

    # Delete the custom file if it exists
    filepath = STAGE_PROMPTS_DIR / f'{prompt_type}.md'
    if filepath.exists():
        filepath.unlink()

    # Return the default
    default_content = DEFAULT_RANKING_PROMPT if prompt_type == 'ranking' else DEFAULT_CHAIRMAN_PROMPT
    return {
        'type': prompt_type,
        'content': default_content,
        'is_default': True,
        'title': 'Stage 2 Ranking Prompt' if prompt_type == 'ranking' else 'Stage 3 Chairman Synthesis Prompt'
    }


def list_stage_prompts() -> list:
    """
    List all stage prompts with their status.

    Returns:
        List of dicts with prompt info
    """
    return [
        get_stage_prompt('ranking'),
        get_stage_prompt('chairman')
    ]
