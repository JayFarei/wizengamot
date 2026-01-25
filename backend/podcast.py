"""Podcast mode: Generate audio explanations of Synthesizer notes.

Supports two episode modes:
- Explainer: Single narrator explains source material
- Question Time: Host asks questions, expert answers
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from .storage import get_conversation
from .podcast_storage import (
    save_podcast_session,
    get_podcast_session,
    get_podcast_cover_path,
)
from .podcast_qwen import (
    generate_podcast_audio as generate_podcast_audio_qwen,
    save_podcast_audio,
    get_podcast_audio_path,
    check_tts_service,
)
from .podcast_characters import get_character, list_characters
from .settings import (
    get_podcast_cover_prompt,
    get_podcast_cover_model,
    get_synthesizer_model,
)
from .visualiser import generate_diagram
from .openrouter import query_model

logger = logging.getLogger(__name__)


async def generate_podcast_metadata(
    notes: List[Dict[str, Any]],
    style: str = "conversational"
) -> Dict[str, str]:
    """
    Generate an engaging title and summary for a podcast episode using LLM.

    Args:
        notes: List of notes to base the metadata on
        style: Narration style for context

    Returns:
        {
            "title": str,  # Engaging episode title (max 60 chars)
            "summary": str  # Compelling 2-3 sentence description
        }
    """
    # Build notes context
    notes_text = "\n\n".join([
        f"**{note.get('title', 'Untitled')}**\n{note.get('body', '')[:500]}"
        for note in notes[:5]  # Limit to first 5 notes
    ])

    style_context = {
        "rest-is-politics": "witty British political commentary",
        "all-in": "Silicon Valley tech and business analysis",
        "rest-is-history": "engaging historical storytelling",
        "conversational": "friendly conversational",
        "educational": "educational lecture",
        "storytelling": "narrative storytelling",
    }.get(style, "conversational")

    prompt = f"""Generate a podcast episode title and summary based on these notes.

Style: {style_context}

Notes content:
{notes_text}

Requirements:
1. Title: Create a catchy, engaging episode title (max 60 characters). Make it intriguing and clickable, like a popular podcast episode name.
2. Summary: Write a compelling 2-3 sentence description that hooks listeners and explains what they'll learn.

Respond in this exact JSON format (no markdown, just raw JSON):
{{"title": "Your Episode Title Here", "summary": "Your compelling summary here that makes people want to listen."}}"""

    messages = [{"role": "user", "content": prompt}]

    try:
        # Use the configured synthesizer model for metadata generation
        model = get_synthesizer_model()
        result = await query_model(
            model=model,
            messages=messages,
            timeout=30.0
        )

        if result and result.get("content"):
            import json
            content = result["content"].strip()
            # Handle potential markdown code blocks
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            metadata = json.loads(content)
            return {
                "title": metadata.get("title", "Podcast Episode")[:60],
                "summary": metadata.get("summary", "")
            }
    except Exception as e:
        logger.error(f"Failed to generate podcast metadata: {e}")

    # Fallback to simple extraction
    fallback_title = notes[0].get("title", "Podcast Episode") if notes else "Podcast Episode"
    return {
        "title": fallback_title[:60],
        "summary": ""
    }


async def update_session_metadata(session_id: str) -> Dict[str, Any]:
    """
    Generate and update metadata (title, summary) for a podcast session.

    Args:
        session_id: The session ID to update

    Returns:
        Updated metadata or error dict
    """
    session = get_podcast_session(session_id)
    if not session:
        return {"error": "Session not found"}

    notes = session.get("notes", [])
    style = session.get("style", "conversational")

    if not notes:
        return {"error": "No notes in session"}

    logger.info(f"Generating metadata for session {session_id}")

    metadata = await generate_podcast_metadata(notes, style)

    # Update session with generated metadata
    session["title"] = metadata["title"]
    session["summary"] = metadata["summary"]
    save_podcast_session(session)

    logger.info(f"Updated session {session_id} with title: {metadata['title']}")

    return {
        "title": metadata["title"],
        "summary": metadata["summary"],
        "error": None
    }


def create_podcast_session(
    conversation_id: str,
    note_ids: Optional[List[str]] = None,
    style: str = "conversational"
) -> Dict[str, Any]:
    """
    Create a new podcast session from Synthesizer notes.

    Args:
        conversation_id: The synthesizer conversation containing notes
        note_ids: Specific note IDs to include (None = all notes)
        style: Narration style (conversational, educational, storytelling)

    Returns:
        Session metadata

    Raises:
        ValueError: If source conversation not found or has no notes
    """
    # Verify source conversation exists and has notes
    conversation = get_conversation(conversation_id)
    if not conversation:
        raise ValueError("Source conversation not found")

    if conversation.get("mode") != "synthesizer":
        raise ValueError("Source conversation must be a synthesizer conversation")

    # Extract notes from the conversation
    notes = extract_notes_from_conversation(conversation, note_ids)
    if not notes:
        raise ValueError("No notes found in conversation")

    # Generate a title from the first note or conversation title
    title = None
    if notes:
        title = notes[0].get("title", "Untitled")
    if not title and conversation.get("title"):
        title = conversation["title"]
    if not title:
        title = "Podcast Episode"

    # Create session
    session_id = str(uuid.uuid4())

    session = {
        "id": session_id,
        "source_conversation_id": conversation_id,
        "notes": notes,
        "style": style,
        "title": title,
        "summary": "",  # Will be populated by background LLM generation
        "status": "created",
        "created_at": datetime.utcnow().isoformat(),
        # Audio generation fields
        "audio_path": None,
        "audio_duration_ms": None,
        "word_timings": [],
        "dialogue_segments": [],
        "generation_progress": 0,
    }

    # Save the session
    save_podcast_session(session)

    return {
        "session_id": session_id,
        "status": "created",
        "title": title,
        "note_count": len(notes),
    }


def extract_notes_from_conversation(
    conversation: Dict[str, Any],
    note_ids: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    Extract notes from a synthesizer conversation.

    Args:
        conversation: The full conversation object
        note_ids: Optional list of specific note IDs to include

    Returns:
        List of note objects with id, title, body, tags
    """
    all_notes = []

    for msg in conversation.get("messages", []):
        if msg.get("role") == "assistant":
            # Notes can be stored in different formats depending on synthesizer mode
            if msg.get("notes"):
                all_notes.extend(msg["notes"])
            elif msg.get("content") and isinstance(msg.get("content"), dict):
                # Handle structured content format
                if "notes" in msg["content"]:
                    all_notes.extend(msg["content"]["notes"])

    # Filter by note_ids if specified
    if note_ids:
        all_notes = [n for n in all_notes if n.get("id") in note_ids]

    return all_notes


