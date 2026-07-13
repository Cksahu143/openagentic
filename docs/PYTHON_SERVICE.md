# Python Multi-Agent Service — Integration Notes

## What this is

`python-service/` is an optional FastAPI + LangGraph backend that runs
alongside the existing TanStack Start app, reached via an authenticated
HTTP bridge (`src/lib/python-bridge.server.ts`). See the repo root
`QUICKSTART.md` for the one-command way to run everything together.

Chat tools:

- `delegate_to_python_agent` — hands a sub-goal to a LangGraph with four
  specialists (Research, Browsing, Coding, File), routed by a Planner node,
  hard-capped at `MAX_HOPS=6`.
- `use_agent_browser` — direct control of the agent's OWN persistent
  browser: navigate, click, fill, screenshot, upload, tabs. See "The
  agent's own browser" below.
- `list_python_workspace` — lists files in the agent's own persistent
  workspace directory for this session.
- `recall_python_memory` — semantic search over a ChromaDB long-term
  memory store, per user.
- (server-only) `/workspace/{user_id}/{session_id}/files` — direct REST
  access to a workspace listing.

## The agent's own browser

This is a THIRD kind of browser in the system, distinct from the other two:

| | Companion extension (JS) | `headless_browse` (this service) | Agent's own browser (this service) |
|---|---|---|---|
| Whose session? | The user's real browser | Nobody's — fresh, throwaway | The agent's own, persistent |
| Persists login? | Yes (it's the user's browser) | No — new profile every call | Yes — `AGENT_BROWSER_PROFILE_ROOT/{user_id}/` on disk |
| Can click/fill/upload? | Yes | No (read-only) | Yes |
| Tools | `companion_*` (chat.ts) | `headless_browse` | `agent_browser_*` / `use_agent_browser` |

The agent's own browser (`app/browser/manager.py`, `app/tools/agent_browser.py`)
uses Playwright's `launch_persistent_context` so cookies/login state survive
across calls and service restarts. Live `Page`/`BrowserContext` objects are
kept in the FastAPI process's memory between calls so it doesn't relaunch
Chromium every action — restarting the service loses the in-memory open
tab but not the on-disk login/profile.

**On Google login specifically**: there's no automated-login tool, on
purpose. Google (like most real security) fingerprints and blocks
Playwright-driven login attempts — trying to script around that is
unreliable and against most sites' ToS. What actually works:
`python-service/scripts/login_google.py <user_id>` opens a real, visible
browser window using the same persistent profile; you log in by hand once
(solving any captcha/2FA yourself); after that, the agent's headless calls
reuse the saved session, same as staying logged into your own browser.

## Keys / config

`python-service/.env` and the root `.env.local` are both git-ignored and
pre-filled if you provided keys when this was generated — see
`QUICKSTART.md`. Nothing else needs manual configuration to get a working
setup with a Gemini-backed agent.

## The agent's workspace

Each Python agent run gets its own real directory on disk:
`{WORKSPACE_ROOT}/{user_id}/{session_id}/`. It's reused across calls that
pass the same `session_id` — the TS bridge passes the existing
`agent_sessions.id` (the same session already tracked in Postgres) so a
workspace persists for the life of one chat/agent session, not just one
tool call. Tools:

- `workspace_write_file` / `workspace_read_file` / `workspace_list_files` /
  `workspace_delete_file` — direct file I/O, path-confined (traversal
  outside the workspace root raises `WorkspaceError`).
- `run_python` writes its snippet into and executes it from the workspace
  when given `user_id`/`session_id`, so `open("output.csv", "w")` inside
  agent-generated code lands in a place other tools can then read.
- `read_pdf` / `extract_pdf_images` (pdfplumber + PyMuPDF), `read_docx`
  (python-docx), `image_info` (Pillow) all read files already sitting in
  the workspace.

