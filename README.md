# Wizengamot

**Your AI sounding board.** Debate ideas with a council of models, synthesize research, track competitors, and visualize concepts.

Inspired by [Karpathy's llm-council](https://github.com/karpathy/llm-council).

> [!WARNING]
> **This project is under active development.** Features may change, break, or be incomplete. Use at your own risk and expect rough edges.

## Why Wizengamot?

Single-model responses give you one perspective. Wizengamot gives you a deliberation — multiple models debating, critiquing, and building on each other's ideas before synthesizing a final answer.

Use it to:
- Stress-test an investment pitch before presenting to VCs
- Get multiple perspectives on architectural decisions
- Synthesize hours of podcast content into actionable notes
- Track competitor moves across the web
- Whiteboard ideas into visual diagrams

## Modes

### Council

Multi-model deliberation with anonymous peer review.

1. **Stage 1** — Each model answers independently
2. **Stage 2** — Models evaluate and rank each other's responses (anonymized to prevent bias)
3. **Stage 3** — A chairman model synthesizes the final answer

**Example prompts:**
- "Should we pivot from B2B to B2C? Here's our current metrics: [data]"
- "Review this investment pitch and identify the three biggest weaknesses"
- "Debate: Is a microservices architecture right for a team of 5 engineers?"

### Synthesizer

Transform URLs into structured Zettelkasten notes.

Supports YouTube videos, podcast episodes, arXiv papers, PDFs, and web articles.

**Example uses:**
- YouTube talk → Key takeaways with timestamps
- arXiv paper → Methodology, findings, and limitations extracted
- 2-hour podcast → Structured notes with notable quotes

### Monitor

Track entities and competitors across multiple sources with scheduled analysis.

Configure question sets to extract specific intelligence from monitored sources.

**Example uses:**
- Track competitor product launches and pricing changes
- Monitor industry news for regulatory updates
- Watch for mentions of your company or product

### Visualiser

Generate diagrams and flowcharts from content using AI image generation.

Supports multiple styles: bento grids, whiteboard sketches, system diagrams, napkin drawings, cheatsheets, and cartoons.

**Example uses:**
- System architecture diagram from a technical description
- Flowchart from a process explanation
- Concept map from research notes

## Additional Features

- **Inline annotations** — Highlight text and add comments to any response
- **Follow-up threads** — Continue conversations with individual council members
- **Context stack** — Pin specific content to include in follow-up queries
- **Semantic search** (Cmd+K) — Find conversations by meaning, not just keywords
- **Dark mode** — Work comfortably in any lighting
- **Custom system prompts** — Shape council behavior per conversation

See [FEATURES.md](FEATURES.md) for the full changelog.

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) for Python package management

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/JayFarei/wizengamot.git
   cd wizengamot
   ```

2. Install dependencies:
   ```bash
   # Backend
   uv sync

   # Frontend
   cd frontend && npm install && cd ..
   ```

3. Configure your API key:
   ```bash
   cp .env.example .env
   # Edit .env and add your OpenRouter API key
   ```

   Get your API key at [openrouter.ai](https://openrouter.ai/).

4. Run the application:
   ```bash
   ./start.sh
   ```

   Or manually:
   ```bash
   # Terminal 1 - Backend
   uv run python -m backend.main

   # Terminal 2 - Frontend
   cd frontend && npm run dev
   ```

5. Open http://localhost:5173

## Docker Deployment

```bash
# Build and run
docker compose up -d

# Access at http://localhost:8080
```

The API key can also be configured via the Settings UI after deployment.

### Volumes
- `wizengamot-data`: Conversation storage
- `wizengamot-prompts`: System prompts
- `wizengamot-config`: Runtime settings

## Tech Stack

- **Backend**: FastAPI, Python 3.10+, async httpx
- **Frontend**: React + Vite
- **Storage**: JSON files
- **API**: OpenRouter (access to 100+ models)

## License

MIT License - see [LICENSE](LICENSE)
