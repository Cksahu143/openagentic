# OpenAgent — Milestone Plan

Build incrementally. Never rewrite working code; each milestone improves the
previous one.

## ✅ Milestone 1 — Foundation (this milestone)
- Project architecture and module registry
- Responsive UI shell (sidebar + header + main)
- Dashboard with module status
- Threaded chat layout (DB-backed, placeholder replies)
- Tasks · Settings · Permissions · Devices · Providers · Logs pages
- Auth: email/password + Google (Lovable Cloud managed)
- Database: profiles, user_roles, conversations, messages, user_settings,
  tasks, permission_grants, activity_logs
- Module interface contracts under `src/modules/*` (stubs only)
- Docs: architecture, milestones, modules

## ✅ Milestone 2 — Memory & Tasks
- `tasks`, `memory`, `logs` modules wired to the database.
- New `memories` table (workflow, preference, site, note, fact).
- Memory page: add / pin / remove entries.
- Tasks page: create / cancel goals; statuses update through the module API.
- Every module mutation writes a row to `activity_logs` via `lib/logger.ts`.

## ✅ Milestone 3 — AI Planner
- Lovable AI Gateway provider helper (`lib/ai-gateway.server.ts`).
- `/api/chat` TanStack server route streams via AI SDK (`streamText`,
  `convertToModelMessages`, `toUIMessageStreamResponse`).
- Chat UI uses `useChat` + `DefaultChatTransport`, renders `message.parts`
  with markdown, persists assistant messages (parts included) on finish.
- Tools: `save_memory`, `create_task` — applied client-side by the planner
  loop so the agent can remember things and track goals from chat.

## ✅ Milestone 4 — Browser-lite & Code Runner
- Server-side `fetchUrl` helper (title, readable text, status, outgoing
  links, redirect chain) with SSRF guard + 15s / 1.5MB caps.
- Sandboxed JS code runner (`runJs`) with 5s timeout and captured console.
- Both wired into `/api/chat` as server-executing tools (`fetch_url`,
  `run_code`) so the planner can do real research, link/health checks,
  and quick computations end-to-end.

## ✅ Milestone 5 — Files, BYO providers & sub-AI
- Private per-user storage bucket `user-files` with RLS scoped to the
  user's folder. `files` module + Files page (create / view / download /
  delete). Planner can `write_file`, `read_file`, `list_files`.
- BYO provider keys: `provider_keys` table + Providers UI to add OpenAI,
  Anthropic, OpenRouter or custom OpenAI-compatible endpoints. Lovable
  AI remains the zero-config default.
- `ask_ai` tool: agent can delegate sub-prompts to another model on the
  Lovable AI Gateway (user needs no key of their own).


## ⏳ Milestone 6 — Local Companion
- Installable desktop app with signed loopback channel
- Pairing via one-time code; per-device tokens
- Accessibility tree, keyboard/mouse, window management, file access

## ⏳ Milestone 7 — Plugin System & Cloud Sync
- Sandboxed plugin manifests with declared tools and scopes
- Cross-device sync of conversations, tasks, workflows
- Mobile-friendly dashboard polish

## Working rules

- Never rewrite — improve.
- Every milestone closes with: tests, docs, and a changelog entry.
- No silent capability creep. New scopes require an explicit grant UI.