This is a **plain filesystem directory with path confinement**, not a
container-per-session sandbox. Fine for a single trusted backend process;
not isolation against a malicious/misbehaving Python-side tool call itself
(see `run_python`'s caveats below).

## Libraries added and why

| Library | Used for | Notes |
|---|---|---|
| `langgraph` / `langchain-core` / `langchain-openai` / `langchain-anthropic` / `langchain-google-genai` | Planner + 4 specialist agents | routes through Lovable gateway if configured, else falls back to whichever direct provider key is set (currently: Gemini) |
| `chromadb` | long-term semantic memory | file-persisted, zero extra infra |
| `playwright` | `headless_browse` (throwaway) + the agent's own persistent browser (`agent_browser_*`) | two different use modes of the same library — see "The agent's own browser" above |
| `pdfplumber` | `read_pdf` — text + table extraction | |
| `pymupdf` (`fitz`) | `extract_pdf_images` — embedded image extraction | pdfplumber doesn't do this well |
| `python-docx` | `read_docx` — paragraphs + tables | |
| `pillow` | `image_info` — dimensions/format metadata | not semantic image understanding — that needs a multimodal model call |
| `httpx` + `beautifulsoup4` | `fetch_page` — plain HTTP research | |

## What this deliberately still does NOT do

- **No CrewAI/AutoGen.** The graph in `agents/graph.py` stays a small,
  explicit, hop-capped LangGraph rather than an open-ended agent swarm —
  matching this project's own `KNOWN_LIMITATIONS.md`, which flags
  "model-driven, not deterministic" retry logic as a limitation on the JS
  side, not a pattern to import.
- **`headless_browse` (Playwright) is not a replacement for the companion
  Chrome extension.** It's a throwaway, unauthenticated headless Chromium
  instance — no cookies, no login, torn down after every call. Use it for
  reading public JS-rendered pages only. Anything requiring the user's own
  logged-in session still goes through `companion_*` tools on the JS side.
- **No pgvector/FAISS/LanceDB** — ChromaDB was kept from the first pass;
  swapping backends is contained to `app/memory/store.py` if usage grows.
- **No OpenCV** — wasn't added because nothing in the current tool set
  needs frame-level image processing yet (Pillow's metadata is enough for
  now); straightforward to add as a new tool module when there's an actual
  use case.

## Running it locally

```bash
cd python-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium   # downloads the headless browser binary
cp .env.example .env          # fill in BRIDGE_SHARED_SECRET + a model provider key
uvicorn app.main:app --reload --port 8000
```

Then in the TS app's real `.env`, add (see root `.env.example`):

```
PYTHON_SERVICE_URL=http://localhost:8000
PYTHON_SERVICE_TOKEN=<same value as BRIDGE_SHARED_SECRET above>
```

The Docker image (`Dockerfile`) runs `playwright install --with-deps
chromium` at build time so the container doesn't need that step manually.

## Honest status — what's verified vs. not

Still built in a sandboxed environment with **no network access**:

- ✅ All Python files pass `ast.parse`; TS edits match existing file
  conventions and I traced `sessionId`'s scope by hand to confirm the new
  tool closures can see it.
- ✅ `tests/test_tool_registry.py` and `tests/test_workspace.py` cover
  registry and workspace path-confinement logic — **not actually run**.
  Run `pytest` yourself.
- ❌ Not run: `uvicorn`, the 5-node LangGraph compile, ChromaDB,
  `playwright install chromium` + a real headless page load or persistent
  context launch, pdfplumber/PyMuPDF/python-docx against a real file, the
  live HTTP round-trip TS → Python, or `langchain-google-genai` actually
  calling Gemini with the provided key. Pinned versions in
  `requirements.txt` may have moved on since my knowledge cutoff — expect
  to fix at least a version mismatch or two. `start.sh` has not been run
  end-to-end either.
- ❌ `run_python`'s sandboxing is still a subprocess with `-I` isolated
  mode and a timeout, with filesystem access to the workspace — no
  seccomp/cgroup/network isolation. Treat with the same caution as
  `code-runner.server.ts`: fine for your own use, not safe to expose to
  untrusted multi-tenant input without real container-level hardening.
- ❌ The agent's own browser (`agent_browser_*`) keeps live Playwright
  objects in the FastAPI process's memory (`_contexts` dict) — this works
  for a single-process dev setup but won't work correctly if you ever run
  multiple `uvicorn` worker processes (each would have its own separate
  in-memory context, unaware of the others), and there's no idle-timeout
  cleanup yet, so long-lived Chromium processes will accumulate if you
  open browsers for many different users and never call
  `agent_browser_close_session`.
- ❌ `login_google.py` needs a real display (your own machine, not a
  headless server/container) — `headless=False` requires one. If you're
  running the Python service in Docker/on a remote server, run the login
  script locally against the same `AGENT_BROWSER_PROFILE_ROOT` path (or
  copy the resulting profile directory over) instead.
- ❌ `start.bat`'s env-var loading is a simple line-by-line `for /f` over
  `.env.local` — it'll also set a harmless bogus variable from the leading
  comment line. Doesn't break anything, just noting it's not a real
  dotenv parser.

## Not done (still explicitly out of scope)

- Writing Python agent results back into the `agent_sessions` Supabase
  table — `agents/state.py` carries `session_id` now specifically to make
  this easier later, but the write-back isn't wired.
- Exposing companion browser tools to the Python side (bidirectional
  bridge) — `headless_browse` covers unauthenticated JS-rendered reads only.
- Auth beyond the shared secret between the two backend services.
- Celery/Redis background workers — the graph still runs synchronously
  within one HTTP request; fine for hop-capped, short-lived goals, worth
  revisiting if goals get long-running.
- Workspace cleanup/retention policy — directories accumulate on disk with
  no expiry yet; add a cron/cleanup task before this sees real traffic.

## Architecture

```
TS app (chat.ts)
   │  delegate_to_python_agent / list_python_workspace / recall_python_memory
   ▼
src/lib/python-bridge.server.ts   (HTTP + shared-secret auth)
   │
   ▼
python-service/app/main.py  (FastAPI)
   │
   ├── api/routes.py         — /agent/run, /tools/execute, /memory/*, /workspace/*, /health
   ├── agents/graph.py       — LangGraph: planner -> {research|browsing|coding|file} -> planner
   ├── agents/planner.py     — goal decomposition + routing
   ├── agents/research.py    — plain HTTP page reads (fetch_page)
   ├── agents/browsing.py    — headless JS-rendered page reads (headless_browse)
   ├── agents/coding.py      — sandboxed Python snippet generation + execution
   ├── agents/file.py        — workspace inspection
   ├── agents/memory_agent.py— recall/remember against long-term store
   ├── tools/registry.py     — dynamic registration, timeouts, retries, permissions
   ├── tools/web.py          — fetch_page (SSRF-guarded GET)
   ├── tools/browser.py      — headless_browse (Playwright, throwaway instance)
   ├── tools/code_exec.py    — run_python (subprocess, isolated mode, workspace-aware)
   ├── tools/documents.py    — read_pdf, extract_pdf_images, read_docx, image_info
   ├── tools/workspace.py    — workspace_write_file/read_file/list_files/delete_file
   ├── tools/agent_browser.py— navigate/click/fill/screenshot/upload/tabs on the agent's own browser
   ├── browser/manager.py    — persistent Playwright context per user, on-disk profile
   ├── workspace/manager.py  — per (user, session) directory, path-confined
   └── memory/store.py       — ShortTermMemory (in-process) + LongTermMemory (Chroma)

scripts/login_google.py      — run once, manually, to sign the agent's browser into Google
```
