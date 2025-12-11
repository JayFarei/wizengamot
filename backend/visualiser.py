"""
Visualiser mode: Generate diagrams from content using AI image generation.
"""
import base64
import logging
import uuid
from pathlib import Path
from typing import Dict, Any, Optional

import httpx

from .settings import (
    get_openrouter_api_key,
    get_visualiser_model,
    get_diagram_style,
)
from .config import OPENROUTER_API_URL

logger = logging.getLogger(__name__)

# Image storage directory
IMAGES_DIR = Path("data/images")


def ensure_images_dir():
    """Ensure the images directory exists."""
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def get_diagram_style_prompt(style: str) -> Optional[str]:
    """
    Get the prompt for a specific diagram style from settings.

    Args:
        style: Style key (bento, whiteboard, system_diagram, napkin, cheatsheet, cartoon, or custom)

    Returns:
        The prompt for that style, or None if not found
    """
    style_data = get_diagram_style(style)
    if not style_data:
        logger.error(f"Unknown diagram style: {style}")
        return None

    return style_data.get("prompt")


async def generate_diagram(
    content: str,
    style: str,
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate a diagram image from content using specified style.

    Args:
        content: Source content to visualize
        style: Diagram style key (bento, whiteboard, system_diagram, napkin, cheatsheet, cartoon, or custom)
        model: Model to use (defaults to configured visualiser model)

    Returns:
        {
            "image_id": str,
            "image_path": str,
            "style": str,
            "model": str,
            "error": Optional[str]
        }
    """
    if model is None:
        model = get_visualiser_model()

    api_key = get_openrouter_api_key()
    if not api_key:
        return {"error": "No OpenRouter API key configured"}

    # Get style prompt
    style_prompt = get_diagram_style_prompt(style)
    if not style_prompt:
        return {"error": f"Unknown diagram style: {style}"}

    # Build the full prompt - append content to the style prompt
    # The style prompts end with "Context for the infographic:"
    # Add explicit instruction to generate an image, not just describe it
    full_prompt = f"""IMPORTANT: You MUST generate an actual image. Do NOT describe or plan the infographic - actually create and output the image file.

{style_prompt}
{content}

Remember: Output the actual image, not a description."""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": full_prompt}
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()

            # Extract image data from response
            image_data = extract_image_from_response(data)

            if not image_data:
                # If no image, return the text response as error context
                text_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                return {
                    "error": f"No image generated. Model response: {text_content[:500]}",
                    "model": model,
                    "style": style
                }

            # Save image to file
            image_id = str(uuid.uuid4())
            image_path = save_image(image_id, image_data)

            return {
                "image_id": image_id,
                "image_path": str(image_path),
                "style": style,
                "model": model,
                "error": None
            }

    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error generating diagram: {e.response.status_code} - {e.response.text}")
        return {"error": f"API error: {e.response.status_code}"}
    except Exception as e:
        logger.error(f"Failed to generate diagram: {e}")
        return {"error": str(e)}


async def edit_diagram(
    image_path: str,
    edit_prompt: str,
    source_content: str,
    style: str,
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Edit an existing diagram based on user prompt.

    Args:
        image_path: Path to the existing image file
        edit_prompt: User's edit instruction
        source_content: Original content used to generate the diagram
        style: Diagram style
        model: Model to use (defaults to configured visualiser model)

    Returns:
        {
            "image_id": str,
            "image_path": str,
            "style": str,
            "model": str,
            "error": Optional[str]
        }
    """
    if model is None:
        model = get_visualiser_model()

    api_key = get_openrouter_api_key()
    if not api_key:
        return {"error": "No OpenRouter API key configured"}

    # Read and encode the existing image
    try:
        image_file = Path(image_path)
        if not image_file.exists():
            return {"error": f"Image file not found: {image_path}"}
        image_bytes = image_file.read_bytes()
        base64_image = base64.b64encode(image_bytes).decode("utf-8")
    except Exception as e:
        logger.error(f"Failed to read image file: {e}")
        return {"error": f"Failed to read image: {e}"}

    # Get style prompt for context
    style_prompt = get_diagram_style_prompt(style)
    style_context = style_prompt[:500] if style_prompt else ""

    # Build the edit prompt with context
    full_prompt = f"""IMPORTANT: You MUST generate an actual image. Do NOT describe or plan changes - actually create and output the modified image file.

You are editing an existing infographic. Here is the context:

Original content summary (for reference):
{source_content[:1500]}

Style guidelines:
{style_context}

EDIT INSTRUCTION: {edit_prompt}

Generate a new version of the infographic with the requested changes applied. Output the actual image, not a description."""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": full_prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}"
                        }
                    }
                ]
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()

            # Extract image data from response
            image_data = extract_image_from_response(data)

            if not image_data:
                text_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                return {
                    "error": f"No image generated. Model response: {text_content[:500]}",
                    "model": model,
                    "style": style
                }

            # Save new image
            image_id = str(uuid.uuid4())
            new_image_path = save_image(image_id, image_data)

            return {
                "image_id": image_id,
                "image_path": str(new_image_path),
                "style": style,
                "model": model,
                "error": None
            }

    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error editing diagram: {e.response.status_code} - {e.response.text}")
        return {"error": f"API error: {e.response.status_code}"}
    except Exception as e:
        logger.error(f"Failed to edit diagram: {e}")
        return {"error": str(e)}


