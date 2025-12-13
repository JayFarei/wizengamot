# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies (from project root)
uv sync                          # Backend Python dependencies
cd frontend && npm install       # Frontend JS dependencies

# Run the application
./start.sh                       # Start both backend and frontend
# OR manually:
uv run python -m backend.main    # Backend on port 8001
cd frontend && npm run dev       # Frontend on port 5173

# Run tests
uv run pytest tests/             # Run all tests from project root
uv run pytest backend/tests/     # Backend-specific tests

# Frontend commands
cd frontend && npm run build     # Production build
cd frontend && npm run lint      # ESLint

# Docker deployment
docker compose build             # Build image
docker compose up -d             # Run container on port 8080
./scripts/deploy.sh              # Full deployment (pull, backup, migrate, rebuild)
./scripts/backup.sh              # Backup conversation data
```

## Project Overview

Wizengamot is a multi-LLM deliberation system where multiple models collaboratively answer questions via OpenRouter. The key innovation is anonymized peer review in Stage 2, preventing models from playing favorites.

**Four Modes:**
- **Council**: Multi-model deliberation with peer ranking (Stage 1 → Stage 2 → Stage 3)
- **Synthesizer**: Transform URLs (YouTube, podcasts, articles, PDFs) into Zettelkasten notes
- **Monitor**: Track entities/competitors across multiple sources with scheduled analysis
- **Visualiser**: Generate diagrams and flowcharts from content using AI image generation

## Architecture

### Backend Structure (`backend/`)

**`config.py`**
- Dynamic model configuration via functions: `get_council_models()`, `get_chairman_model()`, `get_model_pool()`
- Uses environment variable `OPENROUTER_API_KEY` from `.env`
- Backend runs on **port 8001** in development (Docker uses nginx on port 80/8080)

**`settings.py`**
- Runtime settings management (allows updates without restart)
- Settings stored in `data/config/settings.json`
- Manages: API key, model pool, council models, chairman model, default prompt
- Priority: settings file > environment variable > defaults
- Functions: `get_model_pool()`, `get_council_models()`, `get_chairman_model()`, `get_default_prompt()`

**`prompts.py`**
- System prompts stored as markdown files in `prompts/` directory
- Title extracted from first `# heading` in markdown
- CRUD operations: `list_prompts()`, `get_prompt()`, `create_prompt()`, `update_prompt()`, `delete_prompt()`

**`threads.py`**
- Follow-up conversations with specific council members
- `compile_context_from_comments()`: Builds context from highlighted comments and pinned segments
- `query_with_context()`: Single query with comment context
- `continue_thread()`: Continue existing thread conversation

**`openrouter.py`**
- `query_model()`: Single async model query
- `query_models_parallel()`: Parallel queries using `asyncio.gather()`
- Returns dict with 'content' and optional 'reasoning_details'
- Graceful degradation: returns None on failure, continues with successful responses

**`council.py`** - The Core Logic
- `stage1_collect_responses()`: Parallel queries to all council models
- `stage2_collect_rankings()`:
  - Anonymizes responses as "Response A, B, C, etc."
  - Creates `label_to_model` mapping for de-anonymization
  - Prompts models to evaluate and rank (with strict format requirements)
  - Returns tuple: (rankings_list, label_to_model_dict)
  - Each ranking includes both raw text and `parsed_ranking` list
- `stage3_synthesize_final()`: Chairman synthesizes from all responses + rankings
- `parse_ranking_from_text()`: Extracts "FINAL RANKING:" section, handles both numbered lists and plain format
- `calculate_aggregate_rankings()`: Computes average rank position across all peer evaluations

**`storage.py`**
- JSON-based conversation storage in `data/conversations/`
- Each conversation: `{id, created_at, messages[]}`
- Assistant messages contain: `{role, stage1, stage2, stage3}`
- Note: metadata (label_to_model, aggregate_rankings) is NOT persisted to storage, only returned via API

