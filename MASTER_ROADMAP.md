# OpenAgent — Master Roadmap

Single source of truth for OpenAgent from **Milestone 1 → Milestone 20 (v1.0)**.
After M20, development moves to semantic versioning (v1.1, v1.2, v2.0…).

## Progress toward v1.0

**Current milestone:** M9 — Autonomous Agent Sessions, Reasoning & Reliability ✅
**Completion:** 9 / 20 = **45%**

| # | Milestone | Status |
|---|---|---|
| 1 | Foundation: Auth, DB, App Shell | ✅ Completed |
| 2 | Memory & Tasks | ✅ Completed |
| 3 | AI Planner (streaming chat) | ✅ Completed |
| 4 | Browser-lite & Code Runner | ✅ Completed |
| 5 | Files, BYO Providers & Sub-AI | ✅ Completed |
| 6 | Companion Extension (Real Chrome Control) | ✅ Completed |
| 7 | Recordings, Plugins, Permissions | ✅ Completed |
| 8 | Rich Browser Tools & Workspace v1 | ✅ Completed |
| 9 | Persistent Sessions, Task Tree, Timeline | ✅ Completed (this milestone) |
| 10 | Vision + Screenshot Understanding | ⏳ Planned |
| 11 | Multi-Session Orchestrator | ⏳ Planned |
| 12 | Desktop Companion (native) | ⏳ Planned |
| 13 | Plugin Marketplace & Sandbox | ⏳ Planned |
| 14 | Team Workspaces & Sharing | ⏳ Planned |
| 15 | Long-Term Memory (RAG) | ⏳ Planned |
| 16 | Voice I/O & Ambient Mode | ⏳ Planned |
| 17 | Agent Evaluation & Benchmarks | ⏳ Planned |
| 18 | Fine-Grained Safety & Approvals | ⏳ Planned |
| 19 | Mobile Companion App | ⏳ Planned |
| 20 | OpenAgent v1.0 — Polish, Docs, Public Launch | ⏳ Planned |

---

## Completed milestones

### M1 · Foundation
Auth (Google OAuth via Lovable broker), profiles, user_roles, conversations, messages, user_settings, tasks, permission_grants, activity_logs. Dark technical design system, AppShell, sidebar, base routes. Module contracts scaffolded under `src/modules/*`.

### M2 · Memory & Tasks
`memories` table + module, DB-backed tasks module, client-side activity logger, `/memory` and `/tasks` pages.

### M3 · AI Planner
`/api/chat` server route using AI SDK v7 + Lovable Gateway. Streaming chat with client-applied tool calls (save_memory, create_task). Chat persistence with UIMessage parts.

### M4 · Browser-lite & Code Runner
`browser-fetch.server.ts` (SSRF-protected HTML fetcher), `code-runner.server.ts` (sandboxed JS eval), browser module wired to server functions.

### M5 · Files, BYO Providers, Sub-AI
Private `user-files` bucket, files module + `/files` page, `provider_keys` table (RLS-scoped) + `/providers` page. Chat gains `fetch_url`, `run_code`, `ask_ai`, `write_file` tools.

### M6 · Companion Extension
`companion_devices` + `companion_commands` tables. Chrome MV3 extension polls for commands and controls tabs. `callCompanion` server helper. Devices pairing page.

### M7 · Recordings, Plugins, Permissions
`screen_recordings`, `installed_plugins`. `/permissions` capability grants UI. `/recordings` with screen-share capture + playback from storage. `/plugins` tool-pack manifests. Live `AgentActivity` feed integrated into chat + workspace.

### M8 · Rich Browser Tools & Workspace v1
Companion extension v0.2 with `pageGetDom`/`pageClick`/`pageFill`/`pageSelect`/`pageScroll`/`pageWaitFor` + "AI working" glow overlay + chain-polling. Chat route gains full `companion_*` toolset with structured DOM refs. Dedicated `/workspace` page with realtime tasks / commands / memories.