def extract_image_from_response(response: Dict) -> Optional[bytes]:
    """
    Extract base64 image data from API response.

    Handles various response formats from different models.
    """
    try:
        choices = response.get("choices", [])
        if not choices:
            return None

        message = choices[0].get("message", {})

        # Check for images array (Gemini format)
        images = message.get("images", [])
        if images:
            for img in images:
                if isinstance(img, dict):
                    # Format: {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,...'}}
                    if img.get("type") == "image_url":
                        url = img.get("image_url", {}).get("url", "")
                        if url.startswith("data:image"):
                            base64_data = url.split(",", 1)[1]
                            return base64.b64decode(base64_data)
                    # Direct data format
                    if "data" in img:
                        return base64.b64decode(img["data"])

        content = message.get("content")

        if content is None:
            return None

        # Handle string content (base64 data URL format)
        if isinstance(content, str):
            # Check for data URL format: data:image/png;base64,<data>
            if content.startswith("data:image"):
                try:
                    base64_data = content.split(",", 1)[1]
                    return base64.b64decode(base64_data)
                except (IndexError, ValueError) as e:
                    logger.error(f"Failed to parse data URL: {e}")
                    return None

            # Check for raw base64 (no prefix)
            # Try to decode as base64 if it looks like base64
            if len(content) > 100 and not content.startswith(("{", "[", "#", "I ")):
                try:
                    return base64.b64decode(content)
                except Exception:
                    pass

            return None

        # Handle array content format (multimodal response)
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    # Check for image type
                    if item.get("type") == "image":
                        image_data = item.get("data") or item.get("image")
                        if image_data:
                            return base64.b64decode(image_data)

                    # Check for image_url format
                    if item.get("type") == "image_url":
                        url = item.get("image_url", {}).get("url", "")
                        if url.startswith("data:image"):
                            base64_data = url.split(",", 1)[1]
                            return base64.b64decode(base64_data)

        return None

    except Exception as e:
        logger.error(f"Failed to extract image from response: {e}")
        return None


def save_image(image_id: str, image_data: bytes) -> Path:
    """Save image to disk and return path."""
    ensure_images_dir()
    image_path = IMAGES_DIR / f"{image_id}.png"
    image_path.write_bytes(image_data)
    logger.info(f"Saved image to {image_path}")
    return image_path


def get_image_path(image_id: str) -> Optional[Path]:
    """Get path to an image by ID."""
    # Validate image_id to prevent path traversal
    if ".." in image_id or "/" in image_id or "\\" in image_id:
        logger.warning(f"Invalid image_id attempted: {image_id}")
        return None

    image_path = IMAGES_DIR / f"{image_id}.png"
    if image_path.exists():
        return image_path
    return None


def list_images() -> list[Dict[str, Any]]:
    """List all saved images."""
    ensure_images_dir()
    images = []

    for filepath in sorted(IMAGES_DIR.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True):
        images.append({
            "image_id": filepath.stem,
            "filename": filepath.name,
            "path": str(filepath),
            "size": filepath.stat().st_size,
        })

    return images