**`main.py`**
- FastAPI app with CORS enabled for localhost:5173 and localhost:3000
- POST `/api/conversations/{id}/message` returns metadata in addition to stages
- POST `/api/conversations/{id}/message/stream` for SSE streaming responses
- DELETE `/api/conversations/{id}` deletes a conversation
- Metadata includes: label_to_model mapping and aggregate_rankings
- Settings endpoints: `/api/settings/models`, `/api/settings/model-pool`, `/api/settings/council-models`, `/api/settings/chairman`, `/api/settings/default-prompt`
- Additional endpoints: `/api/prompts`, `/api/settings`, `/api/conversations/{id}/comments`, `/api/conversations/{id}/threads`
- GET `/api/search?q=<query>&limit=<n>` for semantic search across conversations

**`search.py`**
- Semantic search using fastembed (ONNX-based local embeddings)
- Model: `BAAI/bge-small-en-v1.5` (384 dimensions, ~50MB)
- Index stored in `data/search_index.pkl` (single pickle file)
- Lazy indexing: builds on first search, caches in memory
- Scoring: 70% semantic similarity + 30% recency (30-day half-life decay)
- Extracts searchable content: titles, user messages, stage1/stage3 responses, synthesizer notes

**Monitor System (`monitor_*.py`, `monitors.py`)**
- `monitors.py`: CRUD operations for monitor configurations, stored as JSON in `data/monitors/`
- `monitor_crawler.py`: Web crawling using Firecrawl API for content extraction
- `monitor_analysis.py`: LLM-based analysis of crawled content against question sets
- `monitor_scheduler.py`: APScheduler-based cron scheduling for automated monitoring
- `monitor_updates.py`: Track and store updates/changes detected by monitors
- `monitor_digest.py`: Generate periodic digest summaries of monitor findings
- `monitor_chat.py`: Conversational interface for querying monitor data

**`question_sets.py`**
- Manages reusable question sets for monitor analysis
- Stored as markdown files in `question_sets/` directory
- Format: `# Title`, description, `## Questions` with `- key: question` items
- Optional `## Output Schema` section for structured responses

**`visualiser.py`**
- Generates diagrams from content using AI image generation via OpenRouter
- Supports multiple styles: bento, whiteboard, system_diagram, napkin, cheatsheet, cartoon
- Images stored in `data/images/`

**`content.py`**
- Content extraction from various URL types (YouTube, podcasts, PDFs, web pages)
- Integrates with Firecrawl for web scraping

**`tweet.py`**
- Tweet generation from synthesized notes for sharing insights

**`workers/`**
- `youtube.py`: YouTube transcript extraction using yt-dlp
- `podcast.py`: Podcast/audio transcription using Whisper

### Frontend Structure (`frontend/src/`)

**`App.jsx`**
- Main orchestration: manages conversations list and current conversation
- Handles message sending and metadata storage
- Important: metadata is stored in the UI state for display but not persisted to backend JSON
- Manages context stack (pinned segments) for follow-up threads
- Global keyboard shortcut: **Cmd+K** opens search modal

**`api.js`**
- API client with automatic base URL switching (localhost:8001 in dev, relative URLs in Docker)
- Includes `sendMessageStream()` for SSE streaming
- Full CRUD for prompts, comments, threads, and settings

**`components/ChatInterface.jsx`**
- Multiline textarea (3 rows, resizable)
- Enter to send, Shift+Enter for new line
- User messages wrapped in markdown-content class for padding

**`components/Stage1.jsx`**
- Tab view of individual model responses
- Uses ResponseWithComments for inline highlights and popups

**`components/Stage2.jsx`**
- **Critical Feature**: Tab view showing RAW evaluation text from each model
- De-anonymization happens CLIENT-SIDE for display (models receive anonymous labels)
- Shows "Extracted Ranking" below each evaluation so users can validate parsing
- Aggregate rankings shown with average position and vote count
- Explanatory text clarifies that boldface model names are for readability only
- Uses ResponseWithComments for inline highlights and popups

