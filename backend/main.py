"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio

from . import storage, config, prompts, threads, settings, content, synthesizer
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings

app = FastAPI(title="LLM Council API")

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


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int
    mode: str = "council"


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]
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

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

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
    """Request to create a comment."""
    message_index: int
    stage: int
    model: str
    selection: str
    content: str
    source_content: Optional[str] = None


@app.post("/api/conversations/{conversation_id}/comments")
async def create_comment(conversation_id: str, request: CreateCommentRequest):
    """Create a new comment on a specific part of a response."""
    try:
        comment_id = str(uuid.uuid4())
        comment = storage.add_comment(
            conversation_id,
            comment_id,
            request.message_index,
            request.stage,
            request.model,
            request.selection,
            request.content,
            request.source_content
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
    message_index: int
    stage: int
    model: str
    label: Optional[str] = None
    content: str


class CreateThreadRequest(BaseModel):
    """Request to create a follow-up thread."""
    model: str
    comment_ids: List[str]
    question: str
    message_index: int
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
        segment_payload = [segment.dict() for segment in request.context_segments]

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
            "message_index": request.message_index,
            "comment_ids": request.comment_ids,
            "context_segments": segment_payload
        }
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
async def list_prompts():
    """List all available system prompts."""
    return prompts.list_prompts()


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
async def create_prompt(request: CreatePromptRequest):
    """Create a new prompt file."""
    try:
        return prompts.create_prompt(request.title, request.content)
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


# Settings Management Endpoints

@app.get("/api/settings")
async def get_settings():
    """Get current settings status (not the actual API key value for security)."""
    return {
        "api_key_configured": settings.has_api_key_configured(),
        "api_key_source": settings.get_api_key_source(),
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
        content_result["content"][:500] if content_result["content"] else "",
        content_result["source_type"],
        request.url,
        result.get("model"),
        content_result.get("title")
    )

    # Update title if first message and we have a title from content
    if is_first_message and content_result.get("title"):
        storage.update_conversation_title(conversation_id, content_result["title"][:100])

    return {
        "notes": result["notes"],
        "source_type": content_result["source_type"],
        "source_title": content_result.get("title"),
        "model": result.get("model")
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
