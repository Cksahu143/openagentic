// Recovery Engine — rungs 1–4 only (Handbook Ch. 15). Rung 8 = escalate stub.
// Runs on the content side so it can touch the DOM directly.

import { snapshot } from "./perception.js";
import { execute } from "./action.js";

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const COOKIE_TEXTS = [
  /^(accept|agree|allow|got it|ok|okay|i understand|continue|dismiss|reject all|only necessary|accept all)$/i,
];
const COOKIE_ROLES = ["button", "link"];

async function tryDismissInterruption() {
  const snap = snapshot();
  // Prefer dialogs first
  const cand = snap.elements.filter((e) => COOKIE_ROLES.some((r) => e.role.startsWith(r)))
    .filter((e) => COOKIE_TEXTS.some((rx) => rx.test((e.name || "").trim())));
  if (!cand.length) return { ok: false, note: "no interruption match" };
  try {
    await execute({ type: "click", ref: cand[0].ref });
    return { ok: true, note: `dismissed via ${cand[0].name}` };
  } catch (e) {
    return { ok: false, note: String(e?.message || e) };
  }
}

async function tryAlternateResolve(context) {
  // context.prediction and context.command contain the failed action.
  const snap = snapshot();
  const wanted = (context?.command?.hint || context?.command?.text || "").toLowerCase();
  if (!wanted) return { ok: false, note: "no hint to resolve" };
  const match = snap.elements.find((e) => (e.name || "").toLowerCase().includes(wanted));
  if (!match) return { ok: false, note: "no alternate element" };
  return { ok: true, note: `alternate ref: ${match.ref}`, ref: match.ref };
}

async function tryBoundedWait() {
  const deadline = Date.now() + 3000;
  let last = document.documentElement.outerHTML.length;
  let stable = 0;
  while (Date.now() < deadline) {
    await sleep(200);
    const now = document.documentElement.outerHTML.length;
    if (Math.abs(now - last) < 200) stable++; else stable = 0;
    last = now;
    if (stable >= 3 && document.readyState === "complete") return { ok: true, note: "dom stable" };
  }
  return { ok: false, note: "wait timeout" };
}

export async function attemptRecovery(rung, context) {
  if (rung === 1) { const s = snapshot(); return { ok: true, note: "re-perceived", snapshot: s }; }
  if (rung === 2) return tryAlternateResolve(context);
  if (rung === 3) return tryDismissInterruption();
  if (rung === 4) return tryBoundedWait();
  return { ok: false, note: `rung ${rung} not implemented in phase 1` };
}