async def extract_questions_from_notes(notes: List[Dict]) -> List[str]:
    """
    Use LLM to extract discussion-worthy questions from notes.

    Extract 8-12 thoughtful questions that:
    - Spark insightful discussion
    - Are answerable from the content
    - Cover key themes

    Args:
        notes: List of notes to extract questions from

    Returns:
        List of question strings
    """
    # Build notes context
    notes_text = "\n\n---\n\n".join([
        f"## {note.get('title', 'Untitled')}\n"
        f"Tags: {', '.join(note.get('tags', []))}\n\n"
        f"{note.get('body', '')}"
        for note in notes
    ])

    prompt = f"""Extract 8-12 thoughtful discussion questions from these research notes.

## Source Material
{notes_text}

## Requirements for Questions
1. Questions should spark insightful discussion
2. Questions should be answerable from the content provided
3. Cover the key themes and most interesting points
4. Include a mix of:
   - "What" questions (facts and concepts)
   - "Why" questions (reasoning and causes)
   - "How" questions (processes and implications)
5. Order from foundational to advanced topics

## Output Format
Return ONLY a JSON array of question strings, no markdown:
["Question 1?", "Question 2?", ...]"""

    messages = [{"role": "user", "content": prompt}]

    try:
        model = get_synthesizer_model()
        result = await query_model(
            model=model,
            messages=messages,
            timeout=60.0
        )

        if result and result.get("content"):
            content = result["content"].strip()
            # Handle potential markdown code blocks
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1])

            questions = json.loads(content)

            if isinstance(questions, list) and len(questions) > 0:
                # Ensure all items are strings
                validated = [q for q in questions if isinstance(q, str) and q.strip()]
                if validated:
                    logger.info(f"Extracted {len(validated)} questions from notes")
                    return validated

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse questions JSON: {e}")
    except Exception as e:
        logger.error(f"Failed to extract questions: {e}")

    # Fallback: generate basic questions from note titles
    logger.warning("Using fallback question extraction")
    fallback_questions = []
    for note in notes:
        title = note.get("title", "")
        if title:
            fallback_questions.append(f"What are the key insights about {title}?")
            fallback_questions.append(f"Why is {title} significant?")

    return fallback_questions[:12]


