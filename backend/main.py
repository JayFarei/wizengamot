"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio

from . import storage, config, prompts
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


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    council_config: Optional[CouncilConfig] = None
    system_prompt: Optional[str] = None


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]
    system_prompt: Optional[str] = None
    prompt_title: Optional[str] = None


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/config")
async def get_config():
    """Get the current council configuration."""
    return {
        "council_models": config.COUNCIL_MODELS,
        "chairman_model": config.CHAIRMAN_MODEL,
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

    conversation = storage.create_conversation(conversation_id, council_config, request.system_prompt)
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
