"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio

from . import storage, config, prompts, threads, settings, content, synthesizer, search, tweet, monitors, monitor_chat, monitor_crawler, monitor_scheduler, monitor_updates, monitor_digest, question_sets, visualiser
from .council import run_full_council, generate_conversation_title, generate_synthesizer_title, generate_visualiser_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings

app = FastAPI(title="LLM Council API")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Start background tasks on app startup."""
    # Start the monitor scheduler
    monitor_scheduler.start_scheduler()


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on app shutdown."""
    monitor_scheduler.stop_scheduler()


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


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


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
    features_path = Path("FEATURES.md")
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
    deleted = storage.delete_conversation(conversation_id)
    if not deleted:
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

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


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

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(request.content, stage1_results, council_models)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(request.content, stage1_results, stage2_results, chairman_model)
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        finally:
            # Save in finally block - ensures save even if client disconnects
            if stage1_results and stage2_results and stage3_result:
                storage.add_assistant_message(
                    conversation_id,
                    stage1_results,
                    stage2_results,
                    stage3_result
                )

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
        # Get the conversation and thread
        conversation = storage.get_conversation(conversation_id)
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


# Prompt Management Endpoints

@app.get("/api/prompts")
async def list_prompts_endpoint():
    """List all available system prompts with their labels."""
    return await prompts.list_prompts_with_labels()


@app.get("/api/prompts/labels")
async def get_prompt_labels():
    """Get mapping of prompt titles to labels."""
    return prompts.get_labels_mapping()


@app.get("/api/prompts/{filename}")
async def get_prompt(filename: str):
    """Get a specific prompt by filename."""
    prompt = prompts.get_prompt(filename)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


class CreatePromptRequest(BaseModel):
    """Request to create a new prompt."""
    title: str
    content: str


@app.post("/api/prompts")
async def create_prompt_endpoint(request: CreatePromptRequest):
    """Create a new prompt file with auto-generated label."""
    try:
        return await prompts.create_prompt_with_label(request.title, request.content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class UpdatePromptRequest(BaseModel):
    """Request to update an existing prompt."""
    content: str


@app.put("/api/prompts/{filename}")
async def update_prompt(filename: str, request: UpdatePromptRequest):
    """Update an existing prompt file."""
    try:
        return prompts.update_prompt(filename, request.content)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/prompts/{filename}")
async def delete_prompt(filename: str):
    """Delete a prompt file."""
    try:
        prompts.delete_prompt(filename)
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
    """Request to process a URL in synthesizer mode."""
    url: str
    comment: Optional[str] = None
    model: Optional[str] = None
    use_council: bool = False


@app.post("/api/conversations/{conversation_id}/synthesize")
async def synthesize_from_url(conversation_id: str, request: SynthesizeRequest):
    """
    Process a URL and generate Zettelkasten notes.
    """
    # Verify conversation exists and is synthesizer mode
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation.get("mode") != "synthesizer":
        raise HTTPException(status_code=400, detail="Conversation is not in synthesizer mode")

    # Check if this is the first message (for title generation)
    is_first_message = len(conversation.get("messages", [])) == 0

    # Add user message
    storage.add_synthesizer_user_message(conversation_id, request.url, request.comment)

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

    if request.use_council:
        result = await synthesizer.generate_zettels_council(
            content_result["content"],
            system_prompt,
            user_comment=request.comment
        )
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

    # Generate title from notes if first message
    generated_title = None
    if is_first_message and result.get("notes"):
        generated_title = await generate_synthesizer_title(result["notes"])
        storage.update_conversation_title(conversation_id, generated_title)

    return {
        "notes": result["notes"],
        "source_type": content_result["source_type"],
        "source_title": content_result.get("title"),
        "model": result.get("model"),
        "conversation_title": generated_title
    }


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


@app.get("/api/settings/synthesizer")
async def get_synthesizer_settings():
    """Get synthesizer-specific settings."""
    return {
        "firecrawl_configured": settings.has_firecrawl_configured(),
        "firecrawl_source": settings.get_firecrawl_source(),
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
    available_styles = settings.get_diagram_styles()
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
        request.model
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

    # Generate title if first message
    generated_title = None
    if is_first_message:
        generated_title = await generate_visualiser_title(source_content)
        storage.update_conversation_title(conversation_id, generated_title)

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
    styles = settings.get_diagram_styles()
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
    return settings.get_diagram_styles()


@app.get("/api/settings/visualiser/styles/{style_id}")
async def get_diagram_style_endpoint(style_id: str):
    """Get a specific diagram style."""
    style = settings.get_diagram_style(style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")
    return {"id": style_id, **style}


class CreateDiagramStyleRequest(BaseModel):
    """Request to create a new diagram style."""
    id: str
    name: str
    description: str
    prompt: str


@app.post("/api/settings/visualiser/styles")
async def create_diagram_style_endpoint(request: CreateDiagramStyleRequest):
    """Create a new diagram style."""
    # Validate ID format (alphanumeric and underscores only)
    if not request.id or not all(c.isalnum() or c == '_' for c in request.id):
        raise HTTPException(status_code=400, detail="Style ID must contain only letters, numbers, and underscores")

    success = settings.create_diagram_style(
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


class UpdateDiagramStyleRequest(BaseModel):
    """Request to update a diagram style."""
    name: str
    description: str
    prompt: str


@app.put("/api/settings/visualiser/styles/{style_id}")
async def update_diagram_style_endpoint(style_id: str, request: UpdateDiagramStyleRequest):
    """Update an existing diagram style."""
    # Check if style exists
    existing = settings.get_diagram_style(style_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Style not found")

    settings.update_diagram_style(
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


@app.delete("/api/settings/visualiser/styles/{style_id}")
async def delete_diagram_style_endpoint(style_id: str):
    """Delete a diagram style."""
    success = settings.delete_diagram_style(style_id)
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
