// Prediction Engine — predicts the next observable state after an action,
// so verification can confirm cheaply without a second reasoning call.

/**
 * Given a planned action + the current perception snapshot, produce a
 * lightweight prediction the Verification engine can check.
 */
export function predict(action, snap) {
  const el = action?.ref ? snap.elements.find((e) => e.ref === action.ref) : null;
  switch (action.type) {
    case "type":
      return { kind: "fieldValueEquals", ref: action.ref, value: action.text ?? "" };
    case "submit":
      return { kind: "pageReady", value: "" };
    case "click": {
      if (el?.href) {
        try {
          const u = new URL(el.href, snap.url);
          return { kind: "urlContains", value: u.pathname || u.host };
        } catch { /* fall-through */ }
      }
      if (el?.role === "button" && /submit|search|go|send/i.test(el.name || "")) {
        return { kind: "pageReady", value: "" };
      }
      return { kind: "textVisible", value: el?.name || "" };
    }
    case "scroll":
      return { kind: "pageReady", value: "" };
    case "hover":
      return { kind: "textVisible", value: el?.name || "" };
    default:
      return { kind: "pageReady", value: "" };
  }
}

/**
 * Estimate whether an action is "risky enough" to require a verify pass.
 * Batched execution uses this to skip verification for safe, deterministic steps.
 */
export function isCheckpoint(action, el) {
  if (!action) return true;
  if (action.type === "submit" || action.type === "click" && el?.href) return true; // navigation
  if (action.type === "click" && el && /submit|checkout|pay|delete|remove|confirm|logout|sign/i.test(el.name || "")) return true;
  if (action.type === "scroll") return false;
  if (action.type === "hover") return false;
  return false;
}
