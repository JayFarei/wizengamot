# Repository Guidelines

## Project Structure & Module Organization
- `backend/`: FastAPI app, council orchestration, monitors, synthesizer, visualiser, podcast, and JSON storage helpers.
- `frontend/`: Vite + React client; shared UI in `src/components/`, entry glue in `src/App.jsx`, styles colocated.
- `prompts/`: System prompts per mode; monitor question sets live in `prompts/monitor/`.
- `data/`: Runtime storage (git-ignored); includes `conversations/`, `config/settings.json`, `monitors/`, `images/`, `podcasts/`, `search_index.pkl`.
- `scripts/`: Dependency checks, migrations, deploy/backup utilities, model setup.
- `docker/`, `Dockerfile`, `docker-compose.yml`: Containerized build + nginx/supervisord setup.
- `tests/` and `backend/tests/`: pytest-based smoke/e2e tests.

## Build, Test, and Development Commands
- `uv sync` — install backend dependencies whenever `pyproject.toml` changes.
- `uv run python -m backend.main` — serve the API on `localhost:8001`.
- `cd frontend && npm install` then `npm run dev` — install UI deps and start Vite on `localhost:5173`.
- `./start.sh` — boot both stacks; runs `scripts/check-deps.sh` unless `--skip-checks`.
- `./scripts/check-deps.sh` — validate Python/Node/ffmpeg, `.env`, and local deps.
- `./scripts/setup-models.sh` — pre-download Whisper + fastembed models.
- `uv run pytest tests/` and `uv run pytest backend/tests/` — run backend tests.
- `cd frontend && npm run lint` — ESLint; `npm run build && npm run preview` for production bundle.
- `docker compose up -d` — Docker dev/prod flow (nginx on 8080).

## Coding Style & Naming Conventions
Python: 4-space indents, type hints, concise module docstrings, and **relative imports** (run as `python -m backend.main`). Prefer extending existing Pydantic models over hand validation. React components stay in PascalCase files, hooks/utilities in camelCase, CSS beside JSX peers. Wrap markdown output in `.markdown-content` (see `frontend/src/index.css`). ESLint (`frontend/eslint.config.js`) governs frontend style; update manifests before adding new tooling.

## Testing Guidelines
No full coverage yet. Add backend tests under `tests/backend/` (pytest + FastAPI `TestClient`) or `backend/tests/` for e2e. UI specs belong in `frontend/src/__tests__/` using React Testing Library. Name tests after behaviors (`test_stage3_summary.py`, `StageTabs.spec.jsx`) and keep large fixtures in `data/` rather than inline blobs. Manual regression still matters: `./start.sh`, submit a prompt, confirm a new JSON file lands in `data/conversations/` with all stage payloads.

## Commit & Pull Request Guidelines
History favors short, imperative subjects (“readme tweaks”, “Label maker add”); keep future commits under ~50 characters and explain details in the body if needed. Reference issues, summarize commands run, and call out config/env impacts explicitly. PRs should include a crisp description plus screenshots or clips whenever `frontend/src/components/` changes the UI.

## Security & Configuration Tips
Keep `OPENROUTER_API_KEY` in a root `.env`; runtime settings live in `data/config/settings.json` and take precedence over env. Other optional keys: `FIRECRAWL_API_KEY`, `XAI_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Adjust model identifiers in `backend/settings.py` or via Settings UI only after confirming OpenRouter support, and mirror changes in user-facing copy. Scrub `data/conversations/` (and any `data/` artifacts) before publishing traces because they may contain sensitive prompts and model critiques.