### M9 · Persistent Sessions, Task Tree, Timeline (this release)
**Primary goal:** Turn OpenAgent from a sequence of tool calls into a persistent autonomous agent that plans, reasons, and can be paused / resumed / cancelled across page reloads.

**New systems**
- `agent_sessions` table: goal, status (planning/running/waiting/paused/completed/failed/cancelled), `task_tree` JSON, `current_step`, `tool_history`, `timeline`, `retry_count`, `reasoning`, `current_url`, `active_tab_id`, `thread_id`. RLS-scoped, realtime-published, `updated_at` trigger.
- Session bootstrapping in `/api/chat`: every user turn ensures (or reuses) an active session bound to the conversation `threadId`; timeline event `🧠 Goal received` is written immediately.
- New AI tools that write live session state:
  - `plan_session({ steps })` — builds the live task tree
  - `set_reasoning({ reasoning })` — records chain-of-thought
  - `update_step({ index, status })` — running/done/failed/skipped
  - `complete_session({ summary })` — marks the goal finished
- Every companion tool call now auto-writes `🛠 action → ✅/⚠️ result` timeline entries and appends to `tool_history`, and tracks `current_url` + `active_tab_id`.
- Pause / cancel enforcement inside the tool loop: if a user pauses or cancels from the Workspace, the next companion action refuses to run and reports back to the model.

**UI**
- `/workspace` completely rebuilt as a live control center: sessions list, live task tree with status icons, current reasoning, session controls (Pause / Resume / Cancel), streaming timeline of icons + labels + timestamps, tool history.
- All panels stream via `postgres_changes` on `agent_sessions`.

**Backend**
- `src/lib/agent-sessions.functions.ts` — `pauseSession` / `resumeSession` / `cancelSession` server functions guarded by `requireSupabaseAuth`.

**AI improvements**
- System prompt reshaped into an explicit *plan → reason → act → verify → update-step → complete* lifecycle.
- Recovery instructions: read the error → set_reasoning with a recovery plan → retry with an alternative before asking the user.

**Files created**
- `src/lib/agent-sessions.functions.ts`
- `MASTER_ROADMAP.md`

**Files modified**
- Migration: adds `public.agent_sessions` (+ realtime).
- `src/routes/api/chat.ts` — session bootstrapping, planning/reasoning tools, timeline + tool history writes, pause/cancel enforcement, revised system prompt.
- `src/routes/_authenticated/workspace.tsx` — full rebuild.
- `src/routes/_authenticated/chat.$threadId.tsx` — sends `threadId` in transport body.
- `src/components/app-sidebar.tsx` — version → Milestone 9.

**Success criteria met**
- Sessions survive page reloads (state lives in Postgres, restored by RLS-scoped select).
- Live task tree renders and updates as the agent progresses.
- User can Pause, Resume, and Cancel a running session and the model honors those transitions on its next tool call.
- Timeline streams reasoning + tool calls in near-real-time via Realtime.

**Known limitations**
- Retry logic is model-driven, not deterministic — the model decides when to retry.
- Timeline is truncated to the last 200 events / tool_history to last 100 per session.
- Pause is enforced at tool-call boundaries; an in-flight companion command finishes before pause takes effect.
- Session doesn't auto-resume from the Workspace yet — resuming currently requires the user to send another chat message once resumed.

---

## Upcoming milestones

### M10 · Vision + Screenshot Understanding
**Goal:** Give the agent eyes.
**Features:** companion `screenshot` tool → base64 PNG → multimodal call to `google/gemini-3-flash-preview`; visual grounding for elements the DOM can't describe (canvas, charts, videos); "why did that fail" screenshots attached to failed steps.
**Success:** agent can click a canvas-drawn button and describe an image on the page.
**Complexity:** M.

