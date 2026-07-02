// Guardrail Engine — minimal Phase-1 rule set (Handbook Ch. 26).
// Fail-closed synchronous gate. Runs in the service worker before any
// action.dispatch is allowed to reach the content script.

const DESTRUCTIVE_TEXT = /(delete|remove|cancel subscription|unsubscribe|wipe|erase)/i;

/**
 * @param {{command: object, targetElement?: {name?:string, role?:string, autocomplete?:string}, taskScopeHost?: string, currentHost: string}} ctx
 * @returns {{allowed: boolean, reason?: string, requireConfirm?: boolean}}
 */
export function checkGuardrail(ctx) {
  const { command, targetElement, taskScopeHost, currentHost } = ctx;

  // Payment fields
  const ac = (targetElement?.autocomplete || "").toLowerCase();
  if (ac.startsWith("cc-") || ac === "cc-number" || /payment|credit.?card|cvv/i.test(targetElement?.name || "")) {
    return { allowed: false, requireConfirm: true, reason: "Target looks like a payment field" };
  }

  // Destructive text
  if (command.type === "click" && DESTRUCTIVE_TEXT.test(targetElement?.name || "")) {
    return { allowed: false, requireConfirm: true, reason: `Destructive action: "${targetElement?.name}"` };
  }

  // Cross-scope form submit
  if (command.type === "submit" && taskScopeHost && currentHost && taskScopeHost !== currentHost) {
    return { allowed: false, requireConfirm: true, reason: `Submitting form on ${currentHost} (task scope: ${taskScopeHost})` };
  }

  return { allowed: true };
}
