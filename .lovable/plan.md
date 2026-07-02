## OpenAgent Phase 1 — Chrome Extension Rebuild

This is a large, self-contained build. Phase 1 is a **new standalone Chrome extension** implementing the PRPAVL loop (Perceive → Reason → Plan → Act → Verify → Learn) with all seven engines scoped down per the Handbook. The existing `public/companion-extension/` stays untouched — Phase 1 lives at `public/openagent-phase1/` and ships as its own unpacked extension + zip.

### Deliverables

New extension at `public/openagent-phase1/` with Manifest V3, side-panel Workspace, service worker, content script, AI cursor overlay, and typed Event Bus.

### File layout

```text
public/openagent-phase1/
  manifest.json
  icon.png (reuse)
  background/
    service-worker.ts → service-worker.js (bundled)
  content/
    content.ts → content.js
    cursor.ts (AI cursor overlay)
  sidepanel/
    index.html
    sidepanel.tsx → sidepanel.js
  shared/
    event-bus.ts
    schemas.ts (zod)
    types.ts
  engines/
    perception.ts       (content-side, DOM+AX snapshot, mutation observer, viewport-first)
    action.ts           (content-side, real event sequences, human timing)
    verification.ts     (content-side, 3-pass comparator)
    intelligence.ts     (worker-side, Anthropic call + heuristic pre-filter)
    orchestrator.ts     (worker-side, PRPAVL state machine, timeouts)
    recovery.ts         (worker-side, rungs 1–4)
    guardrail.ts        (worker-side, fail-closed sync gate)
  tests/
    event-bus.test.ts
    action-events.test.html
```

### Build order (mirrors prompt §3)

1. **Extension shell** — manifest MV3, side_panel, activeTab, toolbar action opens panel. Vite build config producing IIFE bundles for content + worker, and a React bundle for the side panel.
2. **Event Bus** — typed pub/sub, zod-validated envelopes `{type, timestamp, correlationId, payload}`. Runs in-process per context; cross-context traffic (content↔worker↔panel) uses `chrome.runtime` messages that the bus wraps transparently. Unit test with a fake event.
3. **Perception** — content-script extractor: simplified DOM tree, ARIA/role/name, computed-visibility filter (not just `display:none`; also `visibility`, `opacity`, `pointer-events`, bounding rect, and `elementFromPoint` occlusion). Debounced (~75ms) MutationObserver; incremental diff cache keyed by stable refs; viewport-first with off-screen fallback. Publishes `perception.snapshot.ready`.
4. **Action** — command dispatcher: `ClickCommand`, `TypeCommand`, `ScrollCommand`, `HoverCommand`. Real event sequences (pointerdown/mousedown/mouseup/click; keydown/beforeinput/input/keyup with `InputEvent` for React controlled inputs). Eased movement + per-key variable delay at low end of Ch. 8.3.
5. **AI cursor** — DOM overlay driven by `action.dispatch.requested` / `action.completed` timestamps; state machine idle→thinking→moving→hovering→acting→verify→success/error; visibility toggle persisted in `chrome.storage.local`.
6. **Guardrail** — synchronous fail-closed gate subscribed to `action.dispatch.requested`. Blocks: payment-form fields (`autocomplete=cc-*`), destructive text matches, cross-scope form submits. Publishes `guardrail.blocked` → panel confirm/deny.
7. **Intelligence** — worker-side. Heuristic pre-filter first: if exactly one interactive element unambiguously matches the goal's target (label/role/name match), skip API and return it. Otherwise Anthropic `claude-sonnet-4-6` call with prompt caching for system prompt, strict JSON schema output, 2-strike malformed fallback to heuristic.
8. **Verification** — content-side, 3-pass: structural diff (subtree hash), targeted predicted-delta check (URL/attr/value/text as the prediction states), anomaly scan (new dialogs, error toasts). Verdict `confirmed|unconfirmed|contradicted`.
9. **Orchestrator** — worker-side PRPAVL state machine, per-phase timeouts (150/400/20/100 ms plus generous act-execution window). Escalates to Workspace after 3 consecutive recovery failures on the same step. Learn phase logs the tuple to `chrome.storage.local` (no Memory engine yet).
10. **Recovery** — rungs 1 (re-perceive+retry), 2 (alternate resolver: switch from selector→ARIA name→text→role), 3 (dismiss interruption: known cookie-banner + generic modal dismiss), 4 (bounded wait ≤3s for DOM-stable + re-check). Rung 8 = escalate stub.
11. **Workspace side panel** — React, read-only Event Bus subscriber via `chrome.runtime` port. Live timeline (one row per PRPAVL step, plain-language action + confidence + verdict), Pause/Resume/Cancel, guardrail confirm dialog. No replay, no multi-task, no expander.

### Latency instrumentation

Each phase records `performance.now()` deltas into a ring buffer. On task completion, worker computes p50/p95 per phase and posts to the side panel; also written to `chrome.storage.local` for inspection.

### Anthropic key

Requested via `add_secret` as `ANTHROPIC_API_KEY` before the Intelligence step is wired. Read only in the service worker; never in content or panel.

### Out of scope (stub-only or omitted, per prompt §1)

Memory & Experience, Workflow lookahead, Recovery rungs 5–8, Trust rationale, Personalization, HITL queue, Desktop/Mobile companion, subagents, multi-tab.

### Acceptance verification

Manual since it needs a paired browser: I'll ship a test page (`public/openagent-phase1/tests/test-form.html`) with a React-controlled input + a fake cookie banner + a decoy button to cover: real event dispatch, rung-3 recovery, and contradicted-verdict detection. Report p95 numbers from a real run once you've loaded the extension.