async def generate_explainer_script(
    notes: List[Dict[str, Any]],
    character: Dict[str, Any],
    style: str = "conversational",
) -> List[Dict[str, str]]:
    """
    Generate a single-narrator explainer script from notes.

    The narrator explains the source material in a flowing, engaging way.

    Args:
        notes: List of notes to explain
        character: The narrator character config
        style: Narration style

    Returns:
        List of dialogue segments: [{"speaker": name, "text": "...", "emotion": "..."}]
    """
    # Build notes text
    notes_text = "\n\n---\n\n".join([
        f"## {note.get('title', 'Untitled')}\n"
        f"Tags: {', '.join(note.get('tags', []))}\n\n"
        f"{note.get('body', '')}"
        for note in notes
    ])

    narrator_name = character.get("name", "Narrator")
    personality = character.get("personality", {})
    traits = personality.get("traits", "knowledgeable and engaging")
    emotion_style = personality.get("emotion_style", "warm and measured")

    style_context = {
        "rest-is-politics": "witty British political commentary with dry humor",
        "all-in": "Silicon Valley tech analysis, direct and opinionated",
        "rest-is-history": "engaging historical storytelling with narrative tension",
        "conversational": "friendly, casual explanation",
        "educational": "structured educational presentation",
        "storytelling": "narrative-driven exploration",
    }.get(style, "engaging explanation")

    prompt = f"""Generate a single-narrator podcast script explaining these research notes.

## Source Material
{notes_text}

## Narrator
Name: {narrator_name}
Personality: {traits}
Default emotion style: {emotion_style}

## Style
{style_context}

## Requirements
1. Create a flowing explanation (20-35 segments)
2. Start with an engaging hook that draws listeners in
3. Explain concepts clearly, building from simple to complex
4. Use examples, analogies, and rhetorical questions
5. Include natural pauses and transitions between topics
6. Vary the emotion based on content (excited for discoveries, thoughtful for analysis)
7. End with a memorable conclusion and takeaway

## Emotion Annotations
Add emotion hints that match the content:
- "enthusiastic" for exciting discoveries
- "thoughtful" for deep analysis
- "warm" for relatable points
- "measured" for careful explanations
- "emphatic" for key takeaways

## Output Format
Return ONLY a JSON array with no markdown:
[
  {{"speaker": "{narrator_name}", "text": "Welcome! Today we're diving into something fascinating...", "emotion": "enthusiastic"}},
  {{"speaker": "{narrator_name}", "text": "Let's start with the basics...", "emotion": "warm"}},
  ...
]"""

    messages = [{"role": "user", "content": prompt}]

    try:
        model = get_synthesizer_model()
        result = await query_model(
            model=model,
            messages=messages,
            timeout=120.0
        )

        if result and result.get("content"):
            content = result["content"].strip()
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1])

            dialogue = json.loads(content)

            if isinstance(dialogue, list) and len(dialogue) > 0:
                validated = []
                for segment in dialogue:
                    if isinstance(segment, dict) and "text" in segment:
                        validated.append({
                            "speaker": segment.get("speaker", narrator_name),
                            "text": segment["text"],
                            "emotion": segment.get("emotion", emotion_style)
                        })
                if validated:
                    logger.info(f"Generated explainer script with {len(validated)} segments")
                    return validated

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse explainer script JSON: {e}")
    except Exception as e:
        logger.error(f"Failed to generate explainer script: {e}")

    # Fallback
    logger.warning("Using fallback explainer script generation")
    fallback = [
        {"speaker": narrator_name, "text": "Welcome! Today we're exploring some fascinating topics.", "emotion": "enthusiastic"},
    ]

    for note in notes:
        title = note.get("title", "this topic")
        body = note.get("body", "")[:500]
        fallback.append({"speaker": narrator_name, "text": f"Let's talk about {title}.", "emotion": "warm"})
        fallback.append({"speaker": narrator_name, "text": body, "emotion": "measured"})

    fallback.append({"speaker": narrator_name, "text": "And that's what you need to know! Thanks for listening.", "emotion": "enthusiastic"})

    return fallback