def delete_image(image_id: str) -> bool:
    """Delete an image by ID."""
    image_path = get_image_path(image_id)
    if image_path and image_path.exists():
        image_path.unlink()
        logger.info(f"Deleted image {image_id}")
        return True
    return False


# Spell check prompt for Stage 1 (error detection)
SPELL_CHECK_PROMPT = """You are a meticulous proofreader whose ONLY job is to find textual errors in an attached image.

1. Scope
   - Focus exclusively on written text: spelling, grammar, word order, pluralization, missing words, and obviously wrong phrasing.
   - Ignore layout, colors, icons, drawings, fonts, arrows, or any other stylistic or design detail.

2. How to inspect the image
   - Work LEFT → RIGHT and TOP → BOTTOM.
   - For EACH text block, read EVERY word in order.
   - Zoom your attention especially to:
     - Small fonts and dense paragraphs.
     - Text near borders/margins and near image edges.
     - Words that are partially cropped or visually compressed.
     - Hyphenated or line-wrapped words.
   - For each word, ask:
     - "Is this a valid dictionary word, common acronym, brand, or proper noun in this context?"
     - If not clearly valid, treat it as a *potential* typo and try to infer the intended correct word.
   - Be strict with near-misses:
     - Detect swapped letters (e.g., "Hsalth" → "Health").
     - Detect missing letters (e.g., "Structurs" → "Structures").
     - Detect extra letters (e.g., "Sstisfsction" → "Satisfaction").
     - Detect incorrect singular/plural and verb agreement.
   - If you are uncertain whether a word is a brand name or a typo:
     - Flag it as a possible error and propose the most likely correction.

3. Output format
   A. List of identified issues
      - For EACH issue, include:
        - The EXACT text as it appears in the image.
        - The corrected version.
        - (Optional, brief) why it's wrong (e.g., "missing letter", "typo", "wrong plural").
   B. Change-request prompt for an image model
      - Write a clean, ready-to-paste prompt that:
        - States that the reference image is attached.
        - Instructs the model to recreate the image IDENTICALLY (layout, style, icons, colors, spacing).
        - Specifies that ONLY the text must change, according to the corrections you listed.
        - Explicitly lists all corrected phrases/sentences in their full, corrected form.
        - Explicitly says: "No other stylistic or layout changes."

4. Constraints
   - Do NOT invent new wording or rephrase sentences beyond fixing clear errors.
   - Do NOT suggest design/layout improvements.
   - If no issues are found, say:
     - A. "No spelling or text errors found."
     - B. "No changes needed."
"""


def parse_spell_check_response(response_text: str) -> Dict[str, Any]:
    """
    Parse the spell check response to extract errors and corrected prompt.

    Returns:
        {
            "errors_found": list of spelling errors,
            "corrected_prompt": the prompt to regenerate with fixes,
            "has_errors": bool
        }
    """
    errors_found = []
    corrected_prompt = ""

    # Split into sections A and B
    text = response_text.strip()

    # Try to find section markers
    section_a_start = -1
    section_b_start = -1

    # Look for "A." or "A:" or "A)" markers
    for marker in ["A.", "A:", "A)"]:
        idx = text.find(marker)
        if idx != -1 and (section_a_start == -1 or idx < section_a_start):
            section_a_start = idx

    for marker in ["B.", "B:", "B)"]:
        idx = text.find(marker)
        if idx != -1 and (section_b_start == -1 or idx < section_b_start):
            section_b_start = idx

    # Extract section A (errors)
    if section_a_start != -1 and section_b_start != -1:
        section_a_text = text[section_a_start:section_b_start].strip()
        # Remove the "A." prefix
        for prefix in ["A.", "A:", "A)"]:
            if section_a_text.startswith(prefix):
                section_a_text = section_a_text[len(prefix):].strip()
                break

        # Check if no errors
        no_error_phrases = ["no spelling error", "no error", "none found", "no mistakes", "no issues"]
        if any(phrase in section_a_text.lower() for phrase in no_error_phrases):
            errors_found = []
        else:
            # Parse errors (usually as bullet points or numbered list)
            lines = section_a_text.split('\n')
            for line in lines:
                line = line.strip()
                # Remove bullet points, numbers, dashes
                line = line.lstrip('-*•0123456789.)').strip()
                if line and len(line) > 2:
                    errors_found.append(line)

    # Extract section B (corrected prompt)
    if section_b_start != -1:
        section_b_text = text[section_b_start:].strip()
        # Remove the "B." prefix
        for prefix in ["B.", "B:", "B)"]:
            if section_b_text.startswith(prefix):
                section_b_text = section_b_text[len(prefix):].strip()
                break

        # Check if no changes needed
        no_change_phrases = ["no change", "no correction", "not needed", "none needed"]
        if any(phrase in section_b_text.lower() for phrase in no_change_phrases):
            corrected_prompt = ""
        else:
            corrected_prompt = section_b_text

    has_errors = len(errors_found) > 0 and bool(corrected_prompt)

    return {
        "errors_found": errors_found,
        "corrected_prompt": corrected_prompt,
        "has_errors": has_errors
    }