### M11 · Multi-Session Orchestrator
**Goal:** Multiple concurrent agent sessions per user.
**Features:** session queue, priority, parallel independent goals (e.g. "research X while filling form Y"), per-session dedicated tab pool, cross-session handoff of memories.
**Success:** two sessions run at once without stepping on each other's tabs.
**Complexity:** L.

### M12 · Desktop Companion (native)
**Goal:** Move beyond the browser.
**Features:** small local daemon (Tauri or Electron) with accessibility-tree read, key/mouse input, `openApp`, `readFile`/`writeFile` under an explicit allowlist. Signed local channel (wss://127.0.0.1 + per-device token, already scaffolded in `src/modules/companion`).
**Success:** agent opens VS Code, types code, and saves the file.
**Complexity:** XL.

### M13 · Plugin Marketplace & Sandbox
**Goal:** Third-party tool packs.
**Features:** signed plugin manifests, capability gating via existing `permission_grants`, per-plugin isolated JS sandbox, public registry read from `installed_plugins`.
**Success:** install a plugin, agent gains new tool call within one turn.
**Complexity:** L.

### M14 · Team Workspaces & Sharing
**Goal:** Shared sessions and memories.
**Features:** `teams` + `team_members` tables, share a session URL, per-team roles (owner/editor/viewer), org-wide memory namespace.
**Success:** two accounts see the same live timeline.
**Complexity:** M.

### M15 · Long-Term Memory (RAG)
**Goal:** Persistent knowledge the agent recalls automatically.
**Features:** `memory_embeddings` (pgvector), auto-embed saved memories + past sessions, retrieval in system prompt on every turn, "why did you do that" citations.
**Success:** agent recalls a preference saved 30 days ago without being prompted.
**Complexity:** M.

### M16 · Voice I/O & Ambient Mode
**Goal:** Talk to OpenAgent.
**Features:** TTS + STT via Lovable AI Gateway, push-to-talk composer, ambient "listen in the background" mode gated by permission.
**Success:** hands-free "search YouTube for Python and open the first result".
**Complexity:** M.

### M17 · Agent Evaluation & Benchmarks
**Goal:** Measure the agent.
**Features:** internal eval harness with scripted goals, pass/fail traces, regression dashboard, per-model comparisons (Gemini vs Claude vs GPT via BYO keys).
**Success:** every deploy runs 50 evals and posts a report.
**Complexity:** M.

### M18 · Fine-Grained Safety & Approvals
**Goal:** Explicit consent for risky actions.
**Features:** per-action `needsApproval` policy engine, spend/write/purchase/DM gates, approval UI in chat + Workspace, audit trail.
**Success:** the agent cannot post, purchase, or DM without an approval click.
**Complexity:** M.

### M19 · Mobile Companion App
**Goal:** OpenAgent in your pocket.
**Features:** PWA-first mobile shell (already responsive), native wrappers, mobile session view with the same timeline, push notifications on session completion.
**Success:** start a session on desktop, watch it finish on mobile.
**Complexity:** L.

### M20 · OpenAgent v1.0 — Polish, Docs, Public Launch
**Goal:** Ship v1.
**Features:** full docs site, onboarding tour, marketing site, changelog, self-serve sign-up polish, telemetry & error reporting, published Chrome Web Store extension.
**Success:** external users can go from "sign up" to "goal completed" without help.
**Complexity:** L.

---

## After v1.0

Semantic versioning takes over:
- **v1.1** — first minor release with community-requested features
- **v1.2** — perf & reliability sweep
- **v2.0** — major architecture bump (candidates: multi-agent swarms, on-device inference)

No further numbered milestones will be added past M20.

---

## Roadmap update protocol

At the end of every future response, include a short block:
- Current milestone
- Overall completion % toward v1.0
- Remaining milestones
- Newly completed objectives
- Any roadmap updates

When a milestone finishes, this document is edited to:
1. Move the milestone from *Upcoming* to *Completed milestones* with a summary + date.
2. Update the top progress table & percentage.
3. Advance the "Current milestone" line.