async def generate_question_time_script(
    notes: List[Dict[str, Any]],
    host_character: Dict[str, Any],
    expert_character: Dict[str, Any],
    questions: List[str],
    style: str = "conversational",
) -> List[Dict[str, str]]:
    """
    Generate a two-speaker Q&A style podcast script.

    The host asks questions and the expert answers based on the notes.

    Args:
        notes: List of notes containing the answers
        host_character: The host character config
        expert_character: The expert character config
        questions: Pre-extracted questions to discuss
        style: Conversation style

    Returns:
        List of dialogue segments: [{"speaker": name, "text": "...", "emotion": "..."}]
    """
    # Build notes text
    notes_text = "\n\n---\n\n".join([
        f"## {note.get('title', 'Untitled')}\n"
        f"Tags: {', '.join(note.get('tags', []))}\n\n"
        f"{note.get('body', '')}"
        for note in notes
    ])

    host_name = host_character.get("name", "Host")
    host_personality = host_character.get("personality", {})
    host_traits = host_personality.get("traits", "curious and engaging")
    host_emotion = host_personality.get("emotion_style", "warm")

    expert_name = expert_character.get("name", "Expert")
    expert_personality = expert_character.get("personality", {})
    expert_traits = expert_personality.get("traits", "knowledgeable and clear")
    expert_emotion = expert_personality.get("emotion_style", "measured")

    questions_text = "\n".join([f"{i+1}. {q}" for i, q in enumerate(questions)])

    style_context = {
        "rest-is-politics": "witty British political commentary with dry humor",
        "all-in": "Silicon Valley tech analysis, direct and opinionated",
        "rest-is-history": "engaging historical storytelling with narrative tension",
        "conversational": "friendly, casual conversation",
        "educational": "structured educational discussion",
        "storytelling": "narrative-driven exploration",
    }.get(style, "engaging conversation")

    prompt = f"""Generate a podcast dialogue where a host interviews an expert about these topics.

## Source Material (for expert's answers)
{notes_text}

## Questions to Cover
{questions_text}

## Host Character
Name: {host_name}
Personality: {host_traits}
Default emotion: {host_emotion}

## Expert Character
Name: {expert_name}
Personality: {expert_traits}
Default emotion: {expert_emotion}

## Style
{style_context}

## Requirements
1. {host_name} introduces the topic and welcomes {expert_name}
2. Work through the questions naturally, not robotically
3. Include natural conversation flow:
   - Follow-up questions when answers spark curiosity
   - Acknowledgments ("That's fascinating!", "Great point!")
   - Brief summaries before moving to new topics
4. {expert_name} answers based on the source material, with examples
5. Vary emotions based on content
6. End with a memorable takeaway and sign-off

## Emotion Annotations
- "enthusiastic" for exciting moments
- "curious" for probing questions
- "thoughtful" for deep analysis
- "warm" for relatable exchanges
- "emphatic" for key points

## Output Format
Return ONLY a JSON array with no markdown:
[
  {{"speaker": "{host_name}", "text": "Welcome to the show!", "emotion": "enthusiastic"}},
  {{"speaker": "{expert_name}", "text": "Thanks for having me!", "emotion": "warm"}},
  {{"speaker": "{host_name}", "text": "Let's dive right in. [question]", "emotion": "curious"}},
  {{"speaker": "{expert_name}", "text": "[answer]", "emotion": "thoughtful"}},
  ...
]"""

    messages = [{"role": "user", "content": prompt}]

    try:
        model = get_synthesizer_model()
        result = await query_model(
            model=model,
            messages=messages,
            timeout=120.0
        )

        if result and result.get("content"):
            content = result["content"].strip()
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1])

            dialogue = json.loads(content)

            if isinstance(dialogue, list) and len(dialogue) > 0:
                validated = []
                for segment in dialogue:
                    if isinstance(segment, dict) and "text" in segment:
                        speaker = segment.get("speaker", host_name)
                        # Determine default emotion based on speaker
                        default_emotion = host_emotion if speaker == host_name else expert_emotion
                        validated.append({
                            "speaker": speaker,
                            "text": segment["text"],
                            "emotion": segment.get("emotion", default_emotion)
                        })
                if validated:
                    logger.info(f"Generated question time script with {len(validated)} segments")
                    return validated

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse question time script JSON: {e}")
    except Exception as e:
        logger.error(f"Failed to generate question time script: {e}")

    # Fallback
    logger.warning("Using fallback question time script generation")
    fallback = [
        {"speaker": host_name, "text": "Welcome to the show! Today we have a fascinating discussion ahead.", "emotion": "enthusiastic"},
        {"speaker": expert_name, "text": "Thanks for having me! I'm excited to dive into this topic.", "emotion": "warm"},
    ]

    for i, question in enumerate(questions[:8]):
        fallback.append({"speaker": host_name, "text": question, "emotion": "curious"})
        # Use note content for answers
        note_idx = i % len(notes)
        answer_text = notes[note_idx].get("body", "That's a great question.")[:500]
        fallback.append({"speaker": expert_name, "text": answer_text, "emotion": "thoughtful"})

    fallback.append({"speaker": host_name, "text": "That's all the time we have today. Thanks for joining us!", "emotion": "warm"})
    fallback.append({"speaker": expert_name, "text": "Thank you! Great conversation.", "emotion": "warm"})

    return fallback


async def generate_dialogue_script_with_mode(
    notes: List[Dict[str, Any]],
    mode: str,
    characters: List[Dict[str, Any]],
    style: str = "conversational",
) -> List[Dict[str, str]]:
    """
    Generate podcast dialogue script with emotion annotations.

    This is the main entry point for script generation, supporting both modes.

    Args:
        notes: List of notes to base the script on
        mode: "explainer" for single narrator, "question_time" for host/expert
        characters: List of character configs with roles
        style: Narration style

    Returns:
        List of dialogue segments with speaker, text, and emotion
    """
    if mode == "explainer":
        # Find narrator character
        narrator = None
        for char in characters:
            if char.get("role") == "narrator":
                narrator = char
                break

        if not narrator:
            # Use first character as narrator
            narrator = characters[0] if characters else {
                "name": "Narrator",
                "personality": {"traits": "knowledgeable and engaging", "emotion_style": "warm"}
            }

        return await generate_explainer_script(notes, narrator, style)

    elif mode == "question_time":
        # Find host and expert characters
        host = None
        expert = None
        for char in characters:
            if char.get("role") == "host":
                host = char
            elif char.get("role") == "expert":
                expert = char

        if not host:
            host = {"name": "Host", "personality": {"traits": "curious and engaging", "emotion_style": "warm"}}
        if not expert:
            expert = {"name": "Expert", "personality": {"traits": "knowledgeable and clear", "emotion_style": "measured"}}

        # Extract questions first
        questions = await extract_questions_from_notes(notes)

        return await generate_question_time_script(notes, host, expert, questions, style)

    else:
        logger.warning(f"Unknown mode '{mode}', defaulting to explainer")
        narrator = characters[0] if characters else {"name": "Narrator", "personality": {}}
        return await generate_explainer_script(notes, narrator, style)


