# OpenAgent

A free, modular AI computer assistant. Helps users complete tasks on
websites and — with explicit permission, through a secure local companion —
on the desktop.

> **Status: Milestone 1 (Foundation).** Architecture, UI shell, auth, DB and
> module interface contracts are in place. Browser automation, desktop
> automation and AI planning land in later milestones.

## Stack

- TanStack Start (React 19, Vite 7)
- Tailwind v4 + shadcn/ui (dark technical theme)
- Lovable Cloud (Postgres + Auth + Edge)
- TanStack Query for data
- Modular `src/modules/*` interfaces

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Milestone plan](./docs/MILESTONES.md)
- [Module contracts](./docs/MODULES.md)

## Routes

| Path                | Purpose                              |
| ------------------- | ------------------------------------ |
| `/`                 | Landing                              |
| `/auth`             | Sign in / sign up (email + Google)   |
| `/dashboard`        | Module status + KPIs                 |
| `/chat`             | Conversation list                    |
| `/chat/$threadId`   | Threaded chat                        |
| `/tasks`            | Task history                         |
| `/settings`         | Profile + workspace                  |
| `/permissions`      | Capability grants                    |
| `/devices`          | Local companion pairings             |
| `/providers`        | AI provider config                   |
| `/logs`             | Activity audit log                   |

## Development rules

- Never rewrite working code — improve it.
- All colors via design tokens; never hardcode hex / `text-white` in JSX.
- Modules expose interfaces and never import each other directly.
- Every privileged action must go through the permission manager.
