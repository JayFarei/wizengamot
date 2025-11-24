# LLM Council

![llmcouncil](header.jpg)

The idea of this repo is that instead of asking a question to your favorite LLM provider (e.g. OpenAI GPT 5.1, Google Gemini 3.0 Pro, Anthropic Claude Sonnet 4.5, xAI Grok 4, eg.c), you can group them into your "LLM Council". This repo is a simple, local web app that essentially looks like ChatGPT except it uses OpenRouter to send your query to multiple LLMs, it then asks them to review and rank each other's work, and finally a Chairman LLM produces the final response.

In a bit more detail, here is what happens when you submit a query:

1. **Stage 1: First opinions**. The user query is given to all LLMs individually, and the responses are collected. The individual responses are shown in a "tab view", so that the user can inspect them all one by one.
2. **Stage 2: Review**. Each individual LLM is given the responses of the other LLMs. Under the hood, the LLM identities are anonymized so that the LLM can't play favorites when judging their outputs. The LLM is asked to rank them in accuracy and insight.
3. **Stage 3: Final response**. The designated Chairman of the LLM Council takes all of the model's responses and compiles them into a single final answer that is presented to the user.

## Annotate Responses & Start Follow-ups

The UI now supports inline annotations and targeted follow-up conversations with any councilor or the chairman. All feedback is saved inside each conversation JSON file (`comments` and `threads` arrays) so you can resume where you left off.

### Add Inline Comments

1. Highlight any span of text inside Stage 1, 2, or 3 responses. The app captures the stage, model, and message index automatically.
2. The comment modal shows the selected quote plus context badges; write your note and save (Cmd/Ctrl+Enter works too).
3. Saved comments render as yellow highlights with floating tooltips. Hover to preview, click to pin/edit/delete, and use the `Review` badge in the corner to jump back to a specific annotation.

### Curate Review Context

- Click the `Annotate` button (or the auto-opening sidebar after your first note) to open the **Review Context** sidebar.
- Triage annotations in one place: reorder mentally, inline edit/correct them, delete stale ones, and optionally expand the context preview to see original source snippets.
- Each card tracks `[Stage, Model]`, the highlighted text, and your comment so you can sanity-check what will be sent downstream.

### Start Targeted Follow-ups

1. From the sidebar, pick the model you want to interrogate (defaults to the configured chairman, but you can choose any council member that ran during the conversation).
2. Draft a follow-up prompt that references your annotations. When you click **Start Conversation**, the client hits the new thread endpoint and bundles every comment ID plus your question.
3. The backend compiles those highlights into a context block (`backend/threads.py`) and queries the selected OpenRouter model. The exchange shows up inline as a `Follow-up` user/assistant pair beneath the original run so the entire conversation stays chronological.
4. You can continue a thread later via the `/api/conversations/{conversation_id}/threads/{thread_id}/message` endpoint if you want to keep drilling down on the same reviewer.

### REST Endpoints

The FastAPI app now exposes dedicated comment and thread routes so other tooling (CLI scripts, notebooks, etc.) can automate review workflows:

- `POST /api/conversations/{id}/comments` - create an annotation (stage, model, selection, comment body, optional source content).
- `GET /api/conversations/{id}/comments` - list all comments or filter by `?message_index=`.
- `PUT /api/conversations/{id}/comments/{comment_id}` / `DELETE ...` - edit or remove annotations.
- `POST /api/conversations/{id}/threads` - spin up a follow-up session for a specific model using a list of comment IDs.
- `GET /api/conversations/{id}/threads/{thread_id}` - fetch the persisted thread, including the stored context metadata.
- `POST /api/conversations/{id}/threads/{thread_id}/message` - continue an existing follow-up with additional questions.

Any follow-up message automatically lands back in the conversation JSON (`threads` plus synthetic `follow-up-*` messages) so the React client can render it immediately.

## Vibe Code Alert

This project was 99% vibe coded as a fun Saturday hack because I wanted to explore and evaluate a number of LLMs side by side in the process of [reading books together with LLMs](https://x.com/karpathy/status/1990577951671509438). It's nice and useful to see multiple responses side by side, and also the cross-opinions of all LLMs on each other's outputs. I'm not going to support it in any way, it's provided here as is for other people's inspiration and I don't intend to improve it. Code is ephemeral now and libraries are over, ask your LLM to change it in whatever way you like.

## Setup

### 1. Install Dependencies

The project uses [uv](https://docs.astral.sh/uv/) for project management.

**Backend:**
```bash
uv sync
```

**Frontend:**
```bash
cd frontend
npm install
cd ..
```

### 2. Configure API Key

Create a `.env` file in the project root:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Get your API key at [openrouter.ai](https://openrouter.ai/). Make sure to purchase the credits you need, or sign up for automatic top up.

### 3. Configure Models (Optional)

Edit `backend/config.py` to customize the council:

```python
COUNCIL_MODELS = [
    "openai/gpt-5.1",
    "google/gemini-3-pro-preview",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-4",
]

CHAIRMAN_MODEL = "google/gemini-3-pro-preview"
```

## Running the Application

**Option 1: Use the start script**
```bash
./start.sh
```

**Option 2: Run manually**

Terminal 1 (Backend):
```bash
uv run python -m backend.main
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
```

Then open http://localhost:5173 in your browser.

## Tech Stack

- **Backend:** FastAPI (Python 3.10+), async httpx, OpenRouter API
- **Frontend:** React + Vite, react-markdown for rendering
- **Storage:** JSON files in `data/conversations/`
- **Package Management:** uv for Python, npm for JavaScript