async def generate_dialogue_script(
    notes: List[Dict[str, Any]],
    style: str = "conversational",
    host_prompt: str = "",
    expert_prompt: str = "",
) -> List[Dict[str, str]]:
    """
    Generate a two-speaker dialogue script from notes using LLM.

    Args:
        notes: List of notes to discuss
        style: Conversation style
        host_prompt: System prompt for host personality
        expert_prompt: System prompt for expert personality

    Returns:
        List of dialogue segments: [{"speaker": "host"|"expert", "text": "..."}]
    """
    # Build notes text
    notes_text = "\n\n---\n\n".join([
        f"## {note.get('title', 'Untitled')}\n"
        f"Tags: {', '.join(note.get('tags', []))}\n\n"
        f"{note.get('body', '')}"
        for note in notes
    ])

    style_context = {
        "rest-is-politics": "witty British political commentary with dry humor",
        "all-in": "Silicon Valley tech analysis, direct and opinionated",
        "rest-is-history": "engaging historical storytelling with narrative tension",
        "conversational": "friendly, casual conversation",
        "educational": "structured educational discussion",
        "storytelling": "narrative-driven exploration",
    }.get(style, "engaging conversation")

    prompt = f"""Generate a podcast dialogue between a HOST and an EXPERT discussing these research notes.

## Source Material
{notes_text}

## Style
{style_context}

## Host Personality
{host_prompt or "Curious, engaging interviewer who asks thoughtful questions"}

## Expert Personality
{expert_prompt or "Knowledgeable explainer who shares insights accessibly"}

## Requirements
1. Create a natural back-and-forth conversation (15-25 exchanges total)
2. HOST introduces the topic and asks questions
3. EXPERT explains concepts, shares insights, uses examples
4. Include natural reactions ("That's fascinating!", "Exactly!", "Great point!")
5. Cover all the key points from the notes
6. End with a memorable takeaway

## Output Format
Return ONLY a JSON array with no markdown, no explanation:
[
  {{"speaker": "host", "text": "Welcome to the podcast! Today we're diving into..."}},
  {{"speaker": "expert", "text": "Thanks for having me! This topic is really fascinating because..."}},
  ...
]"""

    messages = [{"role": "user", "content": prompt}]

    try:
        # Use the configured synthesizer model for dialogue generation
        model = get_synthesizer_model()
        result = await query_model(
            model=model,
            messages=messages,
            timeout=120.0
        )

        if result and result.get("content"):
            content = result["content"].strip()
            # Handle potential markdown code blocks
            if content.startswith("```"):
                lines = content.split("\n")
                # Remove first and last lines (```json and ```)
                content = "\n".join(lines[1:-1])

            dialogue = json.loads(content)

            # Validate structure
            if isinstance(dialogue, list) and len(dialogue) > 0:
                validated = []
                for segment in dialogue:
                    if isinstance(segment, dict) and "speaker" in segment and "text" in segment:
                        validated.append({
                            "speaker": segment["speaker"].lower(),
                            "text": segment["text"]
                        })
                if validated:
                    logger.info(f"Generated dialogue with {len(validated)} segments")
                    return validated

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse dialogue JSON: {e}")
    except Exception as e:
        logger.error(f"Failed to generate dialogue: {e}")

    # Fallback to simple dialogue
    logger.warning("Using fallback dialogue generation")
    fallback = [
        {"speaker": "host", "text": f"Welcome to the podcast! Today we're exploring some fascinating topics."},
    ]

    for note in notes:
        title = note.get("title", "this topic")
        body = note.get("body", "")[:500]
        fallback.append({"speaker": "host", "text": f"Let's talk about {title}. What can you tell us?"})
        fallback.append({"speaker": "expert", "text": f"Great question! {body}"})

    fallback.append({"speaker": "host", "text": "That's all we have time for today. Thanks for listening!"})
    fallback.append({"speaker": "expert", "text": "Thanks for having me! Great conversation."})

    return fallback


