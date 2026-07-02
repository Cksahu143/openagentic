# OpenAgent Phase 1

A standalone Chrome extension implementing the PRPAVL loop (Perceive → Reason
→ Plan → Act → Verify → Learn) per the OpenAgent Engineering Handbook. This is
**Phase 1 only** — Memory, Workflow lookahead, Trust rationale, Personalization,
Recovery rungs 5–8, multi-tab/subagents, and Desktop/Mobile companions are
explicitly out of scope and deferred to Phase 2.

## Install

1. Open `chrome://extensions`, enable Developer Mode.
2. Click **Load unpacked** and select this `public/openagent-phase1/` folder.
3. Click the extension's toolbar icon — the Workspace side panel opens.
4. In Settings, paste your Anthropic API key (`sk-ant-...`) and Save. The
   heuristic pre-filter will handle single-target tasks without calling the
   API; the API is used only for ambiguous pages.

## Try it

Open `public/openagent-phase1/tests/test-form.html` (drag into Chrome) and try:

- `search for openagent` — should use the heuristic path, type into the search
  box, verify the value, and stop.
- `click the Submit button` — the fake cookie banner covers it; rung-3 recovery
  should dismiss the banner and the click should then succeed.
- `click Delete Account` — the guardrail should block and require confirmation.

## Files

| Path | Role |
|---|---|
| `manifest.json` | MV3 manifest |
| `shared/event-bus.js` | typed pub/sub with cross-context bridge |
| `shared/schemas.js` | envelope validation |
| `engines/perception.js` | DOM+AX snapshot (content) |
| `engines/action.js` | real event dispatch (content) |
| `engines/verification.js` | 3-pass verifier (content) |
| `engines/recovery.js` | rungs 1–4 (content) |
| `engines/guardrail.js` | fail-closed gate (worker) |
| `engines/intelligence.js` | heuristic + Anthropic call (worker) |
| `engines/orchestrator.js` | PRPAVL state machine (worker) |
| `content/cursor.{js,css}` | AI cursor overlay |
| `content/content.js` | content-script entry + RPC |
| `background/service-worker.js` | worker entry |
| `sidepanel/*` | Workspace side panel UI |
| `tests/event-bus.test.js` | unit test (run with `node`) |
| `tests/test-form.html` | fault-injection page |

## Latency budgets

The Orchestrator records p50/p95 per PRPAVL phase and shows them in the
Workspace footer after each task. Handbook budgets (Ch. 29 p95): perceive
150ms, reason 400ms (heuristic bypass counts as ~0), act-dispatch 20ms,
verify 100ms. Report deviations back — the Anthropic call is the expected
long pole when the heuristic can't match.

## Deviations from the plan

- Written in plain ES modules instead of TypeScript, and the side panel is
  vanilla JS instead of React, to avoid shipping a bundler with the extension.
  The behavior contract in the Handbook is unchanged.
- Cross-context Event Bus forwarding relies on `chrome.runtime.sendMessage`
  best-effort broadcasting; if the panel is closed the worker still works.
