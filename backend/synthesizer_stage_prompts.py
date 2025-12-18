"""
Stage prompt management for Synthesizer Deliberation mode.
These prompts control the ranking (Stage 2) and synthesis (Stage 3) phases
when using council deliberation for note generation.
"""

import os
from pathlib import Path
from typing import Dict, Optional

# Directory for synthesizer stage prompts
PROMPTS_DIR = Path(os.getenv('PROMPTS_DIR', 'prompts'))
SYNTH_STAGE_PROMPTS_DIR = PROMPTS_DIR / 'synthesizer'

# Built-in default prompts for synthesizer deliberation
DEFAULT_SYNTH_RANKING_PROMPT = '''You are evaluating different Zettelkasten note summaries created from the same source content.

ORIGINAL SOURCE CONTENT:
{source_content}

Here are the note summaries from different models (anonymized):

{responses_text}

Your task:
1. For each set of notes, evaluate:
   - Coverage: How well do the notes capture the key ideas from the source?
   - Atomicity: Are notes properly atomic (one concept per note)?
   - Quality: Are titles concise (<6 words)? Tags relevant? Bodies ~100 words?
   - Unique insights: What valuable perspectives does each set bring?

2. Identify the BEST elements from each response that should be preserved in the final synthesis.

3. Provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")

After the ranking, list KEY ELEMENTS TO PRESERVE from each response.

Example format:

Response A covers the main concepts well but misses some nuance...
Response B has excellent atomic notes but fewer unique insights...

FINAL RANKING:
1. Response B
2. Response A

KEY ELEMENTS TO PRESERVE:
- From Response A: [specific notes or insights worth keeping]
- From Response B: [specific notes or insights worth keeping]

Now provide your evaluation and ranking:'''

DEFAULT_SYNTH_CHAIRMAN_PROMPT = '''You are the Chairman synthesizing the best Zettelkasten notes from multiple AI-generated summaries.

ORIGINAL SOURCE CONTENT:
{source_content}

STAGE 1 - Individual Note Sets from Each Model:
{stage1_text}

STAGE 2 - Peer Evaluations and Rankings:
{stage2_text}

Your task as Chairman:
1. Create a final set of Zettelkasten notes that combines the BEST elements from all summaries
2. Ensure NO duplicate concepts, merge similar notes intelligently
3. Preserve unique insights that only appeared in one summary
4. Consider the peer rankings when deciding which notes to prioritize
5. Follow the standard Zettelkasten format strictly:

# Title (under 6 words)

#tag1 #tag2

Body paragraph (~100 words explaining the concept)

Generate the final, comprehensive set of notes. Each note should be separated by a blank line:'''


def _ensure_synth_stage_dir():
    """Ensure the synthesizer stage prompts directory exists."""
    SYNTH_STAGE_PROMPTS_DIR.mkdir(parents=True, exist_ok=True)


def _read_prompt_file(filename: str) -> Optional[str]:
    """Read a prompt file, extracting content after the markdown title."""
    filepath = SYNTH_STAGE_PROMPTS_DIR / filename
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
    _ensure_synth_stage_dir()
    filepath = SYNTH_STAGE_PROMPTS_DIR / filename
    full_content = f'# {title}\n\n{content}'
    filepath.write_text(full_content, encoding='utf-8')


def get_synth_stage_prompt(prompt_type: str) -> Dict:
    """
    Get a synthesizer stage prompt (ranking or chairman).

    Args:
        prompt_type: Either 'ranking' or 'chairman'

    Returns:
        Dict with 'type', 'content', 'is_default', 'title'
    """
    if prompt_type not in ('ranking', 'chairman'):
        raise ValueError(f"Invalid prompt type: {prompt_type}. Must be 'ranking' or 'chairman'")

    filename = f'synth_{prompt_type}.md'
    content = _read_prompt_file(filename)

    if content:
        return {
            'type': prompt_type,
            'content': content,
            'is_default': False,
            'title': 'Synthesizer Stage 2 Ranking Prompt' if prompt_type == 'ranking' else 'Synthesizer Stage 3 Chairman Prompt'
        }

    # Return built-in default
    default_content = DEFAULT_SYNTH_RANKING_PROMPT if prompt_type == 'ranking' else DEFAULT_SYNTH_CHAIRMAN_PROMPT
    return {
        'type': prompt_type,
        'content': default_content,
        'is_default': True,
        'title': 'Synthesizer Stage 2 Ranking Prompt' if prompt_type == 'ranking' else 'Synthesizer Stage 3 Chairman Prompt'
    }


def get_synth_ranking_prompt_content() -> str:
    """Get the synthesizer ranking prompt content for use in synthesizer.py."""
    return get_synth_stage_prompt('ranking')['content']


def get_synth_chairman_prompt_content() -> str:
    """Get the synthesizer chairman prompt content for use in synthesizer.py."""
    return get_synth_stage_prompt('chairman')['content']


def update_synth_stage_prompt(prompt_type: str, content: str) -> Dict:
    """
    Update a synthesizer stage prompt with custom content.

    Args:
        prompt_type: Either 'ranking' or 'chairman'
        content: New prompt content

    Returns:
        Dict with updated prompt info
    """
    if prompt_type not in ('ranking', 'chairman'):
        raise ValueError(f"Invalid prompt type: {prompt_type}. Must be 'ranking' or 'chairman'")

    title = 'Synthesizer Stage 2 Ranking Prompt' if prompt_type == 'ranking' else 'Synthesizer Stage 3 Chairman Prompt'
    _write_prompt_file(f'synth_{prompt_type}.md', title, content)

    return {
        'type': prompt_type,
        'content': content,
        'is_default': False,
        'title': title
    }


def reset_synth_stage_prompt(prompt_type: str) -> Dict:
    """
    Reset a synthesizer stage prompt to the built-in default.

    Args:
        prompt_type: Either 'ranking' or 'chairman'

    Returns:
        Dict with reset prompt info
    """
    if prompt_type not in ('ranking', 'chairman'):
        raise ValueError(f"Invalid prompt type: {prompt_type}. Must be 'ranking' or 'chairman'")

    # Delete the custom file if it exists
    filepath = SYNTH_STAGE_PROMPTS_DIR / f'synth_{prompt_type}.md'
    if filepath.exists():
        filepath.unlink()

    # Return the default
    default_content = DEFAULT_SYNTH_RANKING_PROMPT if prompt_type == 'ranking' else DEFAULT_SYNTH_CHAIRMAN_PROMPT
    return {
        'type': prompt_type,
        'content': default_content,
        'is_default': True,
        'title': 'Synthesizer Stage 2 Ranking Prompt' if prompt_type == 'ranking' else 'Synthesizer Stage 3 Chairman Prompt'
    }


def list_synth_stage_prompts() -> list:
    """
    List all synthesizer stage prompts with their status.

    Returns:
        List of dicts with prompt info
    """
    return [
        get_synth_stage_prompt('ranking'),
        get_synth_stage_prompt('chairman')
    ]