async def generate_podcast(
    session_id: str,
    notes: List[Dict],
    mode: str,
    character_ids: List[str],
    style: str = "conversational",
    progress_callback: Optional[Callable] = None,
) -> Dict:
    """
    Generate complete podcast from notes.

    This is the main entry point for the new podcast generation flow:
    1. Load characters
    2. Generate dialogue script with emotions based on mode
    3. Call Qwen3-TTS for audio synthesis
    4. Save and return results

    Args:
        session_id: The podcast session ID
        notes: List of notes to base the podcast on
        mode: "explainer" for single narrator, "question_time" for host/expert
        character_ids: List of character IDs to use
        style: Narration style
        progress_callback: Optional callback(progress, message)

    Returns:
        Dict with audio_path, duration_ms, word_timings, dialogue_segments, or error
    """
    logger.info(f"[PODCAST] Starting generation for session {session_id}, mode={mode}")

    session = get_podcast_session(session_id)
    if not session:
        logger.error(f"[PODCAST] Session {session_id} not found")
        return {"error": "Session not found"}

    # Check TTS service is available
    tts_health = await check_tts_service()
    if not tts_health.get("healthy"):
        return {"error": f"TTS service unavailable: {tts_health.get('details')}"}

    # Update status
    session["status"] = "generating"
    session["mode"] = mode
    session["generation_step"] = "loading_characters"
    session["generation_progress"] = 0.01
    session["generation_message"] = "Loading characters..."
    save_podcast_session(session)

    try:
        # Phase 1: Load characters (5% of progress)
        characters_list = []
        characters_dict = {}  # For TTS: keyed by name

        for i, char_id in enumerate(character_ids):
            char = await get_character(char_id)
            if char:
                # Determine role based on mode and position
                if mode == "explainer":
                    role = "narrator"
                else:  # question_time
                    role = "host" if i == 0 else "expert"

                char_with_role = {**char, "role": role}
                characters_list.append(char_with_role)
                characters_dict[char["name"]] = char

        if not characters_list:
            return {"error": "No valid characters found"}

        # Store character references in session
        session["characters"] = [
            {"character_id": c["id"], "role": c["role"]}
            for c in characters_list
        ]
        save_podcast_session(session)

        if progress_callback:
            progress_callback(0.05, f"Loaded {len(characters_list)} character(s)")

        # Phase 2: Generate dialogue script (5% to 30% of progress)
        session["generation_step"] = "writing_script"
        session["generation_progress"] = 0.05
        session["generation_message"] = "Writing dialogue script with AI..."
        save_podcast_session(session)

        if progress_callback:
            progress_callback(0.10, "Generating dialogue script...")

        logger.info(f"[PODCAST] Generating {mode} script for session {session_id}")

        # For question_time, extract questions first
        extracted_questions = []
        if mode == "question_time":
            extracted_questions = await extract_questions_from_notes(notes)
            session["extracted_questions"] = extracted_questions
            save_podcast_session(session)
            logger.info(f"[PODCAST] Extracted {len(extracted_questions)} questions")

        dialogue_segments = await generate_dialogue_script_with_mode(
            notes=notes,
            mode=mode,
            characters=characters_list,
            style=style,
        )

        session["dialogue_segments"] = dialogue_segments
        session["generation_step"] = "generating_audio"
        session["generation_progress"] = 0.30
        session["generation_message"] = f"Script ready! Generating audio..."
        save_podcast_session(session)
        logger.info(f"[PODCAST] Dialogue ready with {len(dialogue_segments)} segments")

        if progress_callback:
            progress_callback(0.30, f"Script ready with {len(dialogue_segments)} segments")

        # Phase 3: Generate audio with Qwen3-TTS (30% to 90% of progress)
        def audio_progress(progress: float, message: str):
            # Map progress to 0.30-0.90 range
            overall = 0.30 + (progress * 0.60)
            session["generation_progress"] = overall
            session["generation_message"] = message
            save_podcast_session(session)
            if progress_callback:
                progress_callback(overall, message)

        logger.info(f"[PODCAST] Generating audio for {len(dialogue_segments)} segments")

        audio_bytes, word_timings, duration_ms = await generate_podcast_audio_qwen(
            dialogue_segments=dialogue_segments,
            characters=characters_dict,
            progress_callback=audio_progress,
        )

        # Phase 4: Save audio file (90% to 100%)
        session["generation_step"] = "finalizing"
        session["generation_progress"] = 0.90
        session["generation_message"] = "Saving audio file..."
        save_podcast_session(session)

        if progress_callback:
            progress_callback(0.90, "Saving audio file...")

        audio_path = save_podcast_audio(session_id, audio_bytes)

        # Update session with results
        session["audio_path"] = audio_path
        session["audio_duration_ms"] = duration_ms
        session["word_timings"] = word_timings
        session["status"] = "ready"
        session["generation_step"] = "complete"
        session["generation_progress"] = 1.0
        session["generation_message"] = "Complete!"
        save_podcast_session(session)

        if progress_callback:
            progress_callback(1.0, "Complete!")

        logger.info(f"[PODCAST] Audio generated: {audio_path} ({duration_ms}ms)")

        return {
            "audio_path": audio_path,
            "duration_ms": duration_ms,
            "word_timings": word_timings,
            "dialogue_segments": dialogue_segments,
            "error": None,
        }

    except Exception as e:
        logger.exception(f"Failed to generate podcast: {e}")
        session["status"] = "error"
        session["error"] = str(e)
        save_podcast_session(session)
        return {"error": str(e)}


