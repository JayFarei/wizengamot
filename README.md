# Wizengamot

A multi-LLM deliberation system inspired by [Karpathy's llm-council](https://github.com/karpathy/llm-council).

## What is Wizengamot?

Instead of asking one LLM, assemble a council of models that collaborate on your question:

1. **Stage 1: First Opinions** - Each model answers independently
2. **Stage 2: Peer Review** - Models evaluate and rank each other's responses (anonymized to prevent bias)
3. **Stage 3: Synthesis** - A chairman model compiles the final answer

### Additional Features
- **Synthesizer Mode**: Transform URLs (YouTube, podcasts, articles, PDFs) into Zettelkasten notes
- Inline annotations and follow-up threads with individual models
- Semantic search (Cmd+K)
- Dark mode
- Customizable system prompts

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
