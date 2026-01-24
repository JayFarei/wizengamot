"""FastAPI backend for LLM Council."""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio
import subprocess
import threading
import time
import os

from . import storage, config, prompts, threads, settings, content, synthesizer, synthesizer_kg, search, tweet, monitors, monitor_chat, monitor_crawler, monitor_scheduler, monitor_updates, monitor_digest, question_sets, visualiser, openrouter, diagram_styles, knowledge_graph, graph_rag, graph_search, brainstorm_styles
from .council import run_full_council, generate_conversation_title, generate_synthesizer_title, generate_visualiser_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings
from .summarizer import generate_summary

# Track cancelled conversations for in-progress streams
_cancelled_conversations: set = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    # Startup: Preload embedding model to avoid cold-start latency
    search.preload_model()
    # Startup: Start background tasks
    monitor_scheduler.start_scheduler()
    # Startup: Initialize brainstorm prompts
    brainstorm_styles.initialize_default_prompts()
    yield
    # Shutdown: Clean up
    monitor_scheduler.stop_scheduler()


app = FastAPI(title="LLM Council API", lifespan=lifespan)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CouncilConfig(BaseModel):
    """Council configuration for a conversation."""
    council_models: List[str]
    chairman_model: str


class SynthesizerConfig(BaseModel):
    """Synthesizer configuration for a conversation."""
    model: Optional[str] = None
    use_council: bool = False


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    council_config: Optional[CouncilConfig] = None
    system_prompt: Optional[str] = None
    mode: str = "council"  # "council" or "synthesizer"
    synthesizer_config: Optional[SynthesizerConfig] = None


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str


class ConversationStatus(BaseModel):
    """Conversation status."""
    state: str = "idle"
    is_unread: bool = False


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int
    thread_count: int = 0
    mode: str = "council"
    source_type: Optional[str] = None
    prompt_title: Optional[str] = None
    diagram_style: Optional[str] = None
    status: Optional[ConversationStatus] = None
    total_cost: float = 0.0
    summary: Optional[str] = None
    is_deliberation: Optional[bool] = None
    latest_image_id: Optional[str] = None
    image_count: Optional[int] = None


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]
    threads: List[Dict[str, Any]] = []
    comments: List[Dict[str, Any]] = []
    council_config: Optional[Dict[str, Any]] = None
    system_prompt: Optional[str] = None
    prompt_title: Optional[str] = None
    mode: str = "council"
    synthesizer_config: Optional[Dict[str, Any]] = None
    linked_visualisations: List[Dict[str, Any]] = []


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


def _get_project_root() -> str:
    """Get the project root directory (where .git is located)."""
    # backend/main.py -> project root is two levels up
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run_git_command(args: List[str]) -> tuple[bool, str]:
    """Run a git command and return (success, output)."""
    try:
        result = subprocess.run(
            ["git"] + args,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=_get_project_root()
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        return False, result.stderr.strip()
    except Exception as e:
        return False, str(e)


def _parse_git_log(output: str) -> dict:
    """Parse git log output in format: hash|date|message."""
    parts = output.split("|", 2)
    if len(parts) >= 3:
        return {
            "commit": parts[0][:7],
            "full_commit": parts[0],
            "date": parts[1],
            "message": parts[2]
        }
    return {"commit": "", "full_commit": "", "date": "", "message": ""}


# Version check cache to avoid slow git fetch on every page load
_version_cache = {
    "data": None,
    "timestamp": None
}
VERSION_CACHE_TTL = 15 * 60  # 15 minutes in seconds


@app.get("/api/version")
async def get_version(force: bool = False):
    """Get local and remote git version info for OTA updates.

    Results are cached for 15 minutes. Use force=true to bypass cache.
    """
    now = time.time()

    # Return cached result if fresh and not forcing refresh
    if not force and _version_cache["data"] and _version_cache["timestamp"]:
        age = now - _version_cache["timestamp"]
        if age < VERSION_CACHE_TTL:
            return _version_cache["data"]

    # Get local commit info
    success, local_output = _run_git_command(["log", "-1", "--format=%H|%ai|%s"])
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to get local version: {local_output}")
    local = _parse_git_log(local_output)

    # Fetch remote updates (quiet mode)
    _run_git_command(["fetch", "origin", "master", "--quiet"])

    # Get remote commit info
    success, remote_output = _run_git_command(["log", "-1", "origin/master", "--format=%H|%ai|%s"])
    if not success:
        # Remote might not exist, return local only
        result = {
            "local": local,
            "remote": None,
            "behind": 0,
            "up_to_date": True
        }
        _version_cache["data"] = result
        _version_cache["timestamp"] = now
        return result
    remote = _parse_git_log(remote_output)

    # Count commits behind
    success, count_output = _run_git_command(["rev-list", "HEAD..origin/master", "--count"])
    behind = int(count_output) if success and count_output.isdigit() else 0

    result = {
        "local": local,
        "remote": remote,
        "behind": behind,
        "up_to_date": behind == 0
    }

    # Cache the result
    _version_cache["data"] = result
    _version_cache["timestamp"] = now

    return result


@app.post("/api/update")
async def trigger_update():
    """Trigger git pull and restart the server."""
    # Run git pull
    success, output = _run_git_command(["pull", "origin", "master"])

    if not success:
        return {"success": False, "error": output}

    # Schedule server restart in background
    def restart_server():
        time.sleep(1)
        os._exit(0)

    threading.Thread(target=restart_server, daemon=True).start()

    return {
        "success": True,
        "output": output,
        "message": "Update successful. Server restarting..."
    }


@app.get("/api/config")
async def get_config():
    """Get the current council configuration."""
    return {
        "council_models": config.get_council_models(),
        "chairman_model": config.get_chairman_model(),
        "model_pool": config.get_model_pool(),
    }


@app.get("/api/search")
async def search_conversations(q: str, limit: int = 10):
    """Search conversations by semantic similarity + recency."""
    results = search.search(q, limit)
    return {"results": results, "query": q}


@app.get("/api/features")
async def get_features():
    """Get the features list for the splash screen."""
    from pathlib import Path
    features_path = Path("docs/FEATURES.md")
    if features_path.exists():
        return {"content": features_path.read_text()}
    return {"content": ""}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation with optional custom council configuration and system prompt."""
    conversation_id = str(uuid.uuid4())

    # Convert CouncilConfig to dict if provided
    council_config = None
    if request.council_config:
        council_config = {
            "council_models": request.council_config.council_models,
            "chairman_model": request.council_config.chairman_model
        }

    # Convert SynthesizerConfig to dict if provided
    synthesizer_config = None
    if request.synthesizer_config:
        synthesizer_config = {
            "model": request.synthesizer_config.model,
            "use_council": request.synthesizer_config.use_council
        }

    conversation = storage.create_conversation(
        conversation_id,
        council_config,
        request.system_prompt,
        mode=request.mode,
        synthesizer_config=synthesizer_config
    )

    # Add prompt_title for display if system_prompt exists
    if conversation.get("system_prompt"):
        conversation["prompt_title"] = storage.extract_prompt_title(conversation["system_prompt"])

    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Add prompt_title for display if system_prompt exists
    if conversation.get("system_prompt"):
        conversation["prompt_title"] = storage.extract_prompt_title(conversation["system_prompt"])

    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation."""
    # Signal any in-progress streams to stop
    _cancelled_conversations.add(conversation_id)

    deleted = storage.delete_conversation(conversation_id)
    if not deleted:
        _cancelled_conversations.discard(conversation_id)
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}


@app.post("/api/conversations/{conversation_id}/mark-read")
async def mark_conversation_read(conversation_id: str):
    """Mark a conversation as read."""
    try:
        storage.mark_conversation_read(conversation_id)
        return {"success": True}
    except ValueError:
        raise HTTPException(status_code=404, detail="Conversation not found")


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Get conversation-specific config if available
    council_models = None
    chairman_model = None
    if conversation.get("council_config"):
        council_models = conversation["council_config"].get("council_models")
        chairman_model = conversation["council_config"].get("chairman_model")

    # Get system prompt if available
    system_prompt = conversation.get("system_prompt")

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        council_models,
        chairman_model,
        system_prompt
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result
    )

    # Generate summary for gallery preview (await to ensure it's ready when frontend fetches)
    await _generate_council_summary(conversation_id, stage3_result.get('content', ''))

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


async def _generate_council_summary(conversation_id: str, stage3_content: str):
    """Background task to generate council summary."""
    try:
        if stage3_content:
            summary = await generate_summary(stage3_content, 'council')
            if summary:
                storage.update_conversation_summary(conversation_id, summary)
    except Exception as e:
        print(f"Error generating council summary: {e}")


async def _generate_synthesizer_summary(conversation_id: str, notes: List[Dict[str, Any]]):
    """Background task to generate synthesizer summary from notes."""
    try:
        if notes:
            # Combine note bodies for summary
            notes_content = "\n\n".join([note.get('body', '') for note in notes if note.get('body')])
            if notes_content:
                summary = await generate_summary(notes_content, 'synthesizer')
                if summary:
                    storage.update_conversation_summary(conversation_id, summary)
    except Exception as e:
        print(f"Error generating synthesizer summary: {e}")