async def generate_podcast_audio(
    session_id: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """
    Generate audio for a podcast session (legacy compatibility).

    This function maintains backward compatibility with the old API while
    using the new Qwen3-TTS backend. It uses default characters.

    Args:
        session_id: The podcast session ID
        progress_callback: Optional callback(progress_0_to_1, status_message)

    Returns:
        Dict with audio_path, duration_ms, word_timings, or error
    """
    logger.info(f"[PODCAST] Starting audio generation for session {session_id} (legacy)")

    session = get_podcast_session(session_id)
    if not session:
        logger.error(f"[PODCAST] Session {session_id} not found")
        return {"error": "Session not found"}

    # Check TTS service is available
    tts_health = await check_tts_service()
    if not tts_health.get("healthy"):
        return {"error": f"TTS service unavailable: {tts_health.get('details')}"}

    # Update status immediately so user sees feedback
    session["status"] = "generating"
    session["generation_step"] = "starting"
    session["generation_progress"] = 0.01
    session["generation_message"] = "Starting podcast generation..."
    save_podcast_session(session)
    logger.info(f"[PODCAST] Session {session_id} status set to generating")

    try:
        # Phase 1: Generate dialogue script using legacy method (10% of progress)
        session["generation_step"] = "writing_script"
        session["generation_progress"] = 0.02
        session["generation_message"] = "Writing dialogue script with AI..."
        save_podcast_session(session)

        if progress_callback:
            progress_callback(0.05, "Generating dialogue script...")

        logger.info(f"[PODCAST] Generating dialogue for session {session_id}")

        dialogue_segments = await generate_dialogue_script(
            notes=session.get("notes", []),
            style=session.get("style", "conversational"),
        )

        session["dialogue_segments"] = dialogue_segments
        session["generation_step"] = "generating_audio"
        session["generation_progress"] = 0.1
        session["generation_message"] = f"Script ready! Generating audio..."
        save_podcast_session(session)
        logger.info(f"[PODCAST] Dialogue ready with {len(dialogue_segments)} segments")

        if progress_callback:
            progress_callback(0.1, f"Script ready. Generating audio...")

        # Phase 2: Generate audio with Qwen3-TTS (10% to 95% of progress)
        # Map legacy host/expert to character format
        characters = {
            "host": {
                "name": "host",
                "voice_mode": "prebuilt",
                "voice": {"prebuilt_voice": "serena"},
                "personality": {"emotion_style": "warm"}
            },
            "expert": {
                "name": "expert",
                "voice_mode": "prebuilt",
                "voice": {"prebuilt_voice": "ryan"},
                "personality": {"emotion_style": "measured"}
            }
        }

        def audio_progress(progress: float, message: str):
            overall = 0.1 + (progress * 0.85)
            session["generation_progress"] = overall
            session["generation_message"] = message
            save_podcast_session(session)
            if progress_callback:
                progress_callback(overall, message)

        logger.info(f"Generating audio for {len(dialogue_segments)} segments")

        audio_bytes, word_timings, duration_ms = await generate_podcast_audio_qwen(
            dialogue_segments=dialogue_segments,
            characters=characters,
            progress_callback=audio_progress,
        )

        # Phase 3: Save audio file (95% to 100%)
        session["generation_step"] = "finalizing"
        session["generation_progress"] = 0.95
        session["generation_message"] = "Saving audio file..."
        save_podcast_session(session)

        if progress_callback:
            progress_callback(0.95, "Saving audio file...")

        audio_path = save_podcast_audio(session_id, audio_bytes)

        # Update session with results
        session["audio_path"] = audio_path
        session["audio_duration_ms"] = duration_ms
        session["word_timings"] = word_timings
        session["status"] = "ready"
        session["generation_step"] = "complete"
        session["generation_progress"] = 1.0
        session["generation_message"] = "Complete!"
        save_podcast_session(session)

        if progress_callback:
            progress_callback(1.0, "Complete!")

        logger.info(f"[PODCAST] Audio generated: {audio_path} ({duration_ms}ms)")

        return {
            "audio_path": audio_path,
            "duration_ms": duration_ms,
            "word_timings": word_timings,
            "dialogue_segments": dialogue_segments,
            "error": None,
        }

    except Exception as e:
        logger.exception(f"Failed to generate podcast audio: {e}")
        session["status"] = "error"
        session["error"] = str(e)
        save_podcast_session(session)
        return {"error": str(e)}


async def generate_podcast_cover(session_id: str) -> Dict[str, Any]:
    """
    Generate cover art for a podcast session.

    Uses the configured podcast cover model (separate from visualiser).
    Saves the cover image directly to the podcast session folder.

    Args:
        session_id: The podcast session ID

    Returns:
        {
            "cover_url": str or None,
            "error": str or None
        }
    """
    from pathlib import Path

    session = get_podcast_session(session_id)
    if not session:
        return {"error": "Session not found"}

    # Build content summary from notes for cover generation
    notes = session.get("notes", [])
    title = session.get("title", "Podcast")
    summary = session.get("summary", "")

    content_parts = [f"Title: {title}"]

    # Include the LLM-generated summary if available (better context for cover)
    if summary:
        content_parts.append(f"Episode Summary: {summary}")

    # Add note topics for additional context
    for note in notes[:3]:  # Use first 3 notes for context
        note_title = note.get("title", "")
        if note_title:
            content_parts.append(f"Topic: {note_title}")

    content = "\n".join(content_parts)

    logger.info(f"Generating cover art for session {session_id}")
    logger.debug(f"Cover content: {content[:200]}...")

    # Get cover prompt and model from settings
    cover_prompt = get_podcast_cover_prompt()
    cover_model = get_podcast_cover_model()

    # Generate using visualiser with podcast-specific model
    try:
        result = await generate_diagram(
            content=content,
            style="podcast_cover",
            model=cover_model,
            custom_prompt=cover_prompt
        )
        logger.debug(f"generate_diagram result: {result}")
    except Exception as e:
        logger.exception(f"generate_diagram raised exception: {e}")
        return {"error": str(e)}

    if result.get("error"):
        logger.error(f"Cover generation failed: {result['error']}")
        return {"error": result["error"]}

    # Copy the generated image to the podcast folder
    image_id = result.get("image_id")
    image_path = result.get("image_path")

    if image_id and image_path:
        try:
            # Read from shared images location
            source_path = Path(image_path)
            if not source_path.exists():
                source_path = Path("data/images") / f"{image_id}.png"

            if source_path.exists():
                # Copy to podcast folder
                cover_path = get_podcast_cover_path(session_id)
                cover_path.parent.mkdir(parents=True, exist_ok=True)
                cover_path.write_bytes(source_path.read_bytes())

                # Clean up from shared images (optional, keeps things tidy)
                try:
                    source_path.unlink()
                except Exception:
                    pass  # Not critical if cleanup fails

                # Build the podcast-specific cover URL
                cover_url = f"/api/podcast/sessions/{session_id}/cover"

                # Update session with cover
                session["cover_url"] = cover_url
                save_podcast_session(session)

                logger.info(f"Generated cover art: {cover_url}")
                return {
                    "cover_url": cover_url,
                    "error": None
                }
            else:
                logger.error(f"Generated image not found at {source_path}")
                return {"error": "Generated image file not found"}

        except Exception as e:
            logger.exception(f"Failed to save cover to podcast folder: {e}")
            return {"error": str(e)}

    # Log the full result for debugging when no image was generated
    logger.error(f"No image generated. Result keys: {list(result.keys())}. "
                 f"image_id={result.get('image_id')}, image_path={result.get('image_path')}, "
                 f"model={result.get('model')}")

    # Include model response in error if available (helps debug model format issues)
    model_response = result.get("raw_response") or result.get("content")
    if model_response:
        # Truncate for logging
        preview = str(model_response)[:500]
        logger.error(f"Model response preview: {preview}")
        return {"error": f"No image generated. Model response: {preview}..."}

    return {"error": "No image generated - model returned no image_id or image_path"}


async def discover_relevant_notes(topic: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Find relevant notes from Knowledge Graph for podcast source material.

    Uses semantic search to find synthesizer notes matching the topic.
    Returns full note content, not just metadata.

    Args:
        topic: The topic or query to search for
        limit: Maximum number of notes to return

    Returns:
        List of note dicts with id, title, body, tags, source_url, conversation_id, score
    """
    from . import search, storage

    if not topic.strip():
        return []

    # Use semantic search to find relevant conversations
    # Request more results than limit since we'll filter to synthesizer only
    search_results = search.search(topic, limit=limit * 3)

    if not search_results:
        return []

    discovered_notes = []

    for result in search_results:
        # Filter to synthesizer conversations only
        if result.get("mode") != "synthesizer":
            continue

        conv_id = result["id"]
        conversation = storage.get_conversation(conv_id)
        if not conversation:
            continue

        # Extract notes from the conversation
        notes = extract_notes_from_conversation(conversation)
        if not notes:
            continue

        # Get source URL from the conversation
        source_url = None
        source_title = None
        for msg in conversation.get("messages", []):
            if msg.get("role") == "assistant":
                source_url = msg.get("source_url")
                source_title = msg.get("source_title")
                if source_url:
                    break

        # Add each note with full content and metadata
        for note in notes:
            discovered_notes.append({
                "id": note.get("id"),
                "title": note.get("title", "Untitled"),
                "body": note.get("body", ""),
                "tags": note.get("tags", []),
                "source_url": source_url,
                "source_title": source_title,
                "conversation_id": conv_id,
                "conversation_title": result.get("title", ""),
                "score": result.get("score", 0),
                "similarity": result.get("similarity", 0),
            })

    # Sort by score (already sorted from search, but notes from same conv share score)
    discovered_notes.sort(key=lambda x: x["score"], reverse=True)

    # Limit to requested number
    return discovered_notes[:limit]
