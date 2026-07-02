// Orchestrator Engine — strict single-step PRPAVL loop (Handbook Ch. 9).
// Runs in the service worker. Talks to the content script via chrome.tabs.sendMessage
// RPCs. Fires bus events for the panel to render.

import { publish } from "../shared/event-bus.js";
import { reason } from "./intelligence.js";
import { checkGuardrail } from "./guardrail.js";

const state = {
  running: false,
  paused: false,
  cancel: false,
  tabId: null,
  goal: "",
  scopeHost: "",
  steps: 0,
  correlationId: null,
  metrics: [], // { step, phase, ms }
  pendingConfirm: null, // { command, resolve }
  awaitingConfirmation: false,
  consecutiveRecovery: 0,
};

function rpc(tabId, msg, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("content rpc timeout")), timeoutMs);
    chrome.tabs.sendMessage(tabId, { __rpc: 1, ...msg }, (resp) => {
      clearTimeout(to);
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!resp?.ok) return reject(new Error(resp?.error || "rpc failed"));
      resolve(resp);
    });
  });
}

async function timed(phase, fn) {
  const t0 = performance.now();
  try { return await fn(); }
  finally {
    const ms = performance.now() - t0;
    state.metrics.push({ step: state.steps, phase, ms });
    publish("metrics", { step: state.steps, phase, ms });
  }
}

async function waitWhilePaused() {
  while (state.paused && !state.cancel) await new Promise((r) => setTimeout(r, 100));
}

async function guardrailGate(command, targetElement, currentHost, correlationId) {
  const check = checkGuardrail({
    command, targetElement, taskScopeHost: state.scopeHost, currentHost,
  });
  if (check.allowed) return true;
  publish("guardrail.blocked", { command, reason: check.reason, targetElement }, correlationId);
  state.awaitingConfirmation = true;
  const decision = await new Promise((resolve) => { state.pendingConfirm = { resolve }; });
  state.awaitingConfirmation = false;
  state.pendingConfirm = null;
  if (decision === "approve") {
    publish("guardrail.approved", { command }, correlationId);
    return true;
  }
  publish("guardrail.denied", { command }, correlationId);
  return false;
}

export function respondToConfirmation(decision) {
  if (state.pendingConfirm) state.pendingConfirm.resolve(decision);
}

export function pause() { state.paused = true; publish("log", { msg: "paused" }); }
export function resume() { state.paused = false; publish("log", { msg: "resumed" }); }
export function cancel() { state.cancel = true; publish("log", { msg: "cancel requested" }); }

export async function runTask({ tabId, goal, apiKey, model }) {
  if (state.running) throw new Error("task already running");
  Object.assign(state, {
    running: true, paused: false, cancel: false, tabId, goal,
    steps: 0, metrics: [], correlationId: crypto.randomUUID(),
    consecutiveRecovery: 0,
  });
  try {
    const url = (await chrome.tabs.get(tabId)).url || "";
    state.scopeHost = new URL(url).host;
  } catch { state.scopeHost = ""; }

  publish("task.start", { goal, tabId, scopeHost: state.scopeHost }, state.correlationId);

  try {
    for (let step = 1; step <= 25; step++) {
      if (state.cancel) { publish("task.completed", { reason: "cancelled", step }); return; }
      await waitWhilePaused();
      state.steps = step;

      // PERCEIVE
      const preResp = await timed("perceive", () => rpc(tabId, { op: "snapshot" }));
      const preSnap = preResp.snapshot;

      // REASON + PLAN (single-step)
      const decision = await timed("reason", () => reason({ goal, snapshot: preSnap, apiKey, model }));
      publish("reason.result", { step, decision });

      if (decision.action.type === "done") {
        publish("task.completed", { reason: "model-said-done", step, confidence: decision.confidence });
        return;
      }

      // GUARDRAIL
      const target = preSnap.elements.find((e) => e.ref === decision.action.ref);
      const currentHost = new URL(preSnap.url).host;
      const ok = await guardrailGate(decision.action, target, currentHost, state.correlationId);
      if (!ok) { publish("task.escalated", { step, reason: "guardrail-denied" }); return; }

      // ACT + VERIFY (verify runs in content-side after act)
      await timed("act-dispatch", () => Promise.resolve());
      const actResp = await timed("act+verify", () =>
        rpc(tabId, { op: "act", command: decision.action, prediction: decision.prediction }, 30000)
      );
      const verification = actResp.verification;
      publish("verification.result", { step, verification, prediction: decision.prediction });

      // LEARN (Phase 1: log tuple to storage; no Memory engine yet)
      const learnTuple = { step, goal, action: decision.action, prediction: decision.prediction, verdict: verification.verdict, at: Date.now() };
      chrome.storage.local.get(["oa_learn_log"], (v) => {
        const arr = v.oa_learn_log || [];
        arr.push(learnTuple);
        chrome.storage.local.set({ oa_learn_log: arr.slice(-500) });
      });

      // RECOVER if needed
      if (verification.verdict === "contradicted" || verification.verdict === "unconfirmed") {
        state.consecutiveRecovery += 1;
        let recovered = false;
        for (const rung of [3, 4, 1, 2]) {
          if (state.cancel) break;
          publish("recovery.attempt", { step, rung });
          const rec = await rpc(tabId, { op: "recover", rung, context: { command: decision.action } }).catch((e) => ({ ok: false, note: String(e?.message || e) }));
          publish("recovery.result", { step, rung, ...rec });
          if (rec.ok) { recovered = true; break; }
        }
        if (!recovered && state.consecutiveRecovery >= 3) {
          publish("task.escalated", { step, reason: "recovery-exhausted" });
          return;
        }
      } else {
        state.consecutiveRecovery = 0;
      }
    }
    publish("task.completed", { reason: "max-steps", step: state.steps });
  } catch (e) {
    publish("log", { level: "error", msg: String(e?.message || e) });
    publish("task.escalated", { reason: "exception", error: String(e?.message || e) });
  } finally {
    // Emit percentile summary
    const byPhase = {};
    for (const m of state.metrics) (byPhase[m.phase] ||= []).push(m.ms);
    const pctl = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
    const summary = Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, { p50: Math.round(pctl(v, 0.5)), p95: Math.round(pctl(v, 0.95)), n: v.length }]));
    publish("metrics", { summary });
    chrome.storage.local.set({ oa_last_metrics: summary });
    state.running = false;
  }
}
