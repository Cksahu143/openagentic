# OpenAgent — Architecture

OpenAgent is a long-term project. The architecture is intentionally modular so
each capability can be built, replaced, and permission-gated independently.

## Layers

```
┌───────────────────────────────────────────────────────────────────┐
│                        Frontend (React, TanStack Start)            │
│  Routes · Sidebar shell · Chat · Dashboard · Settings · Logs       │
└────────────────┬──────────────────────────────────────────────────┘
                 │ Server functions / RPC
┌────────────────▼──────────────────────────────────────────────────┐
│              Backend API (TanStack server functions)               │
│  Auth-aware, RLS-scoped Supabase access · planner orchestrator     │
└────────────────┬──────────────────────────────────────────────────┘
                 │
┌────────────────▼─────────────────┐   ┌────────────────────────────┐
│           Module Layer           │   │  Local Companion (Mile. 6) │
│  planner · browser · companion   │◄──┤  Signed loopback channel    │
│  memory · files · tasks · plugins│   │  Accessibility / I/O / FS   │
│  permissions · logs              │   └────────────────────────────┘
└────────────────┬─────────────────┘
                 │
┌────────────────▼─────────────────┐
│       Persistence (Cloud)        │
│  profiles · user_roles · convos  │
│  messages · tasks · permissions  │
│  user_settings · activity_logs   │
└──────────────────────────────────┘
```

## Module rules

1. Modules expose **interfaces only** through `src/modules/<id>/index.ts`.
2. Modules never import other modules directly. Coordination goes through the
   planner or the permission manager.
3. Every privileged action must call `permissions.ensure(scope)` before doing
   anything observable.
4. Every action that has user-visible consequences must call `logger.log(...)`.

## Data model (Milestone 1)

| Table              | Purpose                                        |
| ------------------ | ---------------------------------------------- |
| `profiles`         | Display name, avatar, bio                      |
| `user_roles`       | Separate role table (admin / user)             |
| `conversations`    | Chat threads                                   |
| `messages`         | Chat messages, role-tagged                     |
| `user_settings`    | Per-user JSON settings                         |
| `tasks`            | Task history records                           |
| `permission_grants`| Capability grants per user                     |
| `activity_logs`    | Append-only audit log                          |

All tables: RLS on, scoped to `auth.uid()`, `service_role` granted for admin.

## Security stance

- Permission-first. No implicit capabilities, ever.
- Service-role key never leaves the server.
- Roles live in `user_roles`, never on profile rows.
- All sensitive functions are `SECURITY DEFINER` with EXECUTE revoked.
- Local companion will pair via one-time code and a signed token per device.

## Frontend conventions

- All colors via design tokens in `src/styles.css` — no hex/`text-white` in JSX.
- Sidebar layout via shadcn/ui `SidebarProvider` (see `app-shell.tsx`).
- Auth gate via `_authenticated/route.tsx` (managed pathless layout).
- Chat is threaded; each thread has its own URL (`/chat/$threadId`).

## Milestone 9 — Hybrid perception & autonomous sessions

Observation priority (agent loop always tries in this order):

1. `companion_observe` — structured DOM + accessibility + page state (PRIMARY)
2. `companion_read_active_tab` / `companion_list_tabs` — text + tabs
3. `companion_screenshot` — VISION FALLBACK only (canvas, webgl, pdf viewers,
   image-only UIs). Never on a loop.

The observation object is unified: `url`, `title`, `pageState`, `summary`,
`headings`, `landmarks`, `forms[]`, `tables[]`, `lists[]`, `dialogs[]`,
`errors[]`, `loading[]`, `images[]`, `paragraphs[]`, and interactive
`elements[]` with stable refs, disabled/checked flags, and bounding boxes.

Intelligent waiting (`companion_wait_for`) supports modes `selector`,
`visible`, `enabled`, `text`, `ready`, `dialog`, `dom-stable`.

Persistent state on `agent_sessions` (RLS-scoped, realtime-published):
`task_tree`, `timeline`, `tool_history`, `reasoning`, `observation_summary`,
`page_summary`, `browser_memory` (visitedUrls, previousSearches,
completedObjectives, currentObjective, knownTabs, notes), `waiting_status`,
`recovery_status`, `retry_count`, `screenshots`, `current_url`,
`active_tab_id`, `status` (planning/running/waiting/paused/completed/
failed/cancelled).

The Workspace subscribes to `postgres_changes` on `agent_sessions` and
renders every field live: task tree, reasoning, observation summary,
waiting status, recovery status, browser memory, screenshot log, timeline,
tool history, plus pause/resume/cancel controls.
