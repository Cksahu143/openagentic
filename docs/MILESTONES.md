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

## ⏳ Milestone 2 — Memory & Tasks
- Wire `tasks`, `memory`, `logs` modules to DB
- Saved workflows, preferences, frequent sites
- Real activity log on every module action

## ⏳ Milestone 3 — AI Planner
- Goal → observe → plan → act loop via Lovable AI Gateway
- Streaming chat replies (AI SDK + TanStack server route)
- Tool-call rendering, retries, plan inspection

## ⏳ Milestone 4 — Browser Controller
- Server-side browser automation (open, navigate, read DOM, click, fill)
- Tabs, downloads/uploads, simple error recovery
- New permission scopes: `browser:navigate`, `browser:interact`

## ⏳ Milestone 5 — Files & BYO Providers
- File manager with explicit per-path grants
- Bring-your-own API keys (Anthropic, OpenRouter, custom endpoints)

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
