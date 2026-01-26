# Repository Guidelines

This file provides guidance to coding agents working in this repository.

## Project Overview
Wizengamot is a multi-LLM deliberation system where multiple models collaborate via OpenRouter. Stage 2 uses anonymized peer review to reduce model bias.

Five modes:
- Council: multi-model deliberation with peer ranking (Stage 1 -> Stage 2 -> Stage 3).
- Synthesizer: transform URLs (YouTube, podcasts, articles, PDFs) into Zettelkasten notes.
- Monitor: track entities/competitors across multiple sources with scheduled analysis.
- Visualiser: generate diagrams and flowcharts from content using AI image generation.
- Podcast: generate live audio explanations of Synthesizer notes via LiveKit + xAI real-time voice.

## Project Structure & Module Organization
- `backend/`: FastAPI app, council orchestration, monitors, synthesizer, visualiser, podcast, and JSON storage helpers.
- `frontend/`: Vite + React client; shared UI in `src/components/`, entry glue in `src/App.jsx`, styles colocated.
- `prompts/`: System prompts per mode; monitor question sets live in `prompts/monitor/`.
- `data/`: Runtime storage (git-ignored); includes `conversations/`, `config/settings.json`, `monitors/`, `images/`, `podcasts/`, `search_index.pkl`.
- `scripts/`: Dependency checks, migrations, deploy/backup utilities, model setup.
- `docker/`, `Dockerfile`, `docker-compose.yml`: Containerized build + nginx/supervisord setup.
- `tests/` and `backend/tests/`: pytest-based smoke/e2e tests.

## Development Commands

### Backend (Python/FastAPI)
- `uv sync` - install/update backend dependencies whenever `pyproject.toml` changes.
- `uv run python -m backend.main` - serve the API on `localhost:8001`.
- `uv run pytest tests/` - run all backend tests.
- `uv run pytest backend/tests/` - run backend-specific tests.
- `uv run pytest backend/tests/test_monitor_e2e.py` - run specific test file.
- `uv run pytest backend/tests/test_monitor_e2e.py::test_crawl_competitor -v` - run single test function.
- `uv run pytest backend/tests/test_monitor_e2e.py -k "crawl" -v` - run tests matching pattern.
- `uv run pytest --tb=short` - run tests with shorter traceback format.

### Frontend (React/Vite)
- `cd frontend && npm install` - install frontend dependencies.
- `cd frontend && npm run dev` - start Vite dev server on `localhost:5173`.
- `cd frontend && npm run build` - build production bundle.
- `cd frontend && npm run preview` - serve production build locally.
- `cd frontend && npm run lint` - run ESLint code quality checks.

### Full Stack Development
- `./start.sh` - boot both backend and frontend; runs `scripts/check-deps.sh` unless `--skip-checks`.
- `./start.sh --skip-checks` - start without dependency validation.
- `./scripts/check-deps.sh` - validate Python/Node/ffmpeg, `.env`, and local deps.
- `./scripts/setup-models.sh` - pre-download Whisper and fastembed models for ML features.

### Docker Deployment
- `docker compose build` - build image.
- `docker compose up -d` - Docker dev/prod flow (nginx on 8080).
- `docker compose up --build` - rebuild and start containers.
- `./scripts/deploy.sh` - full deployment (pull, backup, migrate, rebuild).
- `./scripts/backup.sh` - backup conversation data.

### Dependency Management
- `uv sync` - install Python dependencies (equivalent to pip install).
- `cd frontend && npm install` - install Node.js dependencies.
- `uv lock` - update lockfile after dependency changes.
- `uv run pip list` - list installed Python packages.

## Backend Architecture (backend/)
- `config.py`: dynamic model configuration via `get_council_models`, `get_chairman_model`, and `get_model_pool`. Uses `OPENROUTER_API_KEY`. Dev backend runs on 8001; Docker uses nginx on 80/8080.
- `settings.py`: runtime settings in `data/config/settings.json`; priority settings file > env > defaults.
- `prompts.py`: CRUD operations for system prompts in `prompts/` with titles derived from the first heading.
- `threads.py`: follow-up conversations with comment context and pinned segments.
- `openrouter.py`: `query_model` and `query_models_parallel`; returns content and optional `reasoning_details`; continues on partial failures.
- `council.py`: Stage 1/2/3 flow, anonymized peer review, ranking parsing, aggregate ranking calculation.
- `storage.py`: JSON conversation storage in `data/conversations/`; assistant messages contain stage1/2/3; metadata is not persisted.
- `main.py`: FastAPI app with CORS for localhost origins; endpoints for conversations, streaming, settings, prompts, comments, threads, search.
- `search.py`: semantic search using fastembed (`BAAI/bge-small-en-v1.5`); index in `data/search_index.pkl`; scoring mixes semantic similarity and recency.
- `monitors.py` and `monitor_*.py`: monitor CRUD, crawl, analysis, scheduling, updates, digests, chat.
- `question_sets.py`: question sets stored in `prompts/monitor/` with optional output schema.
- `visualiser.py`: diagram generation via OpenRouter; images in `data/images/`.
- `podcast*.py`: podcast sessions, storage, and LiveKit agent; audio in `data/podcasts/`.
- `content.py`: content extraction from URLs with Firecrawl.
- `workers/`: YouTube and podcast transcription helpers.