async def _extract_entities_for_notes(conversation_id: str):
    """Background task to extract entities from synthesizer notes for knowledge graph."""
    try:
        await knowledge_graph.extract_entities_for_conversation(conversation_id)
        print(f"Knowledge graph: Extracted entities for conversation {conversation_id}")
    except Exception as e:
        print(f"Error extracting entities for knowledge graph: {e}")


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        # Initialize results outside try for access in finally
        stage1_results = None
        stage2_results = None
        stage3_result = None
        total_message_cost = 0.0

        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Get conversation-specific config if available
            council_models = None
            chairman_model = None
            if conversation.get("council_config"):
                council_models = conversation["council_config"].get("council_models")
                chairman_model = conversation["council_config"].get("chairman_model")

            # Get system prompt if available
            system_prompt = conversation.get("system_prompt")

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.content, council_models, system_prompt)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Check for cancellation before Stage 2
            if conversation_id in _cancelled_conversations:
                yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Conversation was deleted'})}\n\n"
                return

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(request.content, stage1_results, council_models)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Check for cancellation before Stage 3
            if conversation_id in _cancelled_conversations:
                yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Conversation was deleted'})}\n\n"
                return

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(request.content, stage1_results, stage2_results, chairman_model)
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Accumulate costs from all generations (do this before saving)
            try:
                # Collect all generation IDs
                generation_ids = []
                for result in stage1_results:
                    if result.get('generation_id'):
                        generation_ids.append(result['generation_id'])
                for result in stage2_results:
                    if result.get('generation_id'):
                        generation_ids.append(result['generation_id'])
                if stage3_result.get('generation_id'):
                    generation_ids.append(stage3_result['generation_id'])

                # Fetch costs in parallel (wait briefly for OpenRouter to process)
                if generation_ids:
                    await asyncio.sleep(1.5)  # Wait for OpenRouter to process costs
                    cost_tasks = [openrouter.get_generation_cost(gid) for gid in generation_ids]
                    costs = await asyncio.gather(*cost_tasks)

                    # Sum all valid costs
                    total_message_cost = sum(c for c in costs if c is not None)

                    # Send cost event so frontend can update sidebar immediately
                    if total_message_cost > 0:
                        yield f"data: {json.dumps({'type': 'cost_complete', 'data': {'cost': total_message_cost}})}\n\n"
            except Exception as cost_error:
                # Log but don't fail the request if cost tracking fails
                print(f"Error tracking cost: {cost_error}")

            # Save assistant message before sending complete
            if stage1_results and stage2_results and stage3_result:
                try:
                    storage.add_assistant_message(
                        conversation_id,
                        stage1_results,
                        stage2_results,
                        stage3_result
                    )

                    # Save accumulated cost to conversation
                    if total_message_cost > 0:
                        storage.update_conversation_cost(conversation_id, total_message_cost)

                    # Generate summary for gallery preview and send via SSE
                    summary = await generate_summary(stage3_result.get('content', ''), 'council')
                    if summary:
                        storage.update_conversation_summary(conversation_id, summary)
                        yield f"data: {json.dumps({'type': 'summary_complete', 'data': {'summary': summary}})}\n\n"
                except ValueError:
                    # Conversation was deleted during streaming, skip saving
                    print(f"Conversation {conversation_id} was deleted during streaming, skipping save")
                except Exception as save_error:
                    print(f"Error saving council message: {save_error}")

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        finally:
            # Clean up cancellation tracking
            _cancelled_conversations.discard(conversation_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# Comment Management Endpoints

class CreateCommentRequest(BaseModel):
    """Request to create a comment. Supports both Council and Synthesizer modes."""
    selection: str
    content: str
    source_type: str = "council"  # 'council' or 'synthesizer'
    source_content: Optional[str] = None

    # Council-specific fields (required when source_type='council')
    message_index: Optional[int] = None
    stage: Optional[int] = None
    model: Optional[str] = None

    # Synthesizer-specific fields (required when source_type='synthesizer')
    note_id: Optional[str] = None
    note_title: Optional[str] = None
    source_url: Optional[str] = None
    note_model: Optional[str] = None


@app.post("/api/conversations/{conversation_id}/comments")
async def create_comment(conversation_id: str, request: CreateCommentRequest):
    """Create a new comment on a specific part of a response."""
    try:
        comment_id = str(uuid.uuid4())
        comment = storage.add_comment(
            conversation_id=conversation_id,
            comment_id=comment_id,
            selection=request.selection,
            content=request.content,
            source_type=request.source_type,
            source_content=request.source_content,
            # Council-specific
            message_index=request.message_index,
            stage=request.stage,
            model=request.model,
            # Synthesizer-specific
            note_id=request.note_id,
            note_title=request.note_title,
            source_url=request.source_url,
            note_model=request.note_model
        )
        return comment
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/conversations/{conversation_id}/comments")
async def get_comments(conversation_id: str, message_index: Optional[int] = None):
    """Get all comments for a conversation, optionally filtered by message index."""
    try:
        comments = storage.get_comments(conversation_id, message_index)
        return comments
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.put("/api/conversations/{conversation_id}/comments/{comment_id}")
async def update_comment(conversation_id: str, comment_id: str, data: dict):
    """Update a specific comment's content."""
    try:
        content = data.get("content")
        if not content:
            raise HTTPException(status_code=400, detail="Content is required")

        updated_comment = storage.update_comment(conversation_id, comment_id, content)
        return updated_comment
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/conversations/{conversation_id}/comments/{comment_id}")
async def delete_comment(conversation_id: str, comment_id: str):
    """Delete a specific comment."""
    try:
        storage.delete_comment(conversation_id, comment_id)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Thread Management Endpoints

class ContextSegmentRequest(BaseModel):
    """Manually selected context segment to send with follow-ups."""
    id: str
    content: str
    label: Optional[str] = None
    source_type: Optional[str] = "council"  # 'council' or 'synthesizer'
    # Council-specific fields
    message_index: Optional[int] = None
    stage: Optional[int] = None
    model: Optional[str] = None
    # Synthesizer-specific fields
    note_id: Optional[str] = None
    note_title: Optional[str] = None


class CreateThreadRequest(BaseModel):
    """Request to create a follow-up thread."""
    model: str
    comment_ids: List[str]
    question: str
    message_index: Optional[int] = None  # For council mode
    note_ids: Optional[List[str]] = None  # For synthesizer mode
    context_segments: List[ContextSegmentRequest] = Field(default_factory=list)
    compiled_context: Optional[str] = None


@app.post("/api/conversations/{conversation_id}/threads")
async def create_thread(conversation_id: str, request: CreateThreadRequest):
    """Create a new follow-up thread with a specific model."""
    try:
        # Get the conversation
        conversation = storage.get_conversation(conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Get system prompt if available
        system_prompt = conversation.get("system_prompt")

        # Query the model with context
        segment_payload = [segment.model_dump() for segment in request.context_segments]

        response = await threads.query_with_context(
            request.model,
            request.question,
            conversation,
            request.comment_ids,
            segment_payload,
            system_prompt,
            request.compiled_context
        )

        if response is None:
            raise HTTPException(status_code=500, detail="Failed to query model")

        # Create the thread
        thread_id = str(uuid.uuid4())
        context = {
            "comment_ids": request.comment_ids,
            "context_segments": segment_payload
        }
        # Add mode-specific context
        if request.message_index is not None:
            context["message_index"] = request.message_index
        if request.note_ids:
            context["note_ids"] = request.note_ids
        thread = storage.create_thread(
            conversation_id,
            thread_id,
            request.model,
            context,
            request.question
        )

        # Add the assistant's response
        storage.add_thread_message(
            conversation_id,
            thread_id,
            "assistant",
            response["content"]
        )

        # Return the thread with the response
        return storage.get_thread(conversation_id, thread_id)

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/conversations/{conversation_id}/threads/{thread_id}")
async def get_thread(conversation_id: str, thread_id: str):
    """Get a specific thread."""
    thread = storage.get_thread(conversation_id, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


class ContinueThreadRequest(BaseModel):
    """Request to continue a thread."""
    question: str
    compiled_context: Optional[str] = None


@app.post("/api/conversations/{conversation_id}/threads/{thread_id}/message")
async def continue_thread(conversation_id: str, thread_id: str, request: ContinueThreadRequest):
    """Continue an existing thread with a new question."""
    try:
        # Get the conversation with migration (to access session-scoped threads)
        conversation = storage.get_conversation_with_migration(conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        thread = storage.get_thread(conversation_id, thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Thread not found")

        # Get system prompt if available
        system_prompt = conversation.get("system_prompt")

        # Compile context from comments (only for first message, so pass None here)
        context = None
        if len(thread["messages"]) == 1:  # First response only
            thread_context = thread.get("context", {}) or {}
            context = request.compiled_context or threads.compile_context_from_comments(
                conversation,
                thread_context.get("comment_ids", []),
                thread_context.get("context_segments")
            )

        # Continue the thread
        response = await threads.continue_thread(
            thread["model"],
            thread["messages"],
            request.question,
            system_prompt,
            context
        )

        if response is None:
            raise HTTPException(status_code=500, detail="Failed to query model")

        # Add user message
        storage.add_thread_message(
            conversation_id,
            thread_id,
            "user",
            request.question
        )

        # Add assistant response
        storage.add_thread_message(
            conversation_id,
            thread_id,
            "assistant",
            response["content"]
        )

        # Return the updated thread
        return storage.get_thread(conversation_id, thread_id)

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# =============================================================================
# Review Sessions Endpoints
# =============================================================================

class CreateReviewSessionRequest(BaseModel):
    """Request to create a new review session."""
    name: Optional[str] = None


class UpdateReviewSessionRequest(BaseModel):
    """Request to update a review session."""
    name: str


class CreateSessionCommentRequest(BaseModel):
    """Request to create a comment within a session."""
    selection: str
    content: str
    source_type: str = "council"
    source_content: Optional[str] = None
    message_index: Optional[int] = None
    stage: Optional[int] = None
    model: Optional[str] = None
    note_id: Optional[str] = None
    note_title: Optional[str] = None
    source_url: Optional[str] = None
    note_model: Optional[str] = None


class AddContextSegmentRequest(BaseModel):
    """Request to add a context segment to a session."""
    id: str
    content: str
    sourceType: str = "council"
    label: Optional[str] = None
    messageIndex: Optional[int] = None
    stage: Optional[int] = None
    model: Optional[str] = None
    noteId: Optional[str] = None
    noteTitle: Optional[str] = None


class CreateSessionThreadRequest(BaseModel):
    """Request to create a thread within a session."""
    model: str
    comment_ids: List[str]
    question: str
    message_index: Optional[int] = None
    note_ids: Optional[List[str]] = None
    context_segments: List[ContextSegmentRequest] = Field(default_factory=list)
    compiled_context: Optional[str] = None


@app.get("/api/conversations/{conversation_id}/review-sessions")
async def list_review_sessions(conversation_id: str):
    """List all review sessions for a conversation."""
    try:
        sessions = storage.get_review_sessions(conversation_id)
        conversation = storage.get_conversation_with_migration(conversation_id)
        active_id = conversation.get("active_review_session_id") if conversation else None
        return {
            "sessions": sessions,
            "active_session_id": active_id
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/conversations/{conversation_id}/review-sessions")
async def create_review_session(conversation_id: str, request: CreateReviewSessionRequest):
    """Create a new review session."""
    try:
        session = storage.create_review_session(conversation_id, request.name)
        return session
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/conversations/{conversation_id}/review-sessions/active")
async def get_active_review_session(conversation_id: str):
    """Get the active review session for a conversation."""
    try:
        session = storage.get_active_review_session(conversation_id)
        if session is None:
            return {"session": None}
        return {"session": session}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/conversations/{conversation_id}/review-sessions/{session_id}")
async def get_review_session(conversation_id: str, session_id: str):
    """Get a specific review session."""
    session = storage.get_review_session(conversation_id, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.put("/api/conversations/{conversation_id}/review-sessions/{session_id}")
async def update_review_session(
    conversation_id: str,
    session_id: str,
    request: UpdateReviewSessionRequest
):
    """Update a review session (rename)."""
    try:
        session = storage.update_review_session(conversation_id, session_id, request.name)
        return session
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/conversations/{conversation_id}/review-sessions/{session_id}")
async def delete_review_session(conversation_id: str, session_id: str):
    """Delete a review session and all its threads."""
    try:
        deleted = storage.delete_review_session(conversation_id, session_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/conversations/{conversation_id}/review-sessions/{session_id}/activate")
async def activate_review_session(conversation_id: str, session_id: str):
    """Set a review session as active."""
    try:
        session = storage.set_active_review_session(conversation_id, session_id)
        return session
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Session-scoped Comments

@app.post("/api/conversations/{conversation_id}/review-sessions/{session_id}/comments")
async def create_session_comment(
    conversation_id: str,
    session_id: str,
    request: CreateSessionCommentRequest
):
    """Create a comment within a review session."""
    try:
        comment_id = str(uuid.uuid4())
        comment = storage.add_session_comment(
            conversation_id=conversation_id,
            session_id=session_id,
            comment_id=comment_id,
            selection=request.selection,
            content=request.content,
            source_type=request.source_type,
            source_content=request.source_content,
            message_index=request.message_index,
            stage=request.stage,
            model=request.model,
            note_id=request.note_id,
            note_title=request.note_title,
            source_url=request.source_url,
            note_model=request.note_model
        )
        return comment
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/conversations/{conversation_id}/review-sessions/{session_id}/comments")
async def get_session_comments(
    conversation_id: str,
    session_id: str,
    message_index: Optional[int] = None
):
    """Get all comments for a review session."""
    try:
        comments = storage.get_session_comments(conversation_id, session_id, message_index)
        return comments
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.put("/api/conversations/{conversation_id}/review-sessions/{session_id}/comments/{comment_id}")
async def update_session_comment(
    conversation_id: str,
    session_id: str,
    comment_id: str,
    data: dict
):
    """Update a comment within a session."""
    try:
        content = data.get("content")
        if not content:
            raise HTTPException(status_code=400, detail="Content is required")
        comment = storage.update_session_comment(conversation_id, session_id, comment_id, content)
        return comment
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/conversations/{conversation_id}/review-sessions/{session_id}/comments/{comment_id}")
async def delete_session_comment(
    conversation_id: str,
    session_id: str,
    comment_id: str
):
    """Delete a comment from a session."""
    try:
        deleted = storage.delete_session_comment(conversation_id, session_id, comment_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Comment not found")
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Session-scoped Context Segments

@app.post("/api/conversations/{conversation_id}/review-sessions/{session_id}/segments")
async def add_session_context_segment(
    conversation_id: str,
    session_id: str,
    request: AddContextSegmentRequest
):
    """Add a context segment to a review session."""
    try:
        segment = storage.add_session_context_segment(
            conversation_id,
            session_id,
            request.model_dump()
        )
        return segment
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/conversations/{conversation_id}/review-sessions/{session_id}/segments/{segment_id}")
async def remove_session_context_segment(
    conversation_id: str,
    session_id: str,
    segment_id: str
):
    """Remove a context segment from a session."""
    try:
        removed = storage.remove_session_context_segment(conversation_id, session_id, segment_id)
        if not removed:
            raise HTTPException(status_code=404, detail="Segment not found")
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Session-scoped Threads

@app.post("/api/conversations/{conversation_id}/review-sessions/{session_id}/threads")
async def create_session_thread(
    conversation_id: str,
    session_id: str,
    request: CreateSessionThreadRequest
):
    """Create a new thread within a review session."""
    try:
        conversation = storage.get_conversation_with_migration(conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        session = storage.get_review_session(conversation_id, session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")

        system_prompt = conversation.get("system_prompt")
        segment_payload = [segment.model_dump() for segment in request.context_segments]

        response = await threads.query_with_context(
            request.model,
            request.question,
            conversation,
            request.comment_ids,
            segment_payload,
            system_prompt,
            request.compiled_context
        )

        if response is None:
            raise HTTPException(status_code=500, detail="Failed to query model")

        thread_id = str(uuid.uuid4())
        context = {
            "comment_ids": request.comment_ids,
            "context_segments": segment_payload
        }
        if request.message_index is not None:
            context["message_index"] = request.message_index
        if request.note_ids:
            context["note_ids"] = request.note_ids

        thread = storage.create_session_thread(
            conversation_id,
            session_id,
            thread_id,
            request.model,
            context,
            request.question
        )

        storage.add_session_thread_message(
            conversation_id,
            session_id,
            thread_id,
            "assistant",
            response["content"]
        )

        return storage.get_session_thread(conversation_id, session_id, thread_id)

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/conversations/{conversation_id}/review-sessions/{session_id}/threads/{thread_id}")
async def get_session_thread(conversation_id: str, session_id: str, thread_id: str):
    """Get a specific thread from a session."""
    thread = storage.get_session_thread(conversation_id, session_id, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@app.post("/api/conversations/{conversation_id}/review-sessions/{session_id}/threads/{thread_id}/message")
async def continue_session_thread(
    conversation_id: str,
    session_id: str,
    thread_id: str,
    request: ContinueThreadRequest
):
    """Continue a thread within a session."""
    try:
        conversation = storage.get_conversation_with_migration(conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        thread = storage.get_session_thread(conversation_id, session_id, thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Thread not found")

        system_prompt = conversation.get("system_prompt")

        context = None
        if len(thread["messages"]) == 1:
            thread_context = thread.get("context", {}) or {}
            context = request.compiled_context or threads.compile_context_from_comments(
                conversation,
                thread_context.get("comment_ids", []),
                thread_context.get("context_segments")
            )

        response = await threads.continue_thread(
            thread["model"],
            thread["messages"],
            request.question,
            system_prompt,
            context
        )

        if response is None:
            raise HTTPException(status_code=500, detail="Failed to query model")

        storage.add_session_thread_message(
            conversation_id,
            session_id,
            thread_id,
            "user",
            request.question
        )

        storage.add_session_thread_message(
            conversation_id,
            session_id,
            thread_id,
            "assistant",
            response["content"]
        )

        return storage.get_session_thread(conversation_id, session_id, thread_id)

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Prompt Management Endpoints

@app.get("/api/prompts")
async def list_prompts_endpoint(mode: Optional[str] = None):
    """List all available system prompts with their labels.

    Args:
        mode: Optional filter - 'council' or 'synthesizer' for subdirectory prompts.
    """
    return await prompts.list_prompts_with_labels(mode)


@app.get("/api/prompts/labels")
async def get_prompt_labels():
    """Get mapping of prompt titles to labels."""
    return prompts.get_labels_mapping()


@app.get("/api/prompts/{filename}")
async def get_prompt(filename: str, mode: Optional[str] = None):
    """Get a specific prompt by filename.

    Args:
        filename: The prompt filename
        mode: Optional mode ('council' or 'synthesizer') for subdirectory
    """
    prompt = prompts.get_prompt(filename, mode)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


class CreatePromptRequest(BaseModel):
    """Request to create a new prompt."""
    title: str
    content: str
    mode: Optional[str] = None


@app.post("/api/prompts")
async def create_prompt_endpoint(request: CreatePromptRequest):
    """Create a new prompt file with auto-generated label.

    Args:
        request: Contains title, content, and optional mode ('council' or 'synthesizer')
    """
    try:
        return await prompts.create_prompt_with_label(request.title, request.content, request.mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class UpdatePromptRequest(BaseModel):
    """Request to update an existing prompt."""
    content: str
    mode: Optional[str] = None


@app.put("/api/prompts/{filename}")
async def update_prompt(filename: str, request: UpdatePromptRequest):
    """Update an existing prompt file.

    Args:
        filename: The prompt filename
        request: Contains content and optional mode
    """
    try:
        return prompts.update_prompt(filename, request.content, request.mode)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/prompts/{filename}")
async def delete_prompt(filename: str, mode: Optional[str] = None):
    """Delete a prompt file.

    Args:
        filename: The prompt filename
        mode: Optional mode ('council' or 'synthesizer') for subdirectory
    """
    try:
        prompts.delete_prompt(filename, mode)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Question Sets Management Endpoints

@app.get("/api/question-sets")
async def list_question_sets_endpoint():
    """List all available question sets."""
    return question_sets.list_question_sets()


@app.get("/api/question-sets/{filename}")
async def get_question_set(filename: str):
    """Get a specific question set by filename."""
    qs = question_sets.get_question_set(filename)
    if qs is None:
        raise HTTPException(status_code=404, detail="Question set not found")
    return qs


class CreateQuestionSetRequest(BaseModel):
    """Request to create a new question set."""
    title: str
    questions: Dict[str, str]
    description: str = ""
    output_schema: Optional[Dict[str, str]] = None


@app.post("/api/question-sets")
async def create_question_set_endpoint(request: CreateQuestionSetRequest):
    """Create a new question set file."""
    try:
        return question_sets.create_question_set(
            request.title,
            request.questions,
            request.description,
            request.output_schema
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class UpdateQuestionSetRequest(BaseModel):
    """Request to update an existing question set."""
    content: Optional[str] = None
    questions: Optional[Dict[str, str]] = None
    description: Optional[str] = None
    output_schema: Optional[Dict[str, str]] = None


@app.put("/api/question-sets/{filename}")
async def update_question_set_endpoint(filename: str, request: UpdateQuestionSetRequest):
    """Update an existing question set file."""
    try:
        return question_sets.update_question_set(
            filename,
            content=request.content,
            questions=request.questions,
            description=request.description,
            output_schema=request.output_schema
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/question-sets/{filename}")
async def delete_question_set_endpoint(filename: str):
    """Delete a question set file."""
    try:
        question_sets.delete_question_set(filename)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Settings Management Endpoints

@app.get("/api/settings")
async def get_settings():
    """Get current settings status (not the actual API key value for security)."""
    return {
        "api_key_configured": settings.has_api_key_configured(),
        "api_key_source": settings.get_api_key_source(),
        "firecrawl_configured": settings.has_firecrawl_configured(),
        "firecrawl_source": settings.get_firecrawl_source(),
    }


@app.get("/api/credits")
async def get_credits():
    """Get remaining OpenRouter credits."""
    credits_data = await openrouter.get_credits()
    if credits_data is None:
        raise HTTPException(status_code=500, detail="Failed to fetch credits. Check your API key.")
    return credits_data


@app.get("/api/usage-stats")
async def get_usage_stats():
    """Get aggregated usage statistics across all conversations."""
    return storage.get_usage_stats()


# =============================================================================
# Stage Prompts Endpoints
# =============================================================================

from . import stage_prompts
from . import synthesizer_stage_prompts


@app.get("/api/stage-prompts")
async def list_stage_prompts():
    """List all stage prompts with their status."""
    return stage_prompts.list_stage_prompts()


@app.get("/api/stage-prompts/{prompt_type}")
async def get_stage_prompt(prompt_type: str):
    """Get a specific stage prompt (ranking or chairman)."""
    try:
        return stage_prompts.get_stage_prompt(prompt_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class UpdateStagePromptRequest(BaseModel):
    """Request to update a stage prompt."""
    content: str


@app.put("/api/stage-prompts/{prompt_type}")
async def update_stage_prompt(prompt_type: str, request: UpdateStagePromptRequest):
    """Update a stage prompt with custom content."""
    if not request.content or not request.content.strip():
        raise HTTPException(status_code=400, detail="Content is required")
    try:
        return stage_prompts.update_stage_prompt(prompt_type, request.content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/stage-prompts/{prompt_type}/reset")
async def reset_stage_prompt(prompt_type: str):
    """Reset a stage prompt to the built-in default."""
    try:
        return stage_prompts.reset_stage_prompt(prompt_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Synthesizer Stage Prompts Endpoints
# =============================================================================

@app.get("/api/synth-stage-prompts")
async def list_synth_stage_prompts():
    """List all synthesizer stage prompts with their status."""
    return synthesizer_stage_prompts.list_synth_stage_prompts()


@app.get("/api/synth-stage-prompts/{prompt_type}")
async def get_synth_stage_prompt(prompt_type: str):
    """Get a specific synthesizer stage prompt (ranking or chairman)."""
    try:
        return synthesizer_stage_prompts.get_synth_stage_prompt(prompt_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/synth-stage-prompts/{prompt_type}")
async def update_synth_stage_prompt(prompt_type: str, request: UpdateStagePromptRequest):
    """Update a synthesizer stage prompt with custom content."""
    if not request.content or not request.content.strip():
        raise HTTPException(status_code=400, detail="Content is required")
    try:
        return synthesizer_stage_prompts.update_synth_stage_prompt(prompt_type, request.content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/synth-stage-prompts/{prompt_type}/reset")
async def reset_synth_stage_prompt(prompt_type: str):
    """Reset a synthesizer stage prompt to the built-in default."""
    try:
        return synthesizer_stage_prompts.reset_synth_stage_prompt(prompt_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class UpdateApiKeyRequest(BaseModel):
    """Request to update the OpenRouter API key."""
    api_key: str


@app.put("/api/settings/api-key")
async def update_api_key(request: UpdateApiKeyRequest):
    """Update the OpenRouter API key."""
    if not request.api_key or len(request.api_key) < 10:
        raise HTTPException(status_code=400, detail="Invalid API key")

    settings.set_openrouter_api_key(request.api_key)
    return {
        "success": True,
        "api_key_configured": True,
        "api_key_source": "settings"
    }


@app.delete("/api/settings/api-key")
async def clear_api_key():
    """Clear the API key from settings (will fall back to environment variable)."""
    current_settings = settings.load_settings()
    if "openrouter_api_key" in current_settings:
        del current_settings["openrouter_api_key"]
        settings.save_settings(current_settings)

    return {
        "success": True,
        "api_key_configured": settings.has_api_key_configured(),
        "api_key_source": settings.get_api_key_source()
    }


# Model Configuration Endpoints

class UpdateModelPoolRequest(BaseModel):
    """Request to update the model pool."""
    models: List[str]


@app.get("/api/settings/models")
async def get_model_settings():
    """Get current model configuration."""
    return {
        "model_pool": settings.get_model_pool(),
        "council_models": settings.get_council_models(),
        "chairman_model": settings.get_chairman_model(),
        "default_prompt": settings.get_default_prompt(),
    }


@app.put("/api/settings/model-pool")
async def update_model_pool(request: UpdateModelPoolRequest):
    """Update the available model pool."""
    if not request.models or len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model is required")

    settings.set_model_pool(request.models)

    # Also update council models to only include models in the new pool
    current_council = settings.get_council_models()
    filtered_council = [m for m in current_council if m in request.models]
    if not filtered_council:
        filtered_council = request.models  # Use all if none match
    settings.set_council_models(filtered_council)

    # Update chairman if not in new pool
    chairman = settings.get_chairman_model()
    if chairman not in request.models:
        settings.set_chairman_model(request.models[0])

    return {"success": True, "model_pool": request.models}


class TestModelRequest(BaseModel):
    """Request to test a model."""
    model: str


@app.post("/api/settings/test-model")
async def test_model(request: TestModelRequest):
    """
    Test if a model is accessible by sending a simple ping.
    Returns success/failure with timing information.
    """
    import time

    if not request.model:
        raise HTTPException(status_code=400, detail="Model is required")

    try:
        start = time.time()
        messages = [{"role": "user", "content": "Reply with the single word: pong"}]
        response = await openrouter.query_model(request.model, messages, timeout=30.0)
        elapsed = (time.time() - start) * 1000

        if response and response.get('content'):
            return {
                "success": True,
                "model": request.model,
                "response_time_ms": int(elapsed)
            }
        return {
            "success": False,
            "model": request.model,
            "error": "Empty response from model"
        }
    except Exception as e:
        return {
            "success": False,
            "model": request.model,
            "error": str(e)
        }


@app.get("/api/settings/model-dependencies/{model_id:path}")
async def get_model_dependencies(model_id: str):
    """Check which features use a specific model."""
    return settings.get_model_dependencies(model_id)


class ReplaceModelRequest(BaseModel):
    """Request to replace a model across all usages."""
    old_model: str
    new_model: str
    remove_old: bool = True


@app.post("/api/settings/replace-model")
async def replace_model(request: ReplaceModelRequest):
    """Replace a model with another across all its usages."""
    if not request.old_model or not request.new_model:
        raise HTTPException(status_code=400, detail="Both old_model and new_model are required")

    result = settings.replace_model(request.old_model, request.new_model, request.remove_old)
    return result


class UpdateCouncilModelsRequest(BaseModel):
    """Request to update the default council models."""
    models: List[str]


@app.put("/api/settings/council-models")
async def update_council_models(request: UpdateCouncilModelsRequest):
    """Update the default council models."""
    if not request.models or len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model is required")

    settings.set_council_models(request.models)
    return {"success": True, "council_models": request.models}


class UpdateChairmanRequest(BaseModel):
    """Request to update the default chairman model."""
    model: str


@app.put("/api/settings/chairman")
async def update_chairman(request: UpdateChairmanRequest):
    """Update the default chairman model."""
    if not request.model:
        raise HTTPException(status_code=400, detail="Model is required")

    settings.set_chairman_model(request.model)
    return {"success": True, "chairman_model": request.model}


class UpdateDefaultPromptRequest(BaseModel):
    """Request to update the default prompt."""
    prompt_filename: Optional[str] = None


@app.put("/api/settings/default-prompt")
async def update_default_prompt(request: UpdateDefaultPromptRequest):
    """Update the default system prompt."""
    if request.prompt_filename:
        # Verify the prompt exists
        prompt = prompts.get_prompt(request.prompt_filename)
        if prompt is None:
            raise HTTPException(status_code=404, detail="Prompt not found")

    settings.set_default_prompt(request.prompt_filename)
    return {"success": True, "default_prompt": request.prompt_filename}


# =============================================================================
# Synthesizer Endpoints
# =============================================================================

class SynthesizeRequest(BaseModel):
    """Request to process a URL or raw text in synthesizer mode."""
    url: Optional[str] = None
    text: Optional[str] = None  # Direct text input when URL scraping is blocked
    comment: Optional[str] = None
    model: Optional[str] = None
    use_council: bool = False
    use_deliberation: bool = False  # Enable full 3-stage council deliberation
    use_knowledge_graph: bool = False  # Enable knowledge graph aware generation
    council_models: Optional[List[str]] = None  # Models for deliberation mode
    chairman_model: Optional[str] = None  # Chairman for deliberation mode


class UpdateSynthesizerSourceRequest(BaseModel):
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    source_title: Optional[str] = None


@app.post("/api/conversations/{conversation_id}/synthesize")
async def synthesize_from_url(conversation_id: str, request: SynthesizeRequest):
    """
    Process a URL or raw text and generate Zettelkasten notes.
    """
    # Validate input: either url OR text must be provided, not both
    if not request.url and not request.text:
        raise HTTPException(status_code=400, detail="Either URL or text must be provided")
    if request.url and request.text:
        raise HTTPException(status_code=400, detail="Provide either URL or text, not both")

    # Verify conversation exists and is synthesizer mode
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation.get("mode") != "synthesizer":
        raise HTTPException(status_code=400, detail="Conversation is not in synthesizer mode")

    # Check if this is the first message (for title generation)
    is_first_message = len(conversation.get("messages", [])) == 0

    # Add user message (use text preview for text input, url for url input)
    source_label = request.url if request.url else f"[Pasted text: {len(request.text)} chars]"
    storage.add_synthesizer_user_message(conversation_id, source_label, request.comment)

    # Get content either from URL or direct text input
    if request.text:
        # Direct text input, skip URL fetching
        content_result = {
            "source_type": "text",
            "content": request.text,
            "title": "Pasted Text",
            "error": None
        }
    else:
        # Fetch content from URL
        content_result = await content.fetch_content(request.url)

    if content_result.get("error"):
        raise HTTPException(status_code=400, detail=content_result["error"])

    # Get system prompt
    system_prompt = conversation.get("system_prompt")
    if not system_prompt:
        system_prompt = await synthesizer.get_synthesizer_prompt_content()

    # Generate zettels
    model = request.model or settings.get_synthesizer_model()

    if request.use_knowledge_graph:
        # Knowledge graph aware generation
        result = await synthesizer_kg.generate_zettels_knowledge_graph(
            content_result["content"],
            system_prompt,
            model=model,
            user_comment=request.comment
        )
        # Save knowledge graph message with context metadata
        storage.add_synthesizer_kg_message(
            conversation_id,
            result["notes"],
            result.get("raw_response", ""),
            content_result["content"] or "",
            content_result["source_type"],
            request.url,
            result.get("model", model),
            result.get("context_notes", []),
            result.get("topics_extracted", {}),
            content_result.get("title")
        )
        gen_id = result.get("generation_id")
        generation_ids = [gen_id] if gen_id else []
    elif request.use_deliberation:
        # Full 3-stage council deliberation
        result = await synthesizer.generate_zettels_deliberation(
            content_result["content"],
            system_prompt,
            council_models=request.council_models,
            chairman_model=request.chairman_model,
            user_comment=request.comment
        )
        # Save deliberation message with full metadata
        storage.add_synthesizer_deliberation_message(
            conversation_id,
            result["notes"],
            result.get("deliberation", {}),
            result.get("stage3_raw", ""),
            content_result["content"] or "",
            content_result["source_type"],
            request.url,
            result.get("models", []),
            result.get("chairman_model", ""),
            content_result.get("title")
        )
        generation_ids = result.get("generation_ids", [])
    elif request.use_council:
        result = await synthesizer.generate_zettels_council(
            content_result["content"],
            system_prompt,
            user_comment=request.comment
        )
        # Save synthesizer message
        storage.add_synthesizer_message(
            conversation_id,
            result["notes"],
            result.get("raw_response", ""),
            content_result["content"] or "",
            content_result["source_type"],
            request.url,
            result.get("model"),
            content_result.get("title")
        )
        generation_ids = result.get("generation_ids", [])
    else:
        result = await synthesizer.generate_zettels_single(
            content_result["content"],
            system_prompt,
            model=model,
            user_comment=request.comment
        )
        # Save synthesizer message
        storage.add_synthesizer_message(
            conversation_id,
            result["notes"],
            result.get("raw_response", ""),
            content_result["content"] or "",
            content_result["source_type"],
            request.url,
            result.get("model"),
            content_result.get("title")
        )
        gen_id = result.get("generation_id")
        generation_ids = [gen_id] if gen_id else []

    if generation_ids:
        try:
            await asyncio.sleep(1.5)  # Wait for OpenRouter to process costs
            cost_tasks = [openrouter.get_generation_cost(gid) for gid in generation_ids]
            costs = await asyncio.gather(*cost_tasks)
            total_cost = sum(c for c in costs if c is not None)
            if total_cost > 0:
                storage.update_conversation_cost(conversation_id, total_cost)
        except Exception as e:
            print(f"Error tracking synthesizer cost: {e}")

    # Generate summary for gallery preview (await to ensure it's ready when frontend fetches)
    if result.get("notes"):
        await _generate_synthesizer_summary(conversation_id, result["notes"])
        # Extract entities for knowledge graph (run in background, don't block response)
        asyncio.create_task(_extract_entities_for_notes(conversation_id))

    # Generate title from notes if first message
    generated_title = None
    if is_first_message and result.get("notes"):
        generated_title = await generate_synthesizer_title(result["notes"])
        storage.update_conversation_title(conversation_id, generated_title)

    response_data = {
        "notes": result["notes"],
        "source_type": content_result["source_type"],
        "source_title": content_result.get("title"),
        "model": result.get("model"),
        "conversation_title": generated_title
    }

    # Include deliberation metadata when using deliberation mode
    if request.use_deliberation:
        response_data["deliberation"] = result.get("deliberation")
        response_data["stage3_raw"] = result.get("stage3_raw")
        response_data["models"] = result.get("models")
        response_data["chairman_model"] = result.get("chairman_model")
        response_data["mode"] = "deliberation"
    elif request.use_knowledge_graph:
        response_data["context_notes"] = result.get("context_notes", [])
        response_data["topics_extracted"] = result.get("topics_extracted", {})
        response_data["mode"] = "knowledge_graph"

    return response_data


@app.put("/api/conversations/{conversation_id}/synthesizer-source", response_model=Conversation)
async def update_synthesizer_source(
    conversation_id: str,
    request: UpdateSynthesizerSourceRequest
):
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation.get("mode") != "synthesizer":
        raise HTTPException(status_code=400, detail="Conversation is not in synthesizer mode")

    payload = request.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No updates provided")

    updates: Dict[str, Optional[str]] = {}
    for key, value in payload.items():
        if value is None:
            updates[key] = None
            continue
        cleaned = value.strip()
        if cleaned == "":
            updates[key] = None
            continue
        if key == "source_type":
            cleaned = cleaned.lower()
            updates[key] = cleaned
        else:
            updates[key] = cleaned

    source_type = updates.get("source_type")
    if source_type:
        allowed_types = {"youtube", "podcast", "article", "pdf", "text"}
        if source_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail="Invalid source_type. Must be one of: youtube, podcast, article, pdf, text"
            )

    updated = storage.update_synthesizer_source_metadata(conversation_id, updates)
    return updated


# Synthesizer Settings Endpoints

class UpdateFirecrawlApiKeyRequest(BaseModel):
    """Request to update the Firecrawl API key."""
    api_key: str


@app.put("/api/settings/firecrawl-api-key")
async def update_firecrawl_api_key(request: UpdateFirecrawlApiKeyRequest):
    """Update the Firecrawl API key."""
    if not request.api_key or len(request.api_key) < 10:
        raise HTTPException(status_code=400, detail="Invalid API key")

    settings.set_firecrawl_api_key(request.api_key)
    return {
        "success": True,
        "firecrawl_configured": True,
        "firecrawl_source": "settings"
    }


@app.delete("/api/settings/firecrawl-api-key")
async def clear_firecrawl_api_key():
    """Clear the Firecrawl API key from settings."""
    settings.clear_firecrawl_api_key()
    return {
        "success": True,
        "firecrawl_configured": settings.has_firecrawl_configured(),
        "firecrawl_source": settings.get_firecrawl_source()
    }


# =============================================================================
# Crawler Settings (Crawl4AI / Firecrawl)
# =============================================================================

@app.get("/api/crawler/health")
async def get_crawler_health():
    """Check if the Crawl4AI service is healthy with detailed stats."""
    from .crawler.client import Crawl4AIClient
    try:
        client = Crawl4AIClient(settings.get_crawl4ai_url())
        health = await client.health_check_detailed()
        return {
            **health,
            "provider": settings.get_crawler_provider(),
            "crawl4ai_url": settings.get_crawl4ai_url(),
        }
    except Exception as e:
        return {
            "healthy": False,
            "provider": settings.get_crawler_provider(),
            "error": str(e)
        }


@app.get("/api/settings/crawler")
async def get_crawler_settings_endpoint():
    """Get crawler settings."""
    return settings.get_crawler_settings()


class UpdateCrawlerSettingsRequest(BaseModel):
    """Request to update crawler settings."""
    provider: Optional[str] = None
    crawl4ai_url: Optional[str] = None
    auto_fallback: Optional[bool] = None


@app.put("/api/settings/crawler")
async def update_crawler_settings(request: UpdateCrawlerSettingsRequest):
    """Update crawler settings."""
    if request.provider:
        settings.set_crawler_provider(request.provider)
    if request.crawl4ai_url:
        settings.set_crawl4ai_url(request.crawl4ai_url)
    if request.auto_fallback is not None:
        settings.set_crawler_auto_fallback(request.auto_fallback)
    return {
        "success": True,
        **settings.get_crawler_settings()
    }


@app.get("/api/settings/synthesizer")
async def get_synthesizer_settings():
    """Get synthesizer-specific settings."""
    return {
        "firecrawl_configured": settings.has_firecrawl_configured(),
        "firecrawl_source": settings.get_firecrawl_source(),
        "crawler_provider": settings.get_crawler_provider(),
        "crawl4ai_url": settings.get_crawl4ai_url(),
        "default_model": settings.get_synthesizer_model(),
        "default_mode": settings.get_synthesizer_mode(),
        "default_prompt": settings.get_synthesizer_prompt()
    }


class UpdateSynthesizerSettingsRequest(BaseModel):
    """Request to update synthesizer settings."""
    model: Optional[str] = None
    mode: Optional[str] = None
    prompt: Optional[str] = None


@app.put("/api/settings/synthesizer")
async def update_synthesizer_settings(request: UpdateSynthesizerSettingsRequest):
    """Update synthesizer settings."""
    if request.model:
        settings.set_synthesizer_model(request.model)
    if request.mode:
        settings.set_synthesizer_mode(request.mode)
    if request.prompt is not None:
        settings.set_synthesizer_prompt(request.prompt if request.prompt else None)

    return {
        "success": True,
        "default_model": settings.get_synthesizer_model(),
        "default_mode": settings.get_synthesizer_mode(),
        "default_prompt": settings.get_synthesizer_prompt()
    }


class UpdateNoteTweetRequest(BaseModel):
    """Request to update a note's tweet."""
    tweet: str


@app.put("/api/conversations/{conversation_id}/notes/{note_id}/tweet")
async def update_note_tweet(
    conversation_id: str,
    note_id: str,
    request: UpdateNoteTweetRequest
):
    """Update a note's tweet field."""
    success = storage.update_note_tweet(conversation_id, note_id, request.tweet)
    if not success:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"success": True}


# =============================================================================
# Visualiser Endpoints
# =============================================================================


class VisualiseRequest(BaseModel):
    """Request to generate a diagram."""
    source_type: str  # 'conversation', 'url', 'text'
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_text: Optional[str] = None
    style: str = "bento"
    model: Optional[str] = None
    reference_image: Optional[str] = None  # Base64-encoded reference image


@app.post("/api/conversations/{conversation_id}/visualise")
async def visualise_content(conversation_id: str, request: VisualiseRequest):
    """Generate a diagram from content."""
    from fastapi.responses import FileResponse

    # Verify conversation exists and is visualiser mode
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation.get("mode") != "visualiser":
        raise HTTPException(status_code=400, detail="Conversation is not in visualiser mode")

    # Validate style against configured styles
    available_styles = diagram_styles.list_diagram_styles()
    if request.style not in available_styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Must be one of: {list(available_styles.keys())}")

    # Get content based on source type
    source_content = None

    source_title = None

    if request.source_type == "conversation":
        if not request.source_id:
            raise HTTPException(status_code=400, detail="source_id required for conversation source")
        source_conv = storage.get_conversation(request.source_id)
        if not source_conv:
            raise HTTPException(status_code=404, detail="Source conversation not found")
        source_content = extract_conversation_content(source_conv)
        source_title = source_conv.get("title", "Conversation")

    elif request.source_type == "url":
        if not request.source_url:
            raise HTTPException(status_code=400, detail="source_url required for URL source")
        content_result = await content.fetch_content(request.source_url)
        if content_result.get("error"):
            raise HTTPException(status_code=400, detail=content_result["error"])
        source_content = content_result.get("content", "")
        source_title = content_result.get("title") or request.source_url

    elif request.source_type == "text":
        if not request.source_text:
            raise HTTPException(status_code=400, detail="source_text required for text source")
        source_content = request.source_text
        # Use first 50 chars as title for text content
        source_title = (request.source_text[:50] + "...") if len(request.source_text) > 50 else request.source_text

    else:
        raise HTTPException(status_code=400, detail="Invalid source_type. Must be 'conversation', 'url', or 'text'")

    # Check if this is the first message
    is_first_message = len(conversation.get("messages", [])) == 0

    # Add user message
    storage.add_visualiser_user_message(
        conversation_id,
        request.source_type,
        request.source_id,
        request.source_url,
        request.source_text,
        source_title,
        request.style
    )

    # Generate diagram
    result = await visualiser.generate_diagram(
        source_content,
        request.style,
        request.model,
        reference_image=request.reference_image
    )

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    # Save message
    storage.add_visualiser_message(
        conversation_id,
        result["image_id"],
        result["image_path"],
        request.style,
        source_content,
        result.get("model")
    )

    # Track cost (wait briefly for OpenRouter to process costs)
    gen_id = result.get("generation_id")
    if gen_id:
        try:
            await asyncio.sleep(1.5)  # Wait for OpenRouter to process costs
            cost = await openrouter.get_generation_cost(gen_id)
            if cost and cost > 0:
                storage.update_conversation_cost(conversation_id, cost)
        except Exception as e:
            print(f"Error tracking visualiser cost: {e}")

    # Generate title if first message
    generated_title = None
    if is_first_message:
        generated_title = await generate_visualiser_title(source_content)
        storage.update_conversation_title(conversation_id, generated_title)

    # Link visualisation to source conversation
    if request.source_type == "conversation" and request.source_id:
        vis_title = generated_title or f"Diagram ({request.style})"
        storage.link_visualisation(request.source_id, conversation_id, vis_title)

    return {
        "image_id": result["image_id"],
        "image_url": f"/api/images/{result['image_id']}",
        "style": request.style,
        "model": result.get("model"),
        "conversation_title": generated_title
    }


class VisualiseEditRequest(BaseModel):
    """Request to edit/regenerate a diagram."""
    edit_prompt: str
    model: Optional[str] = None


@app.post("/api/conversations/{conversation_id}/visualise/edit")
async def edit_visualisation(conversation_id: str, request: VisualiseEditRequest):
    """Edit an existing diagram to create a new version."""
    # Verify conversation exists and is visualiser mode
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation.get("mode") != "visualiser":
        raise HTTPException(status_code=400, detail="Conversation is not in visualiser mode")

    # Find the latest assistant message with an image
    messages = conversation.get("messages", [])
    latest_image_msg = None
    for msg in reversed(messages):
        if msg.get("role") == "assistant" and msg.get("image_id"):
            latest_image_msg = msg
            break

    if not latest_image_msg:
        raise HTTPException(status_code=400, detail="No existing image to edit")

    # Get the image path
    image_path = latest_image_msg.get("image_path")
    if not image_path:
        # Try to construct from image_id
        image_id = latest_image_msg.get("image_id")
        image_path = f"data/images/{image_id}.png"

    source_content = latest_image_msg.get("source_content", "")
    style = latest_image_msg.get("style", "bento")

    # Generate edited diagram
    result = await visualiser.edit_diagram(
        image_path,
        request.edit_prompt,
        source_content,
        style,
        request.model
    )

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    # Save as new assistant message (new version)
    storage.add_visualiser_message(
        conversation_id,
        result["image_id"],
        result["image_path"],
        style,
        source_content,
        result.get("model"),
        edit_prompt=request.edit_prompt
    )

    # Track cost (wait briefly for OpenRouter to process costs)
    gen_id = result.get("generation_id")
    if gen_id:
        try:
            await asyncio.sleep(1.5)  # Wait for OpenRouter to process costs
            cost = await openrouter.get_generation_cost(gen_id)
            if cost and cost > 0:
                storage.update_conversation_cost(conversation_id, cost)
        except Exception as e:
            print(f"Error tracking visualiser edit cost: {e}")

    return {
        "image_id": result["image_id"],
        "image_url": f"/api/images/{result['image_id']}",
        "style": style,
        "model": result.get("model"),
        "version": len([m for m in messages if m.get("role") == "assistant" and m.get("image_id")]) + 1
    }


class VisualiseSpellCheckRequest(BaseModel):
    """Request to spell check a diagram."""
    model: Optional[str] = None


@app.post("/api/conversations/{conversation_id}/visualise/spellcheck")
async def spellcheck_visualisation(conversation_id: str, request: VisualiseSpellCheckRequest = VisualiseSpellCheckRequest()):
    """Spell check an existing diagram and generate a corrected version if errors are found."""
    # Verify conversation exists and is visualiser mode
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation.get("mode") != "visualiser":
        raise HTTPException(status_code=400, detail="Conversation is not in visualiser mode")

    # Find the latest assistant message with an image
    messages = conversation.get("messages", [])
    latest_image_msg = None
    for msg in reversed(messages):
        if msg.get("role") == "assistant" and msg.get("image_id"):
            latest_image_msg = msg
            break

    if not latest_image_msg:
        raise HTTPException(status_code=400, detail="No existing image to spell check")

    # Get the image path
    image_path = latest_image_msg.get("image_path")
    if not image_path:
        # Try to construct from image_id
        image_id = latest_image_msg.get("image_id")
        image_path = f"data/images/{image_id}.png"

    source_content = latest_image_msg.get("source_content", "")
    style = latest_image_msg.get("style", "bento")

    # Run spell check
    result = await visualiser.spell_check_diagram(
        image_path,
        source_content,
        style,
        request.model
    )

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    # Track costs (spell check may have 1 or 2 API calls depending on whether errors were found)
    generation_ids = result.get("generation_ids", [])
    if generation_ids:
        try:
            await asyncio.sleep(1.5)  # Wait for OpenRouter to process costs
            cost_tasks = [openrouter.get_generation_cost(gid) for gid in generation_ids if gid]
            costs = await asyncio.gather(*cost_tasks)
            total_cost = sum(c for c in costs if c is not None)
            if total_cost > 0:
                storage.update_conversation_cost(conversation_id, total_cost)
        except Exception as e:
            print(f"Error tracking spellcheck cost: {e}")

    # If no errors found, return response without creating new version
    if not result.get("has_errors"):
        return {
            "has_errors": False,
            "errors_found": result.get("errors_found", []),
            "message": "No spelling errors found"
        }

    # Save as new assistant message (new version) with spell check metadata
    # Store full list of errors for modal display
    errors_text = "\n".join(f"• {error}" for error in result['errors_found'])
    storage.add_visualiser_message(
        conversation_id,
        result["image_id"],
        result["image_path"],
        style,
        source_content,
        result.get("model"),
        edit_prompt=f"Spell check correction:\n{errors_text}"
    )

    return {
        "has_errors": True,
        "errors_found": result.get("errors_found", []),
        "corrected_prompt": result.get("corrected_prompt", ""),
        "image_id": result["image_id"],
        "image_url": f"/api/images/{result['image_id']}",
        "style": style,
        "model": result.get("model"),
        "version": len([m for m in messages if m.get("role") == "assistant" and m.get("image_id")]) + 1
    }


def extract_conversation_content(conversation: Dict) -> str:
    """Extract readable content from a conversation for visualization."""
    parts = []
    parts.append(f"Title: {conversation.get('title', 'Untitled')}")

    for msg in conversation.get("messages", []):
        if msg.get("role") == "user":
            if msg.get("content"):
                parts.append(f"Question: {msg['content']}")
        elif msg.get("role") == "assistant":
            # Council mode - stage3 is the synthesized answer
            if msg.get("stage3"):
                parts.append(f"Answer: {msg['stage3'].get('content', '')}")
            # Synthesizer mode - notes
            elif msg.get("notes"):
                for note in msg["notes"]:
                    parts.append(f"Note - {note.get('title', '')}: {note.get('body', '')}")

    return "\n\n".join(parts)


def compile_highlighted_content(
    source_conv: Dict,
    comments: List[Dict],
    context_segments: List[Dict]
) -> str:
    """
    Compile content for visualisation with clear separation between
    required elements (highlights) and background context (full notes).
    """
    parts = []

    # Section 1: Required Elements - MUST appear in visualization
    if comments:
        parts.append("## REQUIRED ELEMENTS")
        parts.append("")
        parts.append("The user has explicitly selected these items to appear in the visualization.")
        parts.append("Each of these MUST be prominently featured in the final image:")
        parts.append("")

        for i, comment in enumerate(comments, 1):
            parts.append(f"### Required Element {i}")
            selection = comment.get("selection", "")
            if selection:
                parts.append(f'Content: "{selection}"')
            annotation = comment.get("content", "")
            if annotation:
                parts.append(f'User note: "{annotation}"')
            parts.append("")

    # Section 2: Pinned Context Segments
    if context_segments:
        parts.append("## PINNED CONTENT")
        parts.append("")
        parts.append("The user pinned these larger sections as particularly relevant:")
        parts.append("")

        for i, segment in enumerate(context_segments, 1):
            label = segment.get("label", f"Segment {i}")
            content = segment.get("content", "")
            parts.append(f"### {label}")
            parts.append(content.strip())
            parts.append("")

    # Section 3: Background Context - for understanding, not direct inclusion
    conv_content = extract_conversation_content(source_conv)
    parts.append("## BACKGROUND CONTEXT")
    parts.append("")
    parts.append("The following provides background context to help you understand the subject matter.")
    parts.append("Use this to inform the visualization's accuracy and coherence,")
    parts.append("but focus the actual visual content on the REQUIRED ELEMENTS above.")
    parts.append("")
    parts.append(conv_content)

    return "\n".join(parts)


class VisualiseFromContextRequest(BaseModel):
    """Request to create visualisation from highlighted context."""
    comments: List[Dict[str, Any]]
    context_segments: List[Dict[str, Any]] = []
    style: str = "bento"
    model: Optional[str] = None


@app.post("/api/conversations/{conversation_id}/visualise-context")
async def visualise_from_context(conversation_id: str, request: VisualiseFromContextRequest):
    """Create a visualisation from highlighted context in a conversation."""

    # Verify source conversation exists
    source_conv = storage.get_conversation(conversation_id)
    if source_conv is None:
        raise HTTPException(status_code=404, detail="Source conversation not found")

    # Validate style
    available_styles = diagram_styles.list_diagram_styles()
    if request.style not in available_styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Must be one of: {list(available_styles.keys())}")

    # Compile context with emphasis on highlights
    source_content = compile_highlighted_content(
        source_conv,
        request.comments,
        request.context_segments
    )

    # Create new visualiser conversation
    new_conv_id = str(uuid.uuid4())
    storage.create_conversation(new_conv_id, mode='visualiser')

    # Add user message
    source_title = source_conv.get('title', 'Highlighted Content')
    storage.add_visualiser_user_message(
        new_conv_id,
        source_type='conversation',
        source_id=conversation_id,
        source_url=None,
        source_text=None,
        source_title=source_title,
        style=request.style
    )

    # Generate diagram
    result = await visualiser.generate_diagram(
        source_content,
        request.style,
        request.model
    )

    if result.get("error"):
        # Clean up the conversation we created
        storage.delete_conversation(new_conv_id)
        raise HTTPException(status_code=500, detail=result["error"])

    # Save assistant message
    storage.add_visualiser_message(
        new_conv_id,
        result["image_id"],
        result["image_path"],
        request.style,
        source_content,
        result.get("model")
    )

    # Generate title
    generated_title = await generate_visualiser_title(source_content)
    storage.update_conversation_title(new_conv_id, generated_title)

    # Link visualisation to source conversation
    storage.link_visualisation(conversation_id, new_conv_id, generated_title)

    # Track cost
    gen_id = result.get("generation_id")
    if gen_id:
        try:
            await asyncio.sleep(1.5)
            cost = await openrouter.get_generation_cost(gen_id)
            if cost and cost > 0:
                storage.update_conversation_cost(new_conv_id, cost)
        except Exception as e:
            print(f"Error tracking visualise-context cost: {e}")

    return {
        "conversation_id": new_conv_id,
        "conversation_title": generated_title,
        "image_id": result["image_id"],
        "image_url": f"/api/images/{result['image_id']}",
        "style": request.style,
        "model": result.get("model")
    }


@app.get("/api/images")
async def list_all_images(limit: int = 100, offset: int = 0):
    """List all visualiser images with metadata for the gallery view."""
    return visualiser.list_all_images_with_metadata(limit, offset)


@app.get("/api/images/{image_id}")
async def get_image(image_id: str):
    """Serve a generated image."""
    from fastapi.responses import FileResponse

    # Validate image_id to prevent path traversal
    if ".." in image_id or "/" in image_id or "\\" in image_id:
        raise HTTPException(status_code=400, detail="Invalid image ID")

    image_path = visualiser.get_image_path(image_id)
    if not image_path:
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(image_path, media_type="image/png")


@app.get("/api/images/{image_id}/download")
async def download_image(image_id: str, filename: str = "diagram.png"):
    """Download a generated image with Content-Disposition header."""
    from fastapi.responses import FileResponse

    # Validate image_id to prevent path traversal
    if ".." in image_id or "/" in image_id or "\\" in image_id:
        raise HTTPException(status_code=400, detail="Invalid image ID")

    image_path = visualiser.get_image_path(image_id)
    if not image_path:
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(
        image_path,
        media_type="image/png",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.get("/api/settings/visualiser")
async def get_visualiser_settings_endpoint():
    """Get visualiser-specific settings including diagram styles."""
    styles = diagram_styles.list_diagram_styles()
    return {
        "default_model": settings.get_visualiser_model(),
        "diagram_styles": styles
    }


class UpdateVisualiserModelRequest(BaseModel):
    model: str


@app.put("/api/settings/visualiser/model")
async def update_visualiser_model(request: UpdateVisualiserModelRequest):
    """Update visualiser default model."""
    if not request.model:
        raise HTTPException(status_code=400, detail="Model is required")

    settings.set_visualiser_model(request.model)
    return {
        "success": True,
        "default_model": settings.get_visualiser_model()
    }


# Diagram Style Endpoints

@app.get("/api/settings/visualiser/styles")
async def get_diagram_styles_endpoint():
    """Get all diagram styles."""
    return diagram_styles.list_diagram_styles()


@app.get("/api/settings/visualiser/styles/{style_id}")
async def get_diagram_style_endpoint(style_id: str):
    """Get a specific diagram style."""
    style = diagram_styles.get_diagram_style(style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")
    return {"id": style_id, **style}


class CreateDiagramStyleRequest(BaseModel):
    """Request to create a new diagram style."""
    id: str
    name: str
    description: str
    icon: str = "image"
    prompt: str


@app.post("/api/settings/visualiser/styles")
async def create_diagram_style_endpoint(request: CreateDiagramStyleRequest):
    """Create a new diagram style."""
    # Validate ID format (alphanumeric and underscores only)
    if not request.id or not all(c.isalnum() or c == '_' for c in request.id):
        raise HTTPException(status_code=400, detail="Style ID must contain only letters, numbers, and underscores")

    success = diagram_styles.create_diagram_style(
        request.id,
        request.name,
        request.description,
        request.icon,
        request.prompt
    )

    if not success:
        raise HTTPException(status_code=400, detail="Style ID already exists")

    return {
        "success": True,
        "style": {
            "id": request.id,
            "name": request.name,
            "description": request.description,
            "icon": request.icon,
            "prompt": request.prompt
        }
    }


class UpdateDiagramStyleRequest(BaseModel):
    """Request to update a diagram style."""
    name: str
    description: str
    icon: str = "image"
    prompt: str


@app.put("/api/settings/visualiser/styles/{style_id}")
async def update_diagram_style_endpoint(style_id: str, request: UpdateDiagramStyleRequest):
    """Update an existing diagram style."""
    # Check if style exists
    existing = diagram_styles.get_diagram_style(style_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Style not found")

    diagram_styles.update_diagram_style(
        style_id,
        request.name,
        request.description,
        request.icon,
        request.prompt
    )

    return {
        "success": True,
        "style": {
            "id": style_id,
            "name": request.name,
            "description": request.description,
            "icon": request.icon,
            "prompt": request.prompt
        }
    }


@app.delete("/api/settings/visualiser/styles/{style_id}")
async def delete_diagram_style_endpoint(style_id: str):
    """Delete a diagram style."""
    success = diagram_styles.delete_diagram_style(style_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot delete style (not found or is the last style)")
    return {"success": True}


# =============================================================================
# Tweet Generation Endpoint
# =============================================================================

class GenerateTweetRequest(BaseModel):
    """Request to generate a tweet from a note."""
    note_body: str
    note_title: str
    comments: Optional[List[Dict[str, Any]]] = None
    custom_prompt: Optional[str] = None


@app.post("/api/generate-tweet")
async def generate_tweet_endpoint(request: GenerateTweetRequest):
    """Generate a 280-character tweet from a note."""
    tweet_text = await tweet.generate_tweet(
        note_body=request.note_body,
        note_title=request.note_title,
        comments=request.comments,
        custom_prompt=request.custom_prompt
    )

    if tweet_text is None:
        raise HTTPException(status_code=500, detail="Failed to generate tweet")

    return {
        "tweet": tweet_text,
        "char_count": len(tweet_text)
    }


# =============================================================================
# Monitor Endpoints
# =============================================================================

class CreateMonitorRequest(BaseModel):
    """Request to create a new monitor."""
    name: str
    question_set: str = "default_b2b_saas_v1"


class MonitorMessageRequest(BaseModel):
    """Request to send a message to a monitor."""
    content: str


@app.get("/api/monitors")
async def list_monitors():
    """List all monitors."""
    return monitors.list_monitors()


@app.post("/api/monitors")
async def create_monitor(request: CreateMonitorRequest):
    """Create a new monitor."""
    return monitors.create_monitor(request.name, request.question_set)


@app.get("/api/monitors/{monitor_id}")
async def get_monitor(monitor_id: str):
    """Get a specific monitor."""
    monitor = monitors.get_monitor(monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return monitor


@app.patch("/api/monitors/{monitor_id}")
async def update_monitor(monitor_id: str, updates: dict):
    """Update a monitor's configuration."""
    monitor = monitors.update_monitor(monitor_id, updates)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return monitor


@app.delete("/api/monitors/{monitor_id}")
async def delete_monitor(monitor_id: str):
    """Delete a monitor and all its data."""
    if not monitors.delete_monitor(monitor_id):
        raise HTTPException(status_code=404, detail="Monitor not found")
    return {"success": True}


@app.post("/api/monitors/{monitor_id}/mark-read")
async def mark_monitor_read(monitor_id: str):
    """Mark a monitor as read, resetting the unread updates counter."""
    result = monitors.mark_read(monitor_id)
    if not result:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return result


@app.post("/api/monitors/{monitor_id}/message")
async def send_monitor_message(monitor_id: str, request: MonitorMessageRequest):
    """Send a message to a monitor and get a response."""
    result = await monitor_chat.process_monitor_message(monitor_id, request.content)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/monitors/{monitor_id}/message/stream")
async def send_monitor_message_stream(monitor_id: str, request: MonitorMessageRequest):
    """Send a message to a monitor with streaming response."""
    return StreamingResponse(
        monitor_chat.process_monitor_message_stream(monitor_id, request.content),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


class DiscoverCompetitorRequest(BaseModel):
    """Request to discover pages on a competitor website."""
    url: str
    name: str


@app.post("/api/monitors/{monitor_id}/discover")
async def discover_competitor_pages(monitor_id: str, request: DiscoverCompetitorRequest):
    """
    Discover pages on a competitor website using Firecrawl map.
    Returns tiered page recommendations from LLM analysis.
    """
    from .monitor_crawler import map_website
    from .monitor_analysis import analyze_pages_for_tracking

    # Verify monitor exists
    monitor = monitors.get_monitor(monitor_id)
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")

    # Map the website
    map_result = await map_website(request.url, limit=200)

    if not map_result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=f"Failed to map website: {map_result.get('error', 'Unknown error')}"
        )

    pages = map_result.get("pages", [])

    if not pages:
        raise HTTPException(status_code=400, detail="No pages found on website")

    # Analyze pages with LLM to get tier recommendations
    tiers = await analyze_pages_for_tracking(pages, request.name)

    if not tiers:
        # Fallback to basic tier structure
        tiers = {
            "minimum": [{"url": pages[0]["url"], "type": "homepage", "reason": "Main page"}] if pages else [],
            "suggested": [],
            "generous": [],
            "all": [{"url": p["url"], "type": "other", "reason": ""} for p in pages],
            "reasoning": "LLM analysis unavailable, using fallback"
        }

    return {
        "success": True,
        "name": request.name,
        "domain": request.url,
        "total_pages_found": len(pages),
        "tiers": tiers,
        "site_map": pages  # Full map for baseline storage
    }


class AddCompetitorRequest(BaseModel):
    """Request to add a competitor to a monitor."""
    name: str
    domain: str = None
    pages: List[Dict[str, Any]] = []
    site_map_baseline: List[Dict[str, Any]] = None
    tier: str = "suggested"


@app.post("/api/monitors/{monitor_id}/competitors")
async def add_competitor(monitor_id: str, request: AddCompetitorRequest):
    """Add a competitor to a monitor with discovered pages."""
    competitor = monitors.add_competitor(
        monitor_id,
        request.name,
        domain=request.domain,
        pages=request.pages,
        site_map_baseline=request.site_map_baseline,
        tier=request.tier
    )
    if competitor is None:
        raise HTTPException(status_code=400, detail="Failed to add competitor (may already exist)")
    return competitor


@app.get("/api/monitors/{monitor_id}/competitors/{competitor_id}/structure-changes")
async def get_structure_changes(monitor_id: str, competitor_id: str):
    """
    Get site structure changes for a competitor.
    Compares current site map to baseline and provides strategic analysis.
    """
    from .monitor_crawler import map_website, compare_site_structure
    from .monitor_analysis import analyze_structural_changes

    # Get competitor
    competitor = monitors.get_competitor(monitor_id, competitor_id)
    if not competitor:
        raise HTTPException(status_code=404, detail="Competitor not found")

    domain = competitor.get("domain")
    if not domain:
        raise HTTPException(status_code=400, detail="Competitor has no domain configured")

    baseline = competitor.get("site_map_baseline", [])

    # Get current site map
    map_result = await map_website(domain, limit=200)
    if not map_result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=f"Failed to map website: {map_result.get('error', 'Unknown error')}"
        )

    current_map = map_result.get("pages", [])

    # Compare structures
    changes = compare_site_structure(current_map, baseline)

    # Get strategic analysis if there are changes
    analysis = None
    if changes.get("has_changes"):
        analysis = await analyze_structural_changes(changes, competitor.get("name", ""))

    return {
        "competitor_id": competitor_id,
        "competitor_name": competitor.get("name"),
        "changes": changes,
        "analysis": analysis,
        "current_map_size": len(current_map),
        "baseline_map_size": len(baseline)
    }


@app.post("/api/monitors/{monitor_id}/competitors/{competitor_id}/update-baseline")
async def update_competitor_baseline(monitor_id: str, competitor_id: str):
    """
    Update a competitor's site map baseline to current state.
    """
    from .monitor_crawler import map_website

    # Get competitor
    competitor = monitors.get_competitor(monitor_id, competitor_id)
    if not competitor:
        raise HTTPException(status_code=404, detail="Competitor not found")

    domain = competitor.get("domain")
    if not domain:
        raise HTTPException(status_code=400, detail="Competitor has no domain configured")

    # Get current site map
    map_result = await map_website(domain, limit=200)
    if not map_result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=f"Failed to map website: {map_result.get('error', 'Unknown error')}"
        )

    # Update baseline
    updated = monitors.update_competitor_site_map(
        monitor_id,
        competitor_id,
        map_result.get("pages", [])
    )

    if not updated:
        raise HTTPException(status_code=400, detail="Failed to update baseline")

    return {
        "success": True,
        "competitor_id": competitor_id,
        "new_baseline_size": len(map_result.get("pages", []))
    }


@app.delete("/api/monitors/{monitor_id}/competitors/{competitor_id}")
async def remove_competitor(monitor_id: str, competitor_id: str):
    """Remove a competitor from a monitor."""
    if not monitors.remove_competitor(monitor_id, competitor_id):
        raise HTTPException(status_code=404, detail="Competitor not found")
    return {"success": True}


class AddPageRequest(BaseModel):
    """Request to add a page to track."""
    url: str
    page_type: str = "page"
    visual_critical: bool = False
    crawl_frequency: str = "daily"


@app.post("/api/monitors/{monitor_id}/competitors/{competitor_id}/pages")
async def add_page(monitor_id: str, competitor_id: str, request: AddPageRequest):
    """Add a page to track for a competitor."""
    page = monitors.add_page(
        monitor_id,
        competitor_id,
        request.url,
        request.page_type,
        request.visual_critical,
        request.crawl_frequency
    )
    if page is None:
        raise HTTPException(status_code=400, detail="Failed to add page")
    return page


@app.delete("/api/monitors/{monitor_id}/competitors/{competitor_id}/pages/{page_id}")
async def remove_page(monitor_id: str, competitor_id: str, page_id: str):
    """Remove a page from tracking."""
    if not monitors.remove_page(monitor_id, competitor_id, page_id):
        raise HTTPException(status_code=404, detail="Page not found")
    return {"success": True}


@app.post("/api/monitors/{monitor_id}/crawl")
async def trigger_monitor_crawl(monitor_id: str):
    """Trigger an immediate crawl for a monitor."""
    result = await monitor_scheduler.trigger_crawl(monitor_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/api/monitors/{monitor_id}/snapshots")
async def list_snapshots(monitor_id: str, competitor_id: str = None, page_id: str = None, limit: int = 100):
    """List snapshots for a monitor."""
    snapshots = monitor_crawler.get_snapshots(monitor_id, competitor_id, page_id, limit)
    return snapshots


@app.get("/api/monitors/{monitor_id}/updates")
async def get_monitor_updates(
    monitor_id: str,
    since: str = None,
    tags: str = None,
    competitor_id: str = None,
    limit: int = 50
):
    """Get updates (meaningful changes) for a monitor."""
    tag_list = tags.split(",") if tags else None
    updates = monitor_updates.get_updates(monitor_id, since, tag_list, competitor_id, limit)
    return updates


@app.get("/api/monitors/{monitor_id}/summary")
async def get_monitor_summary(monitor_id: str):
    """Get aggregate summary stats for a monitor."""
    summary = monitor_updates.get_summary(monitor_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return summary


@app.get("/api/monitors/{monitor_id}/compare")
async def get_monitor_comparison(monitor_id: str, question: str, competitor_ids: str = None):
    """Get comparison data for a specific question across competitors."""
    comp_list = competitor_ids.split(",") if competitor_ids else None
    comparison = monitor_updates.get_comparison(monitor_id, question, comp_list)
    return comparison


@app.get("/api/monitors/{monitor_id}/screenshot/{screenshot_path:path}")
async def get_monitor_screenshot(monitor_id: str, screenshot_path: str):
    """Serve a screenshot file for a monitor."""
    from fastapi.responses import FileResponse
    from .monitors import _get_monitor_data_dir

    # Validate path to prevent directory traversal
    if ".." in screenshot_path or screenshot_path.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid path")

    data_dir = _get_monitor_data_dir(monitor_id)
    file_path = data_dir / screenshot_path

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Screenshot not found")

    return FileResponse(file_path, media_type="image/png")


@app.get("/api/monitors/{monitor_id}/snapshot/{snapshot_id}")
async def get_monitor_snapshot_detail(monitor_id: str, snapshot_id: str):
    """Get full snapshot details including previous snapshot for comparison."""
    from .monitor_crawler import get_snapshots, _get_snapshot_dir, _get_monitor_data_dir
    import json as json_module

    # Find the snapshot
    data_dir = _get_monitor_data_dir(monitor_id)
    snapshots_root = data_dir / "snapshots"

    if not snapshots_root.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    # Search for the snapshot file
    snapshot_data = None
    for snapshot_file in snapshots_root.glob(f"**/{snapshot_id}.json"):
        with open(snapshot_file, "r") as f:
            snapshot_data = json_module.load(f)
        break

    if not snapshot_data:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    # Get previous snapshot if available
    previous_snapshot = None
    if snapshot_data.get("previous_snapshot_id"):
        prev_id = snapshot_data["previous_snapshot_id"]
        for prev_file in snapshots_root.glob(f"**/{prev_id}.json"):
            with open(prev_file, "r") as f:
                previous_snapshot = json_module.load(f)
            break

    return {
        "current": snapshot_data,
        "previous": previous_snapshot
    }


@app.get("/api/monitors/{monitor_id}/digests")
async def list_monitor_digests(monitor_id: str, limit: int = 10):
    """List past digests for a monitor."""
    digests = monitor_digest.get_digests(monitor_id, limit)
    return digests


@app.get("/api/monitors/{monitor_id}/digests/{digest_id}")
async def get_monitor_digest(monitor_id: str, digest_id: str):
    """Get a specific digest by ID."""
    digest = monitor_digest.get_digest(monitor_id, digest_id)
    if not digest:
        raise HTTPException(status_code=404, detail="Digest not found")
    return digest


@app.post("/api/monitors/{monitor_id}/digests")
async def create_monitor_digest(monitor_id: str, period: str = "weekly"):
    """Generate a new digest for the specified period."""
    digest = monitor_digest.generate_digest(monitor_id, period)
    if not digest:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return digest


# =============================================================================
# Podcast Endpoints
# =============================================================================

from . import podcast, podcast_storage, podcast_styles


class CreatePodcastSessionRequest(BaseModel):
    """Request to create a podcast session."""
    conversation_id: str
    note_ids: Optional[List[str]] = None
    style: str = "conversational"


class SpeakerConfigRequest(BaseModel):
    """Request to update host or expert speaker config."""
    voice_id: Optional[str] = None
    model: Optional[str] = None
    stability: Optional[float] = None
    similarity_boost: Optional[float] = None
    style: Optional[float] = None
    speed: Optional[float] = None
    system_prompt: Optional[str] = None


@app.get("/api/settings/podcast")
async def get_podcast_settings_endpoint():
    """Get podcast settings and configuration status."""
    return settings.get_podcast_settings()


class ElevenLabsApiKeyRequest(BaseModel):
    """Request to set ElevenLabs API key."""
    api_key: str


@app.post("/api/settings/podcast/elevenlabs-api-key")
async def set_elevenlabs_api_key_endpoint(request: ElevenLabsApiKeyRequest):
    """Set the ElevenLabs API key."""
    settings.set_elevenlabs_api_key(request.api_key)
    return {"success": True, "source": "settings"}


@app.delete("/api/settings/podcast/elevenlabs-api-key")
async def clear_elevenlabs_api_key_endpoint():
    """Clear the ElevenLabs API key from settings."""
    settings.clear_elevenlabs_api_key()
    return {"success": True}


@app.put("/api/settings/podcast/host")
async def update_host_config(request: SpeakerConfigRequest):
    """Update host speaker configuration."""
    voice_settings = None
    if any([request.stability is not None, request.similarity_boost is not None,
            request.style is not None, request.speed is not None]):
        current = settings.get_host_voice_config()
        voice_settings = current["voice_settings"].copy()
        if request.stability is not None:
            voice_settings["stability"] = request.stability
        if request.similarity_boost is not None:
            voice_settings["similarity_boost"] = request.similarity_boost
        if request.style is not None:
            voice_settings["style"] = request.style
        if request.speed is not None:
            voice_settings["speed"] = request.speed

    settings.set_host_voice_config(
        voice_id=request.voice_id,
        model=request.model,
        voice_settings=voice_settings,
        system_prompt=request.system_prompt,
    )
    return settings.get_podcast_settings()


@app.put("/api/settings/podcast/expert")
async def update_expert_config(request: SpeakerConfigRequest):
    """Update expert speaker configuration."""
    voice_settings = None
    if any([request.stability is not None, request.similarity_boost is not None,
            request.style is not None, request.speed is not None]):
        current = settings.get_expert_voice_config()
        voice_settings = current["voice_settings"].copy()
        if request.stability is not None:
            voice_settings["stability"] = request.stability
        if request.similarity_boost is not None:
            voice_settings["similarity_boost"] = request.similarity_boost
        if request.style is not None:
            voice_settings["style"] = request.style
        if request.speed is not None:
            voice_settings["speed"] = request.speed

    settings.set_expert_voice_config(
        voice_id=request.voice_id,
        model=request.model,
        voice_settings=voice_settings,
        system_prompt=request.system_prompt,
    )
    return settings.get_podcast_settings()


class CoverPromptRequest(BaseModel):
    prompt: str


@app.post("/api/settings/podcast/cover-prompt")
async def set_cover_prompt_endpoint(request: CoverPromptRequest):
    """Set the podcast cover art prompt."""
    settings.set_podcast_cover_prompt(request.prompt)
    return {"success": True}


class CoverModelRequest(BaseModel):
    model: str


@app.get("/api/settings/podcast/cover-model")
async def get_cover_model_endpoint():
    """Get the podcast cover art model."""
    return {"model": settings.get_podcast_cover_model()}


@app.post("/api/settings/podcast/cover-model")
async def set_cover_model_endpoint(request: CoverModelRequest):
    """Set the podcast cover art model."""
    settings.set_podcast_cover_model(request.model)
    return {"success": True, "model": request.model}


# =============================================================================
# Podcast Narration Styles Endpoints
# =============================================================================

@app.get("/api/settings/podcast/styles")
async def list_podcast_styles_endpoint():
    """List all podcast narration styles."""
    return podcast_styles.list_podcast_styles()


@app.get("/api/settings/podcast/styles/{style_id}")
async def get_podcast_style_endpoint(style_id: str):
    """Get a specific podcast style."""
    style = podcast_styles.get_podcast_style(style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")
    return {"id": style_id, **style}


class CreatePodcastStyleRequest(BaseModel):
    """Request to create a new podcast style."""
    id: str
    name: str
    description: str
    prompt: str


@app.post("/api/settings/podcast/styles")
async def create_podcast_style_endpoint(request: CreatePodcastStyleRequest):
    """Create a new podcast narration style."""
    # Validate ID format (alphanumeric, hyphens, and underscores only)
    if not request.id or not all(c.isalnum() or c in '-_' for c in request.id):
        raise HTTPException(status_code=400, detail="Style ID must contain only letters, numbers, hyphens, and underscores")

    success = podcast_styles.create_podcast_style(
        request.id,
        request.name,
        request.description,
        request.prompt
    )

    if not success:
        raise HTTPException(status_code=400, detail="Style ID already exists")

    return {
        "success": True,
        "style": {
            "id": request.id,
            "name": request.name,
            "description": request.description,
            "prompt": request.prompt
        }
    }


class UpdatePodcastStyleRequest(BaseModel):
    """Request to update a podcast style."""
    name: str
    description: str
    prompt: str


@app.put("/api/settings/podcast/styles/{style_id}")
async def update_podcast_style_endpoint(style_id: str, request: UpdatePodcastStyleRequest):
    """Update an existing podcast narration style."""
    # Check if style exists
    existing = podcast_styles.get_podcast_style(style_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Style not found")

    podcast_styles.update_podcast_style(
        style_id,
        request.name,
        request.description,
        request.prompt
    )

    return {
        "success": True,
        "style": {
            "id": style_id,
            "name": request.name,
            "description": request.description,
            "prompt": request.prompt
        }
    }


@app.delete("/api/settings/podcast/styles/{style_id}")
async def delete_podcast_style_endpoint(style_id: str):
    """Delete a podcast narration style."""
    success = podcast_styles.delete_podcast_style(style_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot delete style (not found or is the last style)")
    return {"success": True}


def _generate_metadata_and_cover_background_sync(session_id: str):
    """
    Sync wrapper for background metadata and cover generation.

    FastAPI BackgroundTasks runs sync functions in a thread pool,
    so we create a new event loop for the async operations.

    This function:
    1. Generates title and summary using LLM
    2. Generates cover art using the summary for better context
    """
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Starting background metadata generation for session {session_id}")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # Step 1: Generate metadata (title + summary)
        metadata_result = loop.run_until_complete(podcast.update_session_metadata(session_id))
        if metadata_result.get("error"):
            logger.error(f"Metadata generation failed for {session_id}: {metadata_result['error']}")
        else:
            logger.info(f"Metadata generated for {session_id}: {metadata_result.get('title')}")

        # Step 2: Generate cover (can now use the summary)
        logger.info(f"Starting cover generation for session {session_id}")
        cover_result = loop.run_until_complete(podcast.generate_podcast_cover(session_id))
        if cover_result.get("error"):
            logger.error(f"Cover generation failed for {session_id}: {cover_result['error']}")
        else:
            logger.info(f"Cover generated successfully for {session_id}: {cover_result.get('cover_url')}")
    except Exception as e:
        logger.exception(f"Failed to generate metadata/cover for session {session_id}: {e}")
    finally:
        loop.close()


def _generate_podcast_audio_background_sync(session_id: str):
    """
    Sync wrapper for background podcast audio generation.

    FastAPI BackgroundTasks runs sync functions in a thread pool,
    so we create a new event loop for the async operations.
    """
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"[PODCAST] Background audio generation starting for session {session_id}")

    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(podcast.generate_podcast_audio(session_id))
        if result.get("error"):
            logger.error(f"[PODCAST] Generation failed: {result['error']}")
        else:
            logger.info(f"[PODCAST] Generation complete for session {session_id}")
    except Exception as e:
        logger.exception(f"[PODCAST] Background generation failed: {e}")
        # Update session with error status
        sess = podcast_storage.get_podcast_session(session_id)
        if sess:
            sess["status"] = "error"
            sess["error"] = str(e)
            podcast_storage.save_podcast_session(sess)
    finally:
        loop.close()


@app.post("/api/podcast/sessions")
async def create_podcast_session_endpoint(
    request: CreatePodcastSessionRequest,
    background_tasks: BackgroundTasks
):
    """Create a new podcast session from synthesizer notes."""
    try:
        session = podcast.create_podcast_session(
            request.conversation_id,
            request.note_ids,
            request.style
        )

        # Trigger metadata + cover generation in background using FastAPI BackgroundTasks
        # This runs in a thread pool and survives after response is sent
        # First generates title/summary, then uses summary for cover generation
        background_tasks.add_task(_generate_metadata_and_cover_background_sync, session["session_id"])

        return session
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/podcast/sessions")
async def list_podcast_sessions_endpoint(
    conversation_id: Optional[str] = None,
    limit: int = 50
):
    """List podcast sessions."""
    return podcast_storage.list_podcast_sessions(conversation_id, limit)


@app.get("/api/podcast/sessions/{session_id}")
async def get_podcast_session_endpoint(session_id: str):
    """Get a specific podcast session."""
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/podcast/sessions/by-prefix/{prefix}")
async def get_session_by_prefix_endpoint(prefix: str):
    """Get a session by ID prefix (for agent room matching)."""
    session = podcast_storage.get_session_by_prefix(prefix)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


class PodcastReactionRequest(BaseModel):
    emoji: str
    timestamp_ms: int


@app.post("/api/podcast/sessions/{session_id}/reactions")
async def add_podcast_reaction_endpoint(session_id: str, request: PodcastReactionRequest):
    """Add an emoji reaction to a podcast session."""
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    podcast_storage.add_session_reaction(session_id, request.emoji, request.timestamp_ms)
    return {"success": True}


@app.get("/api/podcast/sessions/{session_id}/reactions")
async def get_podcast_reactions_endpoint(session_id: str):
    """Get all reactions for a podcast session."""
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {"reactions": podcast_storage.get_session_reactions(session_id)}


@app.post("/api/podcast/sessions/{session_id}/generate")
async def generate_podcast_audio_endpoint(session_id: str, background_tasks: BackgroundTasks):
    """
    Start audio generation for a podcast session.

    Generation runs in the background. Poll the session status
    or use the SSE endpoint for progress updates.
    """
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.get("status") == "ready":
        return {
            "status": "ready",
            "audio_url": f"/api/podcast/sessions/{session_id}/audio"
        }

    if session.get("status") == "generating":
        return {
            "status": "generating",
            "progress": session.get("generation_progress", 0)
        }

    # Start background generation using sync wrapper with BackgroundTasks
    # This runs in a thread pool and survives after response is sent
    background_tasks.add_task(_generate_podcast_audio_background_sync, session_id)

    return {"status": "generating", "progress": 0}


@app.get("/api/podcast/sessions/{session_id}/generate/stream")
async def stream_generation_progress(session_id: str):
    """SSE endpoint for generation progress updates."""
    from fastapi.responses import StreamingResponse
    import json as json_module

    async def event_generator():
        while True:
            session = podcast_storage.get_podcast_session(session_id)
            if not session:
                yield f"data: {json_module.dumps({'error': 'Session not found'})}\n\n"
                break

            status = session.get("status", "created")
            progress = session.get("generation_progress", 0)
            message = session.get("generation_message", "Starting...")
            step = session.get("generation_step", "starting")
            audio_current = session.get("audio_current_segment", 0)
            audio_total = session.get("audio_total_segments", 0)

            if status == "ready":
                yield f"data: {json_module.dumps({'status': 'ready', 'progress': 1.0, 'message': 'Complete!', 'step': 'complete', 'audio_url': f'/api/podcast/sessions/{session_id}/audio'})}\n\n"
                break
            elif status == "error":
                yield f"data: {json_module.dumps({'status': 'error', 'error': session.get('error', 'Unknown error')})}\n\n"
                break
            else:
                yield f"data: {json_module.dumps({'status': status, 'progress': progress, 'message': message, 'step': step, 'audio_current': audio_current, 'audio_total': audio_total})}\n\n"

            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/podcast/sessions/{session_id}/end")
async def end_podcast_session_endpoint(session_id: str):
    """End a podcast session."""
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    podcast_storage.mark_session_ended(session_id)
    return {"success": True}


@app.get("/api/podcast/sessions/{session_id}/transcript")
async def get_podcast_transcript_endpoint(session_id: str):
    """Get the transcript for a podcast session."""
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session_id,
        "transcript": session.get("transcript", []),
        "status": session.get("status", "created")
    }


@app.get("/api/podcast/sessions/{session_id}/word-timings")
async def get_podcast_word_timings_endpoint(session_id: str):
    """
    Get word timings for teleprompter sync during replay.

    Returns word-level timing data for accurate text highlighting
    synchronized with audio playback at any speed.
    """
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session_id,
        "word_timings": session.get("word_timings", [])
    }


@app.get("/api/podcast/sessions/{session_id}/cover")
async def get_podcast_cover_endpoint(session_id: str):
    """Serve the cover image for a podcast session from its folder."""
    from fastapi.responses import FileResponse

    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get cover path from new folder structure
    cover_path = podcast_storage.get_podcast_cover_path(session_id)

    if cover_path.exists():
        return FileResponse(str(cover_path), media_type="image/png")

    raise HTTPException(status_code=404, detail="Cover not found")


@app.post("/api/podcast/sessions/{session_id}/cover/generate")
async def regenerate_podcast_cover_endpoint(session_id: str):
    """Regenerate cover art for an existing podcast session."""
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await podcast.generate_podcast_cover(session_id)

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return {
        "success": True,
        "cover_url": result.get("cover_url")
    }


@app.delete("/api/podcast/sessions/{session_id}")
async def delete_podcast_session_endpoint(session_id: str):
    """Delete a podcast session."""
    if not podcast_storage.delete_podcast_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


from fastapi import UploadFile, File
from pathlib import Path


@app.post("/api/podcast/sessions/{session_id}/audio")
async def upload_podcast_audio_endpoint(session_id: str, audio: UploadFile = File(...)):
    """Upload recorded podcast audio for a session."""
    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get audio path from new folder structure
    audio_path = podcast_storage.get_podcast_audio_path(session_id)
    audio_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        content = await audio.read()
        with open(audio_path, "wb") as f:
            f.write(content)

        # Update session with audio path
        podcast_storage.update_session_audio_path(session_id, str(audio_path))

        return {"success": True, "audio_path": str(audio_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save audio: {str(e)}")


@app.get("/api/podcast/sessions/{session_id}/audio")
async def get_podcast_audio_endpoint(session_id: str):
    """Serve the generated audio file for a podcast session."""
    from fastapi.responses import FileResponse
    from .podcast_elevenlabs import get_podcast_audio_path

    session = podcast_storage.get_podcast_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # First check session's stored path (for backwards compatibility)
    audio_path = session.get("audio_path")
    if audio_path:
        # Handle relative paths from data directory
        if not audio_path.startswith("/"):
            audio_path = Path("data") / audio_path
        else:
            audio_path = Path(audio_path)

        if audio_path.exists():
            # Determine media type from extension
            media_type = "audio/mpeg" if audio_path.suffix == ".mp3" else "audio/webm"
            return FileResponse(str(audio_path), media_type=media_type)

    # Check new ElevenLabs audio location
    elevenlabs_path = get_podcast_audio_path(session_id)
    if elevenlabs_path and elevenlabs_path.exists():
        return FileResponse(str(elevenlabs_path), media_type="audio/mpeg")

    raise HTTPException(status_code=404, detail="No audio generated for this session")


# ===== Migration Endpoints =====

@app.post("/api/migrate/visualisation-links")
async def migrate_visualisation_links():
    """
    Migrate existing visualiser conversations to create bidirectional links
    with their source conversations.
    """
    count = storage.migrate_visualisation_links()
    return {"migrated": count, "message": f"Created {count} visualisation link(s)"}


# ===== Knowledge Graph Endpoints =====

from . import knowledge_graph


class ManualLinkRequest(BaseModel):
    """Request to create a manual link."""
    source: str
    target: str
    label: str = "related"


@app.get("/api/knowledge-graph")
async def get_knowledge_graph(tags: Optional[str] = None):
    """
    Get the full knowledge graph.

    Args:
        tags: Optional comma-separated list of tags to filter by
    """
    graph = knowledge_graph.build_graph()

    # Apply tag filter if provided
    if tags:
        tag_list = [t.strip().lower() for t in tags.split(",")]
        # Filter nodes to only include notes with matching tags
        filtered_note_ids = set()
        for node in graph["nodes"]:
            if node["type"] == "note":
                node_tags = [t.lower() for t in node.get("tags", [])]
                if any(tag in node_tags for tag in tag_list):
                    filtered_note_ids.add(node["id"])

        # Include source nodes for filtered notes
        source_ids = set()
        for node in graph["nodes"]:
            if node["type"] == "note" and node["id"] in filtered_note_ids:
                source_ids.add(node.get("sourceId"))

        # Filter nodes
        filtered_nodes = [
            n for n in graph["nodes"]
            if n["type"] == "entity"
            or n["id"] in filtered_note_ids
            or n["id"] in source_ids
        ]

        # Filter links to only include those between filtered nodes
        node_ids = {n["id"] for n in filtered_nodes}
        filtered_links = [
            l for l in graph["links"]
            if l["source"] in node_ids and l["target"] in node_ids
        ]

        graph["nodes"] = filtered_nodes
        graph["links"] = filtered_links

    return graph


@app.get("/api/knowledge-graph/stats")
async def get_knowledge_graph_stats():
    """Get knowledge graph statistics."""
    return knowledge_graph.get_graph_stats()


@app.get("/api/knowledge-graph/search")
async def search_knowledge_graph_endpoint(
    q: str,
    types: Optional[str] = None,
    entity_types: Optional[str] = None,
    tags: Optional[str] = None,
    limit: int = 20
):
    """
    Search knowledge graph nodes by semantic similarity.

    Args:
        q: Search query string
        types: Optional comma-separated list of node types (entity, note, source)
        entity_types: Optional comma-separated list of entity types (person, organization, etc.)
        tags: Optional comma-separated list of tags to filter notes by
        limit: Maximum results to return (default 20)

    Returns:
        Object with results array and query info
    """
    # Parse comma-separated filters
    node_types = [t.strip() for t in types.split(",")] if types else None
    entity_type_list = [t.strip() for t in entity_types.split(",")] if entity_types else None
    tag_list = [t.strip() for t in tags.split(",")] if tags else None

    results = graph_search.search_knowledge_graph(
        query=q,
        node_types=node_types,
        entity_types=entity_type_list,
        tags=tag_list,
        limit=limit
    )

    return {
        "results": results,
        "query": q,
        "total": len(results)
    }


@app.get("/api/knowledge-graph/notes/{note_id:path}/related")
async def get_related_notes(note_id: str):
    """
    Get notes related to a specific note via the knowledge graph.
    Returns notes grouped by connection type (sequential, shared_tag, shared_entity, same_source).
    """
    return knowledge_graph.get_related_notes(note_id)


@app.get("/api/knowledge-graph/notes/{note_id:path}/entities")
async def get_note_entities(note_id: str):
    """
    Get entities extracted from a specific note.
    Returns list of entities with their type, context, and related relationships.
    """
    return knowledge_graph.get_note_entities(note_id)


@app.post("/api/knowledge-graph/normalize")
async def normalize_entities():
    """
    Run hierarchical entity normalization on all existing entities.
    Finds compound entities and creates specialization_of relationships to root entities.
    """
    return knowledge_graph.run_hierarchical_normalization()


@app.post("/api/knowledge-graph/extract/{conversation_id}")
async def extract_entities(conversation_id: str, background_tasks: BackgroundTasks):
    """
    Extract entities from a conversation's notes.
    Runs in background for large conversations.
    """
    # Run extraction synchronously for immediate feedback
    result = await knowledge_graph.extract_entities_for_conversation(conversation_id)
    return result


@app.post("/api/knowledge-graph/migrate")
async def start_migration(
    background_tasks: BackgroundTasks,
    force: bool = False
):
    """
    Start migration of all existing synthesizer conversations.
    Runs as a background task.
    """
    status = knowledge_graph.get_migration_status()
    if status["running"]:
        raise HTTPException(status_code=409, detail="Migration already running")

    # Start migration in background
    background_tasks.add_task(knowledge_graph.migrate_all_conversations, force_reprocess=force)

    return {"status": "started", "message": "Migration started in background"}


@app.get("/api/knowledge-graph/migrate/status")
async def get_migration_status():
    """Get current migration status."""
    return knowledge_graph.get_migration_status()


@app.post("/api/knowledge-graph/migrate/cancel")
async def cancel_migration():
    """Cancel running migration."""
    return knowledge_graph.cancel_migration()


@app.post("/api/knowledge-graph/rebuild")
async def rebuild_knowledge_graph(background_tasks: BackgroundTasks):
    """
    Rebuild the entire knowledge graph from scratch.
    This re-extracts all entities from all conversations.
    """
    status = knowledge_graph.get_migration_status()
    if status["running"]:
        raise HTTPException(status_code=409, detail="Migration already running")

    # Start full rebuild in background
    background_tasks.add_task(knowledge_graph.migrate_all_conversations, force_reprocess=True)

    return {"status": "started", "message": "Full rebuild started in background"}


@app.post("/api/knowledge-graph/links")
async def create_manual_link(request: ManualLinkRequest):
    """Create a manual link between two nodes."""
    link = knowledge_graph.create_manual_link(
        source=request.source,
        target=request.target,
        label=request.label
    )
    return link


@app.delete("/api/knowledge-graph/links/{link_id}")
async def delete_manual_link(link_id: str):
    """Delete a manual link."""
    success = knowledge_graph.delete_manual_link(link_id)
    if success:
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Link not found")


@app.post("/api/knowledge-graph/links/{link_id}/dismiss")
async def dismiss_suggested_link(link_id: str):
    """Dismiss a suggested link so it won't be suggested again."""
    knowledge_graph.dismiss_link(link_id)
    return {"status": "dismissed"}


# Linkage session endpoints

@app.get("/api/knowledge-graph/linkage")
async def get_linkage_session():
    """Get data for a linkage session including duplicates and stats."""
    return knowledge_graph.get_linkage_session_data()


@app.get("/api/knowledge-graph/linkage/duplicates")
async def get_duplicate_entities(threshold: float = 0.7):
    """Get potential duplicate entities."""
    return knowledge_graph.find_duplicate_entities(threshold)


class MergeEntitiesRequest(BaseModel):
    """Request to merge entities."""
    canonical_id: str
    merge_ids: List[str]


@app.post("/api/knowledge-graph/linkage/merge")
async def merge_entities(request: MergeEntitiesRequest):
    """Merge multiple entities into a canonical one."""
    result = knowledge_graph.merge_entities(request.canonical_id, request.merge_ids)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.post("/api/knowledge-graph/linkage/entities/{entity_id}/review")
async def mark_entity_as_reviewed(entity_id: str):
    """Mark an entity as reviewed."""
    knowledge_graph.mark_entity_reviewed(entity_id)
    return {"status": "reviewed"}


@app.get("/api/knowledge-graph/linkage/suggestions")
async def get_connection_suggestions(limit: int = 10):
    """Get AI-generated connection suggestions between notes."""
    suggestions = await knowledge_graph.get_connection_suggestions(limit=limit)
    return {"suggestions": suggestions}


# Graph RAG Chat endpoints

class GraphRAGChatRequest(BaseModel):
    """Request to chat with the knowledge graph."""
    message: str
    session_id: Optional[str] = None


@app.post("/api/knowledge-graph/chat")
async def chat_with_knowledge_graph(request: GraphRAGChatRequest):
    """
    Chat with the knowledge graph using natural language.
    Returns an answer with citations from relevant notes.
    """
    session_id = request.session_id or str(uuid.uuid4())[:8]

    # Get conversation history
    history = graph_rag.get_chat_history(session_id)

    # Add user message to history (creates session if new)
    graph_rag.add_to_chat_history(session_id, "user", request.message)

    # Query the knowledge graph
    result = await graph_rag.query_knowledge_graph(
        question=request.message,
        conversation_history=history
    )

    # Add assistant response to history with metadata
    graph_rag.add_to_chat_history(
        session_id,
        "assistant",
        result["answer"],
        citations=result.get("citations"),
        follow_ups=result.get("follow_ups"),
        notes_searched=result.get("notes_searched")
    )

    return {
        "session_id": session_id,
        "answer": result["answer"],
        "citations": result["citations"],
        "follow_ups": result["follow_ups"],
        "notes_searched": result["notes_searched"]
    }


@app.get("/api/knowledge-graph/chat/sessions")
async def list_chat_sessions():
    """List all chat sessions with metadata."""
    return {"sessions": graph_rag.list_chat_sessions()}


@app.get("/api/knowledge-graph/chat/{session_id}")
async def get_chat_session(session_id: str):
    """Get full chat session with all messages and metadata."""
    session = graph_rag.get_chat_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/knowledge-graph/chat/{session_id}/history")
async def get_chat_history(session_id: str):
    """Get chat history for a session (simplified format)."""
    history = graph_rag.get_chat_history(session_id)
    return {"session_id": session_id, "messages": history}


@app.delete("/api/knowledge-graph/chat/{session_id}")
async def clear_chat_session(session_id: str):
    """Delete a chat session."""
    graph_rag.clear_chat_session(session_id)
    return {"status": "deleted"}


# =============================================================================
# Knowledge Discovery Endpoints
# =============================================================================

from . import knowledge_discovery


class DiscoveryRequest(BaseModel):
    """Request to start a discovery analysis."""
    prompt: str
    model: Optional[str] = None
    include_web_search: bool = True


@app.post("/api/knowledge-graph/discover")
async def run_discovery(request: DiscoveryRequest, background_tasks: BackgroundTasks):
    """
    Start a discovery analysis with natural language prompt.

    Example prompts:
    - "Find connections between AI and philosophy"
    - "What patterns am I missing in my startup research?"
    """
    result = await knowledge_discovery.run_discovery_analysis(
        prompt=request.prompt,
        model=request.model,
        include_web_search=request.include_web_search
    )
    return result


@app.get("/api/knowledge-graph/discover/status")
async def get_discovery_status():
    """Get current discovery run status."""
    return knowledge_discovery.get_discovery_status()


@app.post("/api/knowledge-graph/discover/cancel")
async def cancel_discovery():
    """Cancel a running discovery."""
    return knowledge_discovery.cancel_discovery()


@app.get("/api/knowledge-graph/discoveries")
async def list_discoveries(status: Optional[str] = None, limit: int = 50):
    """List discoveries with optional status filter."""
    return {"discoveries": knowledge_discovery.list_discoveries(status=status, limit=limit)}


@app.get("/api/knowledge-graph/discoveries/{discovery_id}")
async def get_discovery(discovery_id: str):
    """Get a single discovery by ID."""
    discovery = knowledge_discovery.get_discovery(discovery_id)
    if not discovery:
        raise HTTPException(status_code=404, detail="Discovery not found")
    return discovery


class ApproveDiscoveryRequest(BaseModel):
    """Request to approve a discovery with optional edits."""
    title: Optional[str] = None
    body: Optional[str] = None
    tags: Optional[List[str]] = None


@app.post("/api/knowledge-graph/discoveries/{discovery_id}/approve")
async def approve_discovery(discovery_id: str, request: ApproveDiscoveryRequest = None):
    """Approve a discovery and create the bridge note."""
    edits = None
    if request and (request.title or request.body or request.tags):
        edits = {}
        if request.title:
            edits["title"] = request.title
        if request.body:
            edits["body"] = request.body
        if request.tags:
            edits["tags"] = request.tags

    result = await knowledge_discovery.approve_discovery(discovery_id, edits=edits)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@app.post("/api/knowledge-graph/discoveries/{discovery_id}/dismiss")
async def dismiss_discovery(discovery_id: str):
    """Dismiss a discovery."""
    success = knowledge_discovery.dismiss_discovery(discovery_id)
    if not success:
        raise HTTPException(status_code=404, detail="Discovery not found")
    return {"status": "dismissed"}


@app.delete("/api/knowledge-graph/discoveries/{discovery_id}")
async def delete_discovery(discovery_id: str):
    """Delete a discovery."""
    success = knowledge_discovery.delete_discovery(discovery_id)
    if not success:
        raise HTTPException(status_code=404, detail="Discovery not found")
    return {"status": "deleted"}


@app.get("/api/knowledge-graph/discover/stats")
async def get_discovery_stats():
    """Get discovery statistics."""
    return knowledge_discovery.get_discovery_stats()


class DiscoverySettingsRequest(BaseModel):
    """Request to update discovery settings."""
    discovery_model: Optional[str] = None
    min_notes_for_discovery: Optional[int] = None
    discovery_depth: Optional[str] = None


@app.put("/api/knowledge-graph/discover/settings")
async def update_discovery_settings(request: DiscoverySettingsRequest):
    """Update discovery settings."""
    settings_dict = {}
    if request.discovery_model is not None:
        settings_dict["discovery_model"] = request.discovery_model
    if request.min_notes_for_discovery is not None:
        settings_dict["min_notes_for_discovery"] = request.min_notes_for_discovery
    if request.discovery_depth is not None:
        settings_dict["discovery_depth"] = request.discovery_depth

    return knowledge_discovery.update_discovery_settings(settings_dict)


# =============================================================================
# Knowledge Graph Settings Endpoints
# =============================================================================

@app.get("/api/settings/knowledge-graph")
async def get_knowledge_graph_settings_endpoint():
    """Get all knowledge graph settings."""
    return settings.get_knowledge_graph_settings()


# ---- Model Settings ----

class KGModelsRequest(BaseModel):
    """Request to update knowledge graph models."""
    entity_extraction_model: Optional[str] = None
    discovery_model: Optional[str] = None
    chat_model: Optional[str] = None


@app.put("/api/settings/knowledge-graph/models")
async def set_kg_models_endpoint(request: KGModelsRequest):
    """Update knowledge graph model settings."""
    return settings.set_kg_model_settings(
        entity_extraction_model=request.entity_extraction_model,
        discovery_model=request.discovery_model,
        chat_model=request.chat_model,
    )


# Legacy endpoint for backwards compatibility
class KnowledgeGraphModelRequest(BaseModel):
    """Request to set knowledge graph model."""
    model: str


@app.put("/api/settings/knowledge-graph/model")
async def set_knowledge_graph_model_endpoint(request: KnowledgeGraphModelRequest):
    """Set the entity extraction model (legacy endpoint)."""
    settings.set_knowledge_graph_model(request.model)
    return settings.get_knowledge_graph_settings()


# ---- Entity Extraction Settings ----

class KGEntityExtractionRequest(BaseModel):
    """Request to update entity extraction settings."""
    max_entities: Optional[int] = None
    max_relationships: Optional[int] = None
    similarity_threshold: Optional[float] = None


@app.put("/api/settings/knowledge-graph/entity-extraction")
async def set_kg_entity_extraction_endpoint(request: KGEntityExtractionRequest):
    """Update entity extraction settings."""
    return settings.set_kg_entity_extraction_settings(
        max_entities=request.max_entities,
        max_relationships=request.max_relationships,
        similarity_threshold=request.similarity_threshold,
    )


# ---- Visualization Settings ----

class KGVisualizationRequest(BaseModel):
    """Request to update visualization settings."""
    node_sizes: Optional[Dict[str, float]] = None
    link_widths: Optional[Dict[str, float]] = None
    label_zoom_threshold: Optional[float] = None


@app.put("/api/settings/knowledge-graph/visualization")
async def set_kg_visualization_endpoint(request: KGVisualizationRequest):
    """Update visualization settings."""
    return settings.set_kg_visualization_settings(
        node_sizes=request.node_sizes,
        link_widths=request.link_widths,
        label_zoom_threshold=request.label_zoom_threshold,
    )


# ---- Search Settings ----

class KGSearchRequest(BaseModel):
    """Request to update search settings."""
    debounce_ms: Optional[int] = None
    min_query_length: Optional[int] = None
    results_limit: Optional[int] = None


@app.put("/api/settings/knowledge-graph/search")
async def set_kg_search_endpoint(request: KGSearchRequest):
    """Update search settings."""
    return settings.set_kg_search_settings(
        debounce_ms=request.debounce_ms,
        min_query_length=request.min_query_length,
        results_limit=request.results_limit,
    )


# ---- Chat Settings ----

class KGChatRequest(BaseModel):
    """Request to update chat/RAG settings."""
    context_max_length: Optional[int] = None
    history_limit: Optional[int] = None
    similarity_weight: Optional[float] = None
    mention_weight: Optional[float] = None


@app.put("/api/settings/knowledge-graph/chat")
async def set_kg_chat_endpoint(request: KGChatRequest):
    """Update chat/RAG settings."""
    return settings.set_kg_chat_settings(
        context_max_length=request.context_max_length,
        history_limit=request.history_limit,
        similarity_weight=request.similarity_weight,
        mention_weight=request.mention_weight,
    )


# ---- Sleep Compute Settings ----

class KGSleepComputeRequest(BaseModel):
    """Request to update sleep compute default settings."""
    default_depth: Optional[int] = None
    default_max_notes: Optional[int] = None
    default_turns: Optional[int] = None
    model: Optional[str] = None


@app.put("/api/settings/knowledge-graph/sleep-compute")
async def set_kg_sleep_compute_settings_endpoint(request: KGSleepComputeRequest):
    """Update sleep compute default settings."""
    return settings.set_kg_sleep_compute_settings(
        default_depth=request.default_depth,
        default_max_notes=request.default_max_notes,
        default_turns=request.default_turns,
        model=request.model,
    )


# =============================================================================
# Sleep Time Compute Endpoints
# =============================================================================

from . import sleep_compute
from . import brainstorm_styles


class SleepComputeEntryPoint(BaseModel):
    """Entry point for sleep compute (note or topic)."""
    id: str
    type: str  # "note" or "topic"
    title: str


class SleepComputeStartRequest(BaseModel):
    """Request to start a sleep compute session."""
    prompt: str
    style_id: str
    depth: int = 2
    max_notes: int = 30
    turns: int = 3
    notes_target: int = 10
    model: Optional[str] = None
    entry_points: Optional[List[SleepComputeEntryPoint]] = None


@app.post("/api/knowledge-graph/sleep-compute/start")
async def start_sleep_compute_endpoint(request: SleepComputeStartRequest, background_tasks: BackgroundTasks):
    """
    Start a new sleep compute session.

    Budget parameters:
    - depth: Graph traversal hops (1-3)
    - max_notes: Maximum notes to analyze (10-50)
    - turns: Brainstorming iterations (2-5)
    - notes_target: Target number of bridge notes to generate (5-30)
    - entry_points: Optional list of notes or topics to start from

    Returns immediately with session_id. Computation runs in background.
    """
    entry_points_data = None
    if request.entry_points:
        entry_points_data = [ep.model_dump() for ep in request.entry_points]

    # Create session (synchronous, returns immediately)
    result = sleep_compute.create_sleep_session(
        prompt=request.prompt,
        style_id=request.style_id,
        depth=request.depth,
        max_notes=request.max_notes,
        turns=request.turns,
        notes_target=request.notes_target,
        model=request.model,
        entry_points=entry_points_data
    )

    # If session created successfully, run computation in background
    if "error" not in result and "session_id" in result:
        background_tasks.add_task(sleep_compute.run_sleep_compute, result["session_id"])

    return result


@app.get("/api/knowledge-graph/sleep-compute/status")
async def get_sleep_compute_status():
    """Get current sleep compute session status."""
    return sleep_compute.get_sleep_compute_status()


@app.post("/api/knowledge-graph/sleep-compute/cancel")
async def cancel_sleep_compute():
    """Cancel running sleep compute session."""
    return sleep_compute.cancel_sleep_compute()


@app.post("/api/knowledge-graph/sleep-compute/pause")
async def pause_sleep_compute():
    """Pause running sleep compute session."""
    return sleep_compute.pause_sleep_compute()


@app.post("/api/knowledge-graph/sleep-compute/resume")
async def resume_sleep_compute():
    """Resume paused sleep compute session."""
    return sleep_compute.resume_sleep_compute()


@app.get("/api/knowledge-graph/sleep-compute/session/{session_id}")
async def get_sleep_compute_session(session_id: str):
    """Get full session data by ID."""
    session = sleep_compute.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/knowledge-graph/sleep-compute/sessions")
async def list_sleep_compute_sessions(limit: int = 20):
    """List all sleep compute sessions."""
    return {"sessions": sleep_compute.list_sessions(limit=limit)}


@app.delete("/api/knowledge-graph/sleep-compute/session/{session_id}")
async def delete_sleep_compute_session(session_id: str):
    """Delete a sleep compute session."""
    success = sleep_compute.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}


# =============================================================================
# Brainstorm Styles Endpoints
# =============================================================================

@app.get("/api/brainstorm-styles")
async def list_brainstorm_styles():
    """List all brainstorming styles with enabled/disabled status."""
    return {"styles": brainstorm_styles.list_styles()}


@app.get("/api/brainstorm-styles/{style_id}")
async def get_brainstorm_style(style_id: str):
    """Get a single brainstorming style with prompts."""
    style = brainstorm_styles.get_style(style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")
    return style


class BrainstormStyleUpdateRequest(BaseModel):
    """Request to update a brainstorming style."""
    name: Optional[str] = None
    description: Optional[str] = None
    initial_prompt: Optional[str] = None
    expansion_prompt: Optional[str] = None
    enabled: Optional[bool] = None
    icon: Optional[str] = None


@app.put("/api/brainstorm-styles/{style_id}")
async def update_brainstorm_style(style_id: str, request: BrainstormStyleUpdateRequest):
    """Update a brainstorming style (prompts, enabled status)."""
    updates = {}
    if request.name is not None:
        updates["name"] = request.name
    if request.description is not None:
        updates["description"] = request.description
    if request.initial_prompt is not None:
        updates["initial_prompt"] = request.initial_prompt
    if request.expansion_prompt is not None:
        updates["expansion_prompt"] = request.expansion_prompt
    if request.enabled is not None:
        updates["enabled"] = request.enabled
    if request.icon is not None:
        updates["icon"] = request.icon

    try:
        return brainstorm_styles.update_style(style_id, updates)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/brainstorm-styles/{style_id}/enable")
async def enable_brainstorm_style(style_id: str):
    """Enable a brainstorming style."""
    try:
        return brainstorm_styles.enable_style(style_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/brainstorm-styles/{style_id}/disable")
async def disable_brainstorm_style(style_id: str):
    """Disable a brainstorming style."""
    try:
        return brainstorm_styles.disable_style(style_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Sleep Time Compute Settings Endpoints
# =============================================================================

@app.get("/api/settings/sleep-compute")
async def get_sleep_compute_settings_endpoint():
    """Get sleep compute default settings."""
    return sleep_compute.get_sleep_compute_settings()


class SleepComputeSettingsRequest(BaseModel):
    """Request to update sleep compute settings."""
    default_depth: Optional[int] = None
    default_max_notes: Optional[int] = None
    default_turns: Optional[int] = None
    model: Optional[str] = None


@app.put("/api/settings/sleep-compute")
async def update_sleep_compute_settings_endpoint(request: SleepComputeSettingsRequest):
    """Update sleep compute default settings."""
    updates = {}
    if request.default_depth is not None:
        updates["default_depth"] = request.default_depth
    if request.default_max_notes is not None:
        updates["default_max_notes"] = request.default_max_notes
    if request.default_turns is not None:
        updates["default_turns"] = request.default_turns
    if request.model is not None:
        updates["model"] = request.model

    return sleep_compute.update_sleep_compute_settings(updates)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
