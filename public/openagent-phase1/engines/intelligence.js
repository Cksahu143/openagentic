// Intelligence Engine — single-step reasoning (Handbook Ch. 10).
// Heuristic pre-filter first: if the goal maps unambiguously to a single
// interactive element, act without calling the API. Otherwise call Anthropic
// with strict JSON schema output and prompt caching for the system portion.

const SYSTEM_PROMPT = `You are OpenAgent's Intelligence Engine, Phase 1.
You are given: (1) a plain-English task goal and (2) a compact perception snapshot of the current webpage.
Return EXACTLY ONE next action as JSON. Do not plan multiple steps ahead.

Return JSON with this schema:
{
  "action": {
    "type": "click" | "type" | "scroll" | "hover" | "submit" | "done",
    "ref": "oa123"  // required for click/type/hover/submit; omit for scroll/done
    "text": "string" // required for type
    "dy": number    // optional for scroll
    "hint": "string" // human-readable identifier of the target (name/label), for recovery
  },
  "confidence": 0.0-1.0,
  "prediction": {
    "kind": "urlContains" | "newElementNamed" | "fieldValueEquals" | "pageReady" | "textVisible",
    "value": "string",
    "ref": "oa123" // for fieldValueEquals
  },
  "rationale": "one short sentence"
}

Rules:
- Prefer elements with high viewport visibility and clear accessible names.
- If the task appears complete, return action.type = "done" with confidence and no prediction.
- If uncertain between multiple candidates, pick the one whose name best matches the goal and lower confidence.
- Never invent a ref that is not in the snapshot.`;

function heuristic(goal, snap) {
  const g = goal.toLowerCase();
  // Search intent
  const searchIntent = /^(search|find|look up|google)\s+(for\s+)?['"]?([^'"]+?)['"]?$/i.exec(goal);
  if (searchIntent) {
    const query = searchIntent[3].trim();
    const searchBox = snap.elements.find((e) =>
      /searchbox|input:search|input:text|textbox/.test(e.role)
      && /search|query/i.test((e.name || "") + " " + (e.role || ""))
      && e.viewport
    );
    if (searchBox) {
      return {
        action: { type: "type", ref: searchBox.ref, text: query, hint: searchBox.name },
        confidence: 0.9,
        prediction: { kind: "fieldValueEquals", ref: searchBox.ref, value: query },
        rationale: "Heuristic: unique search box matches goal.",
        via: "heuristic",
      };
    }
  }
  // Click-a-labelled-button intent, e.g. "click the Submit button"
  const clickIntent = /click(?:\s+the)?\s+["']?([^"']+?)["']?(?:\s+(?:button|link))?$/i.exec(goal);
  if (clickIntent) {
    const want = clickIntent[1].toLowerCase().trim();
    const matches = snap.elements.filter((e) => (e.name || "").toLowerCase().includes(want) && e.viewport && /button|link|input/.test(e.role));
    if (matches.length === 1) {
      return {
        action: { type: "click", ref: matches[0].ref, hint: matches[0].name },
        confidence: 0.88,
        prediction: { kind: "urlContains", value: location.origin ? "" : "" }, // will fall through to structural check
        rationale: "Heuristic: single unambiguous target matches goal.",
        via: "heuristic",
      };
    }
  }
  return null;
}

async function callAnthropic(apiKey, model, goal, snap) {
  const compact = {
    url: snap.url, title: snap.title, pageState: snap.pageState, summary: snap.summary,
    headings: snap.headings,
    dialogs: snap.dialogs,
    elements: snap.elements.slice(0, 60).map((e) => ({
      ref: e.ref, role: e.role, name: e.name, value: e.value,
      disabled: e.disabled, viewport: e.viewport, occluded: e.occluded,
    })),
  };
  const body = {
    model,
    max_tokens: 512,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      { role: "user", content: `TASK GOAL: ${goal}\n\nPERCEPTION:\n${JSON.stringify(compact)}` },
    ],
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
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.map((c) => c.text || "").join("") || "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON in response");
  const parsed = JSON.parse(text.slice(start, end + 1));
  return { ...parsed, via: "anthropic" };
}

/**
 * @param {object} opts { goal, snapshot, apiKey, model }
 * @returns {Promise<{action, confidence, prediction?, rationale, via}>}
 */
export async function reason(opts) {
  const { goal, snapshot: snap, apiKey, model = "claude-sonnet-4-5" } = opts;
  const heur = heuristic(goal, snap);
  if (heur) return heur;
  if (!apiKey) {
    // Fallback: return best-guess first viewport interactive
    const el = snap.elements.find((e) => e.viewport) || snap.elements[0];
    if (!el) throw new Error("no interactive elements and no API key");
    return {
      action: { type: "click", ref: el.ref, hint: el.name },
      confidence: 0.25,
      prediction: { kind: "textVisible", value: el.name || "" },
      rationale: "No API key; guessed first viewport target.",
      via: "fallback",
    };
  }
  // 2-strike malformed retry
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      return await callAnthropic(apiKey, model, goal, snap);
    } catch (e) { lastErr = e; }
  }
  // Fallback heuristic: pick a plausible viewport element
  const el = snap.elements.find((e) => e.viewport) || snap.elements[0];
  if (!el) throw lastErr || new Error("no elements");
  return {
    action: { type: "click", ref: el.ref, hint: el.name },
    confidence: 0.2,
    prediction: { kind: "textVisible", value: el.name || "" },
    rationale: `API failed twice (${String(lastErr?.message || lastErr)}); falling back.`,
    via: "fallback",
  };
}