## Frontend Structure (frontend/src/)
- `App.jsx`: main orchestration for conversations and metadata.
- `api.js`: API client with dev/prod base URL switching and SSE support.
- `components/Stage1.jsx`, `components/Stage2.jsx`, `components/Stage3.jsx`: stage views; Stage 2 shows raw evaluations and parsed rankings with client-side de-anonymization.
- `components/ResponseWithComments.jsx` and related comment components: highlight, popup, and thread context.
- `components/PromptSelector.jsx`, `components/PromptEditor.jsx`, `components/PromptManager.jsx`: system prompt management UI.
- `components/SettingsModal.jsx` and `components/ConfigModal.jsx`: settings and model configuration.
- `components/SearchModal.jsx` and `components/ModeSelector.jsx`: search and mode selection.
- Mode interfaces: `SynthesizerInterface.jsx`, `MonitorInterface.jsx`, `VisualiserInterface.jsx`, `PodcastInterface.jsx`.
- `contexts/ThemeContext.jsx`: theme toggle; `utils/` for helpers.

## Key Design Decisions and Gotchas
- Stage 2 prompt format is strict; keep the "FINAL RANKING" section clean for reliable parsing.
- Responses are anonymized as Response A/B/C for ranking, then de-anonymized in the UI for display.
- Metadata (label mapping, aggregate rankings) is returned via API but not persisted to storage.
- Always run backend as `python -m backend.main` from project root to avoid import issues.
- ReactMarkdown output must be wrapped in `.markdown-content` for spacing.
- Model failures should degrade gracefully; do not fail the entire request if some models error.
- Ports: dev backend 8001, dev frontend 5173; Docker uses nginx on 8080 externally.

## Data Flow Summary
User -> Stage 1 (parallel responses) -> Stage 2 (anonymize and rank) -> aggregate rankings -> Stage 3 (chairman synthesis) -> API returns stages plus metadata -> frontend renders tabs and rankings.

## Docker Deployment
- Multi-stage Dockerfile: Node build stage -> Python+nginx final image.
- supervisord runs nginx and uvicorn; nginx serves frontend and proxies `/api`.
- Volumes: conversations (`/app/data/conversations`), prompts (`/app/prompts`), config (`/app/data/config`).

## Code Style & Naming Conventions

### Python Backend
- **Indentation**: 4 spaces, no tabs.
- **Imports**: Organize alphabetically by group (standard library, third-party, local):
  ```python
  import json
  import os
  from pathlib import Path
  from typing import Dict, List, Optional

  import httpx
  import pydantic
  from fastapi import FastAPI, HTTPException

  from . import storage, config
  from .council import run_full_council
  ```
- **Type Hints**: Use comprehensive type hints for all function parameters and return values:
  ```python
  def process_conversation(conversation_id: str, user_input: str) -> Dict[str, Any]:
      """Process user input for a conversation."""
  ```
- **Docstrings**: Concise module docstrings; function docstrings only when complex:
  ```python
  """FastAPI backend for LLM Council."""
  ```
- **Relative Imports**: Always use relative imports (`from . import module`) when running as module.
- **Error Handling**: Use specific exception types, provide meaningful error messages:
  ```python
  try:
      result = await openrouter.query_model(model, messages)
  except Exception as e:
      raise HTTPException(status_code=500, detail=f"Model query failed: {str(e)}")
  ```
- **Naming**: snake_case for functions/variables, PascalCase for classes, UPPER_CASE for constants.
- **Pydantic Models**: Prefer extending existing models over hand validation; use Field for defaults:
  ```python
  class ConversationRequest(BaseModel):
      content: str = Field(..., description="User message content")
      mode: str = Field(default="council", description="Conversation mode")
  ```

