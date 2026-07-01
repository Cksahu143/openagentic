# OpenAgent Changelog

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
