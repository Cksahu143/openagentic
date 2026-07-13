# OpenAgent Python Service

Optional multi-agent backend (FastAPI + LangGraph) that the main TS app can
delegate Python-native sub-goals to. See
[`docs/PYTHON_SERVICE.md`](../docs/PYTHON_SERVICE.md) in the repo root for
the full integration writeup — why this exists, what it deliberately
doesn't duplicate (browser automation, model SDKs), and an honest list of
what has/hasn't been run.

## Quickstart

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set BRIDGE_SHARED_SECRET + a model provider key
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/api/v1/health -H "X-OpenAgent-Bridge-Token: <your secret>"`

## Tests

```bash
pip install -r requirements.txt   # includes pytest / pytest-asyncio
pytest
```

## Layout

- `app/main.py` — FastAPI app, CORS, tool auto-registration on import
- `app/api/routes.py` — HTTP surface (`/agent/run`, `/tools/execute`, `/memory/*`, `/health`)
- `app/agents/` — planner + specialist agents + LangGraph wiring
- `app/tools/` — dynamically-registered tools (add new ones here)
- `app/memory/` — short-term (in-process) + long-term (ChromaDB) memory
- `app/core/` — config, logging, model factory, bridge auth
- `tests/` — pytest suite for the tool registry
