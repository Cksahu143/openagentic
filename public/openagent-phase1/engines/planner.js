// Planner subagent — plans a short workflow (1-4 actions) from a single
// reasoning call, so we can execute → verify at checkpoints instead of
// think→act→think→act. Falls back to single-step decision if the model
// declines to plan.

const PLANNER_SYSTEM = `You are OpenAgent's Planner subagent.
Given a task goal and a compact perception snapshot, return a SHORT workflow
(1 to 4 sequential actions) plus a per-action prediction for verification.

Return JSON:
{
  "workflow": [
    { "action": { "type": "click|type|scroll|hover|submit|done", "ref": "oa123", "text": "...", "dy": 400, "hint": "..." },
      "prediction": { "kind": "urlContains|newElementNamed|fieldValueEquals|pageReady|textVisible", "value": "...", "ref": "oa123" },
      "checkpoint": true }
  ],
  "confidence": 0.0-1.0,
  "rationale": "one short sentence"
}

Rules:
- Only reference elements present in the snapshot.
- Set "checkpoint": true for the LAST action, for any navigation, and for any
  risky action (submit, delete, checkout, sign in/out). Non-checkpoint actions
  are safe to execute in a batch without between-step verification.
- If uncertain about later steps, return only the first 1-2 confident actions.
- If nothing to do, return workflow: [{ "action": { "type": "done" }, "checkpoint": true }].`;

async function callAnthropic(apiKey, model, goal, snap) {
  const compact = {
    url: snap.url, title: snap.title, pageState: snap.pageState, summary: snap.summary,
    headings: snap.headings, dialogs: snap.dialogs,
    elements: snap.elements.slice(0, 60).map((e) => ({
      ref: e.ref, role: e.role, name: e.name, value: e.value,
      disabled: e.disabled, viewport: e.viewport, occluded: e.occluded,
    })),
  };
  const body = {
    model,
    max_tokens: 900,
    system: [{ type: "text", text: PLANNER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `TASK GOAL: ${goal}\n\nPERCEPTION:\n${JSON.stringify(compact)}` }],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`anthropic planner ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.map((c) => c.text || "").join("") || "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON in planner response");
  return JSON.parse(text.slice(start, end + 1));
}

/** Plan up to N steps ahead. Returns { workflow, confidence, rationale, via }. */
export async function plan({ goal, snapshot: snap, apiKey, model = "claude-sonnet-4-5" }) {
  if (!apiKey) return null;
  try {
    const out = await callAnthropic(apiKey, model, goal, snap);
    if (!out?.workflow?.length) return null;
    // Sanitize: only accept refs that exist in snapshot, cap length.
    const refs = new Set(snap.elements.map((e) => e.ref));
    const workflow = out.workflow.slice(0, 4).filter((s) => {
      if (!s?.action) return false;
      if (s.action.type === "done") return true;
      if (s.action.type === "scroll") return true;
      return !s.action.ref || refs.has(s.action.ref);
    });
    if (!workflow.length) return null;
    // Force last step to be a checkpoint
    workflow[workflow.length - 1].checkpoint = true;
    return { workflow, confidence: out.confidence ?? 0.6, rationale: out.rationale || "", via: "planner" };
  } catch {
    return null;
  }
}