**`components/Stage3.jsx`**
- Final synthesized answer from chairman
- Green-tinted background (#f0fff0) to highlight conclusion
- Uses ResponseWithComments for inline highlights and popups

**Comment & Context System Components**
- **`ResponseWithComments.jsx`**: Wrapper that applies inline highlights and manages hover popups
- **`HighlightPopup.jsx`**: Responsive popup that appears next to highlighted text, shows comment content and delete button
- **`CommentModal.jsx`**: Modal for adding new comments to selected text
- **`CommitModal.jsx`**: Enhanced modal showing full context (highlighted text + comments + metadata) when starting follow-up threads
- **`CommitSidebar.jsx`**: Review Context sidebar for managing annotations and context stack
- **`AddToContextButton.jsx`**: Stack button on each Stage panel to pin entire responses
- **`ThreadView.jsx`**: Component for continuing follow-up conversations with individual models
- **`SelectionHandler.js`**: Utility for text selection, highlighting, and popup positioning

**Prompt & Settings Components**
- **`PromptSelector.jsx`**, **`PromptEditor.jsx`**, **`PromptManager.jsx`**: System prompt management UI
- **`SettingsModal.jsx`**: Full settings panel with 3 tabs:
  - API Key: OpenRouter key configuration
  - Models: Model pool management, default council selection, chairman selection
  - Prompts: Default prompt selection, create/edit/delete prompts
- **`ConfigModal.jsx`**: Council/chairman model configuration per conversation

**Search & Navigation Components**
- **`SearchModal.jsx`**: Cmd+K search modal with semantic search
  - First option always "New Conversation" (opens ModeSelector)
  - Arrow keys to navigate, Enter to select, Escape to close
  - 200ms debounced search with real-time results
- **`ModeSelector.jsx`**: Choose between Council and Synthesizer modes
  - Left/right arrows to switch, Enter to confirm
  - Visual selection highlight

**Synthesizer Components**
- **`SynthesizerInterface.jsx`**: URL-to-Zettelkasten notes interface
- **`NoteViewer.jsx`**: Display generated notes with focus mode and sentence highlighting

**Monitor Components**
- **`MonitorInterface.jsx`**: Main monitor management interface
- **`MonitorCard.jsx`**: Individual monitor display with status
- **`MonitorTimeline.jsx`**: Timeline view of monitor updates
- **`MonitorUpdateDetail.jsx`**: Detailed view of a single update
- **`MonitorCompare.jsx`**: Side-by-side comparison of changes
- **`MonitorDigest.jsx`**: Digest summary view
- **`MonitorChat.jsx`**: Conversational interface for querying monitor data
- **`CompetitorRow.jsx`**, **`AddCompetitorModal.jsx`**, **`FeatureList.jsx`**: Competitor tracking UI

**Visualiser & Question Set Components**
- **`VisualiserInterface.jsx`**: Diagram generation interface
- **`QuestionSetManager.jsx`**, **`QuestionSetEditor.jsx`**, **`QuestionSetSelector.jsx`**: Question set CRUD

**Theme & Utilities**
- **`contexts/ThemeContext.jsx`**: Dark/light mode toggle (supports both themes)
- **`utils/tokenizer.js`**: Token counting for context management
- **`utils/formatRelativeTime.js`**: Human-readable timestamps

**Styling (`*.css`)**
- Supports both light and dark mode via ThemeContext
- Primary color: #4a90e2 (blue)
- Global markdown styling in `index.css` with `.markdown-content` class
- 12px padding on all markdown content to prevent cluttered appearance

## Key Design Decisions

### Stage 2 Prompt Format
The Stage 2 prompt is very specific to ensure parseable output:
```
1. Evaluate each response individually first
2. Provide "FINAL RANKING:" header
3. Numbered list format: "1. Response C", "2. Response A", etc.
4. No additional text after ranking section
```

This strict format allows reliable parsing while still getting thoughtful evaluations.

### De-anonymization Strategy
- Models receive: "Response A", "Response B", etc.
- Backend creates mapping: `{"Response A": "openai/gpt-5.1", ...}`
- Frontend displays model names in **bold** for readability
- Users see explanation that original evaluation used anonymous labels
- This prevents bias while maintaining transparency

### Error Handling Philosophy
- Continue with successful responses if some models fail (graceful degradation)
- Never fail the entire request due to single model failure
- Log errors but don't expose to user unless all models fail

### UI/UX Transparency
- All raw outputs are inspectable via tabs
- Parsed rankings shown below raw text for validation
- Users can verify system's interpretation of model outputs
- This builds trust and allows debugging of edge cases

## Important Implementation Details

### Relative Imports
All backend modules use relative imports (e.g., `from .config import ...`) not absolute imports. This is critical for Python's module system to work correctly when running as `python -m backend.main`.

### Port Configuration
- **Development**: Backend on 8001, Frontend on 5173
- **Docker**: nginx on port 80 (mapped to 8080 externally), proxies `/api` to uvicorn on 8000
- Frontend `api.js` auto-detects: uses `localhost:8001` in dev, relative URLs in production

### Markdown Rendering
All ReactMarkdown components must be wrapped in `<div className="markdown-content">` for proper spacing. This class is defined globally in `index.css`.

### Model Configuration
Models are configurable via Settings UI or `data/config/settings.json`. The system supports:
- **Model Pool**: Available models for selection (add/remove via UI)
- **Council Models**: Which models participate (subset of pool)
- **Chairman Model**: Synthesizes final answer (can be same as council member)
Default model pool and chairman defined in `backend/settings.py`.

## Common Gotchas

1. **Module Import Errors**: Always run backend as `python -m backend.main` from project root, not from backend directory
2. **CORS Issues**: Frontend must match allowed origins in `main.py` CORS middleware
3. **Ranking Parse Failures**: If models don't follow format, fallback regex extracts any "Response X" patterns in order
4. **Missing Metadata**: Metadata is ephemeral (not persisted), only available in API responses
5. **Docker API Key**: In Docker, API key can be set via env var OR runtime settings UI; settings file takes priority

## Data Flow Summary

```
User Query
    ↓
Stage 1: Parallel queries → [individual responses]
    ↓
Stage 2: Anonymize → Parallel ranking queries → [evaluations + parsed rankings]
    ↓
Aggregate Rankings Calculation → [sorted by avg position]
    ↓
Stage 3: Chairman synthesis with full context
    ↓
Return: {stage1, stage2, stage3, metadata}
    ↓
Frontend: Display with tabs + validation UI
```

The entire flow is async/parallel where possible to minimize latency.

## Docker Deployment

### Architecture
- Multi-stage Dockerfile: Node build stage → Python+nginx final image
- Supervisord manages both nginx (frontend) and uvicorn (backend)
- nginx serves static frontend and proxies `/api` to uvicorn

### Volumes
- `wizengamot-data`: Conversation JSON files (`/app/data/conversations`)
- `wizengamot-prompts`: System prompt markdown files (`/app/prompts`)
- `wizengamot-config`: Runtime settings (`/app/data/config`)

### Scripts (`scripts/`)
- `deploy.sh`: Full deployment workflow (git pull → backup → migrate → rebuild → health check)
- `backup.sh`: Creates timestamped backups, maintains rotation (keeps last 5)
- `migrate.sh`: Data migrations between versions

### Environment Variables
- `OPENROUTER_API_KEY`: Can also be set via UI at runtime
- `FIRECRAWL_API_KEY`: Required for monitor web crawling functionality
- `DATA_DIR`, `PROMPTS_DIR`, `CONFIG_DIR`, `QUESTION_SETS_DIR`: Paths for Docker volume mounts

## Comment & Annotation System

### Overview
Users can highlight text in any stage response, add comments, and use those comments to start follow-up threads with individual council members. Comments are persisted to conversation JSON and displayed as inline highlights with hover popups. Users can also pin entire response segments to a "context stack" without highlighting.

### Key Features

**1. Inline Highlighting**
- Text selection creates persistent yellow highlights in the response
- Highlights use `<mark>` elements with `data-comment-id` attributes
- Hover over highlights shows responsive popup with comment details
- Active highlights get visual feedback (darker background)

**2. Responsive Hover Popups**
- Position intelligently (right, left, below based on viewport)
- Show comment content, stage info, timestamp
- Delete button for removing comments
- Smooth fade-in animation
- Smart positioning avoids viewport edges

**3. Comment Modal**
- Triggered by text selection
- Shows selected text, stage, and model context
- Keyboard shortcuts: Ctrl+Enter to save, Esc to cancel
- Creates comment with unique ID and timestamp

**4. Enhanced Commit Modal**
- Shows ALL comment context before starting follow-up
- Each comment displayed as card with:
  - Comment number badge
  - Stage and model badges
  - Highlighted text excerpt
  - Full comment content
  - Context inclusion note
- Allows selecting target model for follow-up
- User provides follow-up question

**5. Context Stack**
- Each Stage panel has a "stack" button to pin entire responses
- Pinned segments stored in Review Context sidebar
- Both highlights and stacked segments bundled for follow-up threads
- Allows hand-picking exactly what context the next model sees

**6. Thread View**
- Direct conversation with selected model
- Comment context + stacked segments automatically included in first message
- Back-and-forth interaction maintained
- Thread history persisted to conversation JSON

### Technical Implementation

**SelectionHandler.js**
- `getSelection()`: Captures text selection with position data
- `createHighlight()`: Creates `<mark>` elements for persistent highlights
- `removeHighlight()`: Cleanly removes highlights by comment ID
- `calculatePopupPosition()`: Smart positioning algorithm for popups
- `_getTextNodes()`: Traverses DOM to find text nodes for highlighting

**ResponseWithComments.jsx**
- Manages highlight lifecycle (creation, event listeners, cleanup)
- Handles hover and click interactions
- Shows/hides HighlightPopup based on interaction
- Coordinates with SelectionHandler for DOM manipulation

**HighlightPopup.jsx**
- Positioned absolutely based on highlight rect
- Arrow pointing to highlighted text
- Delete functionality triggers cascade: popup close → highlight remove → storage update

**CommitModal.jsx**
- Enhanced to show rich context cards
- Each card includes all metadata (stage, model, selection, comment)
- Visual hierarchy with badges and structured layout
- Clear indication that context will be included

### Storage
Comments and threads are persisted to conversation JSON files (`data/conversations/{id}.json`):
```javascript
// Comment structure
{
  id: string,           // Unique identifier
  selection: string,    // Highlighted text
  content: string,      // User's comment
  stage: number,        // 1, 2, or 3
  model: string,        // Model identifier
  message_index: number,// Which message in conversation
  source_content: string, // Optional full source for context
  created_at: string    // ISO timestamp
}

// Thread structure
{
  id: string,
  model: string,
  comment_ids: string[],
  context_segments: array,
  messages: [{role, content}],
  created_at: string
}
```

### Delete Workflow
1. User clicks delete in popup or annotation
2. API call to `DELETE /api/conversations/{id}/comments/{commentId}`
3. Backend removes from conversation JSON
4. Frontend state updated, SelectionHandler.removeHighlight() cleans DOM
5. UI updates to remove both highlight and popup

### Styling
- Yellow highlight: `#fff3cd` background, `#ffc107` border
- Hover state: `#ffe69c` background
- Active state: `#ff9800` border
- Popup: white with subtle shadow, 300px max width
- Global styles in `index.css` for consistency

