# OpenAgent Changelog

## Cyclic free-model rotation, VM package manager, agentic resilience

- Free-model rotation is now a true loop: after the last OpenRouter free model runs out of credits or gets rate limited, the chain clears cooldowns and wraps back to the first model, cycling up to three times with backoff before failing.
- `resolveFreeModel` no longer returns "no model available" when everything is cooling down — it resets the rotation and starts from the top.
- The virtual computer gained a package manager: `install` / `apt` / `npm` / `pip` / `brew` install Node, Bun, Deno, TypeScript, Python 3, git, curl, sqlite3, ffmpeg and the agent apps; `install --list`, `uninstall`, `open <app>`, `ps`, `env` and an installed-aware `which` round it out.
- `node` / `bun` / `deno` now execute JavaScript inside the VM sandbox once installed, and `git` supports basic subcommands.
- The agent loop is more resilient: 50-step tool loops, 5 provider retries, exponential-backoff retries on every network tool, and a system prompt that requires diagnosing, installing missing packages, and trying multiple strategies before reporting failure.

## Integrated agent cockpit and VM workbench


## Integrated agent cockpit and VM workbench

- Chat now embeds a live agent cockpit for terminal activity, task progress, decision summaries, source files, sub-agents, and website previews; raw tool payloads no longer clutter messages.
- Added `vm_browse`, an isolated public-web app that persists readable page snapshots into the VM even when the optional Python browser is offline.
- Fixed mini-computers reading stale terminal/file state and raised autonomous sub-agent runs to the standard 50-step tool loop.
- Added terminal file operations, file execution, HTML preview discovery, and honest Linux/Windows/macOS compatibility profiles.
- The planner now explicitly launches independent sub-agent tool calls together so the AI SDK can execute them concurrently.
- Replaced in-process `new Function` code execution with a memory- and time-bounded QuickJS WebAssembly isolate that exposes no server, environment, filesystem, or network APIs.

## OpenRouter-first virtual computer reliability

- OpenRouter now leads the provider chain; every available free, tool-capable model participates in request-time fallback.
- Removed availability probes that consumed free quota before real work.
- Added enforced virtual-computer and isolated-browser permissions.
- The computer boots for authorized chat work, and its terminal now executes commands directly.

## Milestone 9 (ultimate completion pass)

### Added
- **Reliable clicking** — `pageClick` (extension v0.3.1) scrolls the
  target to center, settles a frame, verifies visibility, checks
  occlusion via `elementFromPoint`, tries a native click, and — if
  occluded and nothing changed — synthesizes a full
  pointerdown/mousedown/pointerup/mouseup/click sequence at the rect
  center. Returns `{ method, occluded, urlChanged, urlAfter }` so the
  agent can verify without a second observation.
- **Fast-path execution** — system prompt now differentiates simple,
  high-confidence actions (click labelled element, type into labelled
  field, select value, open known URL, switch tab) from ambiguous ones.
  Fast path: reuse a <5 s-old observation, batch fills, skip
  set_reasoning for trivial acts, use `urlChanged` from the click result
  as verification. Full loop kicks back in on ambiguity or failure.
- **VISION.md** and **docs/M9_VERIFICATION.md** — vision document and
  per-requirement M9 verification report with manual test plan.

## Milestone 9 (reliability tuning)

### Changed
- **Recovery caps & backoff** — `record_recovery` now enforces
  MAX_PER_STEP=4 and MAX_PER_SESSION=8 with exponential backoff
  (400 / 800 / 1600 / 3200 / 5000 ms). Returns
  `{ attempt, backoffMs, capped, perStep, perSession }` so the model
  can wait, retry, or escalate deterministically. Cap-reached events
  surface in the Workspace timeline (🛑) and `recovery_status`.
- **Verification criteria** documented in the system prompt: an ACT
  succeeds only when the next observation shows a URL change, an
  expected new element, a matching field value, `pageState:"ready"`
  after a redirect, or a known success text — otherwise recovery
  triggers. Improves reliability on slow / redirect-heavy sites.



## Milestone 9 (completion pass)

**Hybrid observation & real autonomous agent**

### Added
- **Hybrid observation engine** (`companion_observe`) — one unified observation object with:
  page title, URL, pageState (ready/loading/error/dialog-open), summary,
  headings (h1-h4), landmarks (nav/main/aside/header/footer + ARIA), forms
  with fields (name/type/label/required), tables (headers + row counts),
  lists, dialogs, error messages (`role=alert`, `aria-live`, `.error`),
  loading indicators (`aria-busy`, `role=progressbar`, spinners), images
  with alt text, meaningful paragraphs, meta description, and interactive
  elements with stable refs, disabled/checked flags, and bounding boxes.
- **Intelligent waiting** — `companion_wait_for` supports modes:
  `selector`, `visible`, `enabled`, `text`, `ready`, `dialog`, `dom-stable`
  (mutation-observed quiet period). Fixed timers only when necessary.
- **Vision fallback** (`companion_screenshot`) — JPEG capture of the active
  tab, optional multimodal analysis via Lovable AI Gateway. Stored in the
  session's screenshot history with reason, URL, title, tab id and visual
  summary. Never activated on a loop.
- **Browser memory** — new `browser_memory` JSONB on `agent_sessions` +
  `set_browser_memory` tool for `visitedUrls`, `previousSearches`,
  `completedObjectives`, `currentObjective`, `knownTabs`, `notes`.
  Visited URLs auto-recorded from every `observe` call.
- **Recovery tracking** — `record_recovery({ strategy, attempt, note })`
  bumps `retry_count` and updates `recovery_status` shown live in the
  Workspace.
- **Waiting status** — `waiting_status` column populated during
  `wait_for`/`navigate` and cleared afterwards.
- **Observation summary** — `observation_summary` + `page_summary` on
  `agent_sessions`, streamed to the Workspace.
- **Screenshot history** — `screenshots` JSONB column with rolling last-30
  captures per session.
- Companion extension v0.3.0 with new `observe`, `screenshot`, extended
  `wait_for` handlers, disabled/enabled checks on click, and richer tab
  metadata (tabId returned on every action).
- Workspace panels: **Observation summary**, **Browser memory**,
  **Recovery / retry**, **Waiting on**, **Screenshot log**.

### Improved
- Observe → Think → Act loop system prompt: explicit observation priority
  (DOM → accessibility → state → vision fallback), verification after every
  action, automated recovery instructions.
- `stopWhen` bumped from `stepCountIs(50)` to `stepCountIs(60)` for longer
  autonomous runs.
- Every companion action now clears `waiting_status` on completion.

### Files created
- `CHANGELOG.md`
- `KNOWN_LIMITATIONS.md`

### Files modified
- Migration: adds `observation_summary`, `page_summary`, `browser_memory`,
  `waiting_status`, `recovery_status`, `screenshots` columns to
  `agent_sessions`.
- `public/companion-extension/manifest.json` → 0.3.0
- `public/companion-extension/background.js` — hybrid observation, richer
  wait modes, screenshot, disabled/enabled checks.
- `src/routes/api/chat.ts` — hybrid observation prompt, new tools
  (`companion_screenshot`, `record_recovery`, `set_browser_memory`),
  observation-derived state writes, waiting-status tracking.
- `src/routes/_authenticated/workspace.tsx` — new live panels.
- `docs/ARCHITECTURE.md` — Perception & Session sections.
- `MASTER_ROADMAP.md` — M9 completion note.