### React Frontend
- **Component Naming**: PascalCase for component files and functions:
  ```jsx
  export default function ActionMenu({ children, className = "" }) {
    return <div className={className}>{children}</div>;
  }
  ```
- **Hooks/Utilities**: camelCase for hook files and functions:
  ```javascript
  export function useLocalStorage(key, initialValue) {
    const [value, setValue] = useState(initialValue);
    return [value, setValue];
  }
  ```
- **CSS**: Colocate CSS files beside JSX components (`ActionMenu.css`).
- **Props**: Destructure props at function signature:
  ```jsx
  function ConversationCard({ id, title, messageCount, onDelete }) {
    return <div>{title}</div>;
  }
  ```
- **State Management**: Use useState for local state, prefer functional updates:
  ```javascript
  const [isLoading, setIsLoading] = useState(false);
  setIsLoading((prev) => !prev);
  ```
- **Event Handlers**: Prefix with "handle" and use arrow functions:
  ```javascript
  const handleSubmit = async (e) => {
    e.preventDefault();
  };
  ```
- **ESLint**: Follows `frontend/eslint.config.js` rules; no unused variables (except A-Z_ pattern).

### General Code Style
- **No Comments**: DO NOT add any comments unless explicitly requested.
- **File Naming**: Consistent naming - `conversation.py`, `ActionMenu.jsx`, `ActionMenu.css`.
- **Constants**: UPPER_CASE for module-level constants:
  ```python
  VERSION_CACHE_TTL = 15 * 60
  ```
- **Magic Numbers**: Extract to named constants.
- **Error Messages**: User-friendly, actionable error messages.
- **Security**: Never log or expose API keys, secrets, or sensitive data.

## Testing Guidelines

### Backend Testing (pytest)
- **Test Structure**: Tests in `tests/backend/` or `backend/tests/` for e2e/smoke tests.
- **Test Naming**: Name after behaviors (`test_stage3_summary.py`, `test_crawl_competitor.py`).
- **Test Fixtures**: Large fixtures in `data/` rather than inline.
- **Manual Testing**: `./start.sh`, submit prompts, verify JSON files in `data/conversations/`.
- **Coverage**: No full coverage yet; add tests for new features.
- **TestClient**: Use FastAPI TestClient for API endpoint testing.

### Frontend Testing (React Testing Library)
- **Test Location**: Tests in `frontend/src/__tests__/` directory.
- **Test Naming**: ComponentName.spec.jsx or ComponentName.test.jsx.
- **Testing Approach**: Focus on user interactions, not implementation details.
- **Mocking**: Mock API calls and external dependencies.

### Running Tests
- **All Tests**: `uv run pytest` or `uv run pytest tests/`
- **Backend Only**: `uv run pytest backend/tests/`
- **Frontend Only**: `cd frontend && npm run test`
- **Single Test**: `uv run pytest backend/tests/test_monitor_e2e.py::test_crawl_competitor -v`
- **With Coverage**: `uv run pytest --cov=backend --cov-report=html`

## Commit & Pull Request Guidelines

### Commit Messages
- **Format**: Short, imperative subjects (<50 chars); explain details in body if needed.
- **Examples**:
  - "add dark mode toggle component"
  - "fix council ranking calculation bug"
  - "update synthesizer prompt templates"
- **Security**: Never commit `.env` files, API keys, or sensitive data.
- **References**: Reference issues explicitly when relevant.

### Pull Requests
- **Description**: Crisp summary plus screenshots/clips for UI changes.
- **Testing**: Include commands run, config/env impacts explicitly.
- **Review**: Ensure CI passes, dependencies updated, no secrets committed.

## Security & Configuration Tips

### API Keys & Secrets
- **OpenRouter**: Required; set in `.env` as `OPENROUTER_API_KEY` or via UI.
- **Firecrawl**: Optional for synthesizer; set as `FIRECRAWL_API_KEY`.
- **LiveKit**: Optional for real-time features; set as `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- **XAI**: Optional alternative provider; set as `XAI_API_KEY`.
- **Priority**: Settings file > environment variables > defaults.

### Configuration Management
- **Runtime Settings**: Live in `data/config/settings.json`; take precedence over env.
- **Model Selection**: Update via Settings UI only after confirming OpenRouter support.
- **Data Scrubbing**: Remove sensitive prompts/model critiques from `data/conversations/` before publishing.

### Security Best Practices
- **Input Validation**: Use Pydantic models for API inputs; validate all user data.
- **Error Handling**: Never expose internal errors or stack traces to users.
- **File Permissions**: Ensure proper permissions on config/data directories.
- **Network Security**: Validate URLs, implement rate limiting for external APIs.
