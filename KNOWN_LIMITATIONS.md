# OpenAgent — Known Limitations

Current as of Milestone 9 completion pass.

## Autonomy
- Recovery is model-driven, not deterministic — the LLM decides when to
  retry. `record_recovery` bumps a counter and updates the Workspace, but
  there is no hard cap enforced by the server.
- Pause takes effect at tool-call boundaries; an in-flight companion
  command (e.g. `navigate` waiting for `complete`) finishes before pause
  can stop it.
- Cancelled sessions still leave the companion overlay on the last tab
  until the extension's next idle poll (~6 s).

## Observation
- `companion_observe` samples up to 120 interactive elements and short
  buckets of headings/paragraphs/etc. Very large SPAs may exceed those
  limits — the agent should scroll and re-observe.
- ARIA data is extracted from the DOM; there is no separate accessibility
  tree read (that lands with the desktop companion in M12).
- Vision fallback captures the visible viewport only, JPEG at ~55 quality.
  Full-page screenshots are not supported by `chrome.tabs.captureVisibleTab`.
- Screenshot history stores metadata + a short visual summary; raw JPEG
  data is NOT persisted in Postgres (kept as a transient tool result).
- No network-idle wait mode: the extension does not have webRequest
  permission by design, so `wait_for` uses DOM signals + `readyState`
  instead.

## Sessions
- Task tree is capped to 20 steps per `plan_session` call. Long runs must
  update / expand the tree via `update_step` and additional planning.
- Timeline trims to last 200 events, tool history to last 100, screenshots
  to last 30 per session.
- Browser memory arrays are unioned and capped at 100 entries per key.
- Multi-session orchestration (concurrent sessions per user with a queue)
  is not yet implemented — that is Milestone 11.

## Workspace
- Realtime relies on `postgres_changes`; if the WebSocket drops, the UI
  reflects the latest `SELECT` on reload. There is no per-panel diff.
- Screenshot log shows the visual summary + metadata; the raw image is
  only available as a tool result during the turn it was captured.

## Companion Extension
- Manifest V3 alarms floor is 30 s in production; the extension uses
  0.1 min (6 s) plus chain-polling for a snappier feel. Chrome may still
  slow the service worker under battery-saver.
- Cannot control `chrome://`, `edge://`, or the Chrome Web Store pages
  (browser-enforced).
- No support yet for iframes with cross-origin content — observation and
  interaction run in the top document only.
- Screenshot capture requires the tab to be in the currently focused
  window; background windows may return `null` from
  `captureVisibleTab`.

## Security
- All companion capabilities are gated by explicit device pairing. Once
  paired, any authenticated OpenAgent session with the same user can enqueue
  commands. Fine-grained per-action approval (M18) will replace this.