async def spell_check_diagram(
    image_path: str,
    source_content: str,
    style: str,
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Spell check a diagram image and generate a corrected version if errors are found.

    Stage 1: Send image to GPT-5.1 to identify spelling errors
    Stage 2: If errors found, regenerate image with corrections using visualiser model

    Args:
        image_path: Path to the existing image file
        source_content: Original content used to generate the diagram
        style: Diagram style
        model: Model to use for regeneration (defaults to configured visualiser model)

    Returns:
        {
            "image_id": str (new image if errors found, None if no errors),
            "image_path": str,
            "style": str,
            "model": str,
            "errors_found": list,
            "corrected_prompt": str,
            "has_errors": bool,
            "error": Optional[str]
        }
    """
    api_key = get_openrouter_api_key()
    if not api_key:
        return {"error": "No OpenRouter API key configured"}

    # Read and encode the existing image
    try:
        image_file = Path(image_path)
        if not image_file.exists():
            return {"error": f"Image file not found: {image_path}"}
        image_bytes = image_file.read_bytes()
        base64_image = base64.b64encode(image_bytes).decode("utf-8")
    except Exception as e:
        logger.error(f"Failed to read image file: {e}")
        return {"error": f"Failed to read image: {e}"}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Stage 1: Send to Gemini for error detection
    spell_check_model = "google/gemini-3-pro-preview"

    stage1_payload = {
        "model": spell_check_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": SPELL_CHECK_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}"
                        }
                    }
                ]
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=stage1_payload
            )
            response.raise_for_status()

            data = response.json()
            response_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not response_text:
                return {"error": "No response from spell check model"}

            # Parse the response
            parsed = parse_spell_check_response(response_text)

            # If no errors found, return early
            if not parsed["has_errors"]:
                return {
                    "image_id": None,
                    "image_path": None,
                    "style": style,
                    "model": spell_check_model,
                    "errors_found": parsed["errors_found"],
                    "corrected_prompt": "",
                    "has_errors": False,
                    "error": None
                }

            # Stage 2: Regenerate with corrections using edit_diagram
            logger.info(f"Spell check found {len(parsed['errors_found'])} errors, regenerating...")

            edit_result = await edit_diagram(
                image_path,
                parsed["corrected_prompt"],
                source_content,
                style,
                model
            )

            if edit_result.get("error"):
                return {
                    "error": edit_result["error"],
                    "errors_found": parsed["errors_found"],
                    "corrected_prompt": parsed["corrected_prompt"],
                    "has_errors": True
                }

            return {
                "image_id": edit_result["image_id"],
                "image_path": edit_result["image_path"],
                "style": style,
                "model": edit_result["model"],
                "errors_found": parsed["errors_found"],
                "corrected_prompt": parsed["corrected_prompt"],
                "has_errors": True,
                "error": None
            }

    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error during spell check: {e.response.status_code} - {e.response.text}")
        return {"error": f"API error: {e.response.status_code}"}
    except Exception as e:
        logger.error(f"Failed to spell check diagram: {e}")
        return {"error": str(e)}
