# OpenAgent — Vision

OpenAgent is a free, modular, open AI computer-use assistant. It should feel
like a fast, careful human collaborator that can drive a real browser (and,
later, a real desktop), plan multi-step goals, recover from failure, remember
what it has seen, and always answer to the user who owns it.

## Principles

- **Free & modular.** No paywall, no lock-in. Every capability is a module
  behind a clear interface so users can swap providers, disable a module,
  or bring their own.
- **User-owned.** All memory, sessions, files, and provider keys belong to
  the signed-in user. Row Level Security scopes every read and write.
- **Explicit permission.** Companion (browser/desktop) and any privileged
  action are opt-in per device and revocable at any time.
- **Observe → Think → Act → Verify.** The agent never guesses page state.
  It observes structured DOM first, uses vision only as fallback, and
  verifies every action against the next observation.
- **Deterministic guardrails.** Recovery, wait modes, backoff, and caps
  are enforced by the server — the model chooses the strategy, but the
  server bounds how far it can go.
- **Transparent.** The Workspace shows reasoning, timeline, tool history,
  browser memory, retry count, waiting/recovery state, and screenshots live.
- **Fast.** Simple, high-confidence actions take a fast path. Full
  reasoning is reserved for ambiguity or failure.

## Product shape

- **Chat** — natural conversation with tool use.
- **Workspace** — the live control center for autonomous sessions.
- **Tasks / Memory / Files** — persistent state the user owns.
- **Devices / Permissions / Providers / Plugins** — capability controls.
- **Companion extension** — the browser-side arm today; desktop companion
  arrives with Milestone 12.

## Non-goals (for now)

- Running arbitrary native binaries on the user's machine without a paired,
  signed companion.
- Storing user secrets or raw screenshots outside of RLS-scoped tables /
  buckets that the user controls.
- Silent background actions. Every meaningful step surfaces in the
  Workspace timeline.
