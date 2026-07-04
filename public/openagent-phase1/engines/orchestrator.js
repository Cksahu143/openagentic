// Orchestrator Engine — PRPAVL loop with Planner batching, Experience-Memory
// replay, adaptive verification, and error recovery. Runs in the service worker.

import { publish } from "../shared/event-bus.js";
import { reason } from "./intelligence.js";
import { plan as planWorkflow } from "./planner.js";
import { checkGuardrail } from "./guardrail.js";
import { lookup as expLookup, record as expRecord, pruneWorkflow } from "./experience.js";
import { predict } from "./predictor.js";
import { normalizeGoal } from "../shared/goal-normalize.js";
import * as metrics from "./metrics.js";

const state = {
  running: false, paused: false, cancel: false,
  tabId: null, goal: "", scopeHost: "",
  steps: 0, correlationId: null,
  pendingConfirm: null, awaitingConfirmation: false,
  consecutiveRecovery: 0,
  executed: [], // for learning
  startedAt: 0,
  experienceHit: null,
  confidence: 0,
};

function rpc(tabId, msg, timeoutMs = 20000) {
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

async function waitWhilePaused() {
  while (state.paused && !state.cancel) await new Promise((r) => setTimeout(r, 100));
}

async function guardrailGate(command, targetElement, currentHost, correlationId) {
  const check = checkGuardrail({ command, targetElement, taskScopeHost: state.scopeHost, currentHost });
  if (check.allowed) return true;
  publish("guardrail.blocked", { command, reason: check.reason, targetElement }, correlationId);
  state.awaitingConfirmation = true;
  const decision = await new Promise((resolve) => { state.pendingConfirm = { resolve }; });
  state.awaitingConfirmation = false;
  state.pendingConfirm = null;
  if (decision === "approve") { publish("guardrail.approved", { command }, correlationId); return true; }
  publish("guardrail.denied", { command }, correlationId);
  return false;
}

export function respondToConfirmation(decision) {
  if (state.pendingConfirm) state.pendingConfirm.resolve(decision);
}
export function pause() { state.paused = true; publish("log", { msg: "paused" }); }
export function resume() { state.paused = false; publish("log", { msg: "resumed" }); }
export function cancel() { state.cancel = true; publish("log", { msg: "cancel requested" }); }

/**
 * Try replaying a stored experience workflow.
 * Returns { ok, preSnap } — preSnap is handed back so planAndRun can skip its
 * first perceive call when replay was compatible but chose to bail out.
 */
async function tryExperienceReplay(exp, tabId) {
  if (!exp?.workflow?.length || exp.confidence < 0.6) return { ok: false, preSnap: null };
  publish("experience.replay", { key: exp.key, confidence: exp.confidence, avgMs: exp.avgMs, workflow: exp.workflow });
  state.experienceHit = exp;
  const pre = await rpc(tabId, { op: "snapshot" });
  const refs = new Set(pre.snapshot.elements.map((e) => e.ref));
  const compatible = exp.workflow.every((s) => !s.action?.ref || refs.has(s.action.ref));
  if (!compatible) {
    publish("experience.miss", { reason: "stale-refs" });
    return { ok: false, preSnap: pre.snapshot };
  }
  for (const step of exp.workflow) {
    if (!step?.action) continue;
    const target = step.action.ref ? pre.snapshot.elements.find((e) => e.ref === step.action.ref) : null;
    const ok = await guardrailGate(step.action, target, new URL(pre.snapshot.url).host, state.correlationId);
    if (!ok) return { ok: false, preSnap: pre.snapshot };
  }
  const resp = await rpc(tabId, { op: "batch", workflow: exp.workflow }, 45000);
  const allOk = resp.results.every((r) => r.verification.verdict !== "contradicted");
  state.executed = resp.results.map((r, i) => ({ ...exp.workflow[i], ...r.verification }));
  return { ok: allOk, preSnap: pre.snapshot };
}

async function planAndRun(tabId, goal, apiKey, model) {
  for (let step = 1; step <= 25; step++) {
    if (state.cancel) { publish("task.completed", { reason: "cancelled", step }); return "cancelled"; }
    await waitWhilePaused();
    state.steps = step;

    const preResp = await metrics.timed("perceive", () => rpc(tabId, { op: "snapshot" }));
    const preSnap = preResp.snapshot;

    // Try planning a small batch first
    let workflow = null;
    if (apiKey) {
      const p = await metrics.timed("plan", () => planWorkflow({ goal, snapshot: preSnap, apiKey, model }));
      if (p?.workflow?.length) { workflow = p.workflow; state.confidence = p.confidence; publish("plan.result", p); }
    }
    // Fall back to single-step reasoning
    if (!workflow) {
      const decision = await metrics.timed("reason", () => reason({ goal, snapshot: preSnap, apiKey, model }));
      publish("reason.result", { step, decision });
      state.confidence = decision.confidence;
      if (decision.action.type === "done") {
        publish("task.completed", { reason: "model-said-done", step, confidence: decision.confidence });
        return "done";
      }
      workflow = [{ action: decision.action, prediction: decision.prediction, checkpoint: true }];
    }

    // Attach predictions where missing
    for (const s of workflow) {
      if (!s.prediction && s.action?.type) s.prediction = predict(s.action, preSnap);
    }

    // Guardrail gate each action
    const currentHost = new URL(preSnap.url).host;
    for (const s of workflow) {
      if (!s.action || s.action.type === "done") continue;
      const target = s.action.ref ? preSnap.elements.find((e) => e.ref === s.action.ref) : null;
      const ok = await guardrailGate(s.action, target, currentHost, state.correlationId);
      if (!ok) { publish("task.escalated", { step, reason: "guardrail-denied" }); return "escalated"; }
    }

    if (workflow[0]?.action?.type === "done") {
      publish("task.completed", { reason: "model-said-done", step });
      return "done";
    }

    const resp = await metrics.timed("act+verify", () => rpc(tabId, { op: "batch", workflow }, 45000));
    for (let i = 0; i < resp.results.length; i++) {
      const r = resp.results[i];
      publish("verification.result", { step: state.steps, verification: r.verification, prediction: workflow[i]?.prediction });
      state.executed.push({
        step: state.steps + i, action: workflow[i]?.action, prediction: workflow[i]?.prediction,
        verdict: r.verification.verdict, structural: r.verification.structural, at: Date.now(),
      });
    }
    const bad = resp.results.find((r) => r.verification.verdict === "contradicted");
    if (bad) {
      state.consecutiveRecovery += 1;
      let recovered = false;
      for (const rung of [3, 4, 1, 2]) {
        if (state.cancel) break;
        publish("recovery.attempt", { step: state.steps, rung });
        const rec = await rpc(tabId, { op: "recover", rung, context: { command: bad.step?.action } }).catch((e) => ({ ok: false, note: String(e?.message || e) }));
        publish("recovery.result", { step: state.steps, rung, ...rec });
        if (rec.ok) { recovered = true; break; }
      }
      if (!recovered && state.consecutiveRecovery >= 3) {
        publish("task.escalated", { step: state.steps, reason: "recovery-exhausted" });
        return "escalated";
      }
    } else {
      state.consecutiveRecovery = 0;
    }
  }
  publish("task.completed", { reason: "max-steps", step: state.steps });
  return "max-steps";
}

export async function runTask({ tabId, goal, apiKey, model }) {
  if (state.running) throw new Error("task already running");
  Object.assign(state, {
    running: true, paused: false, cancel: false, tabId, goal,
    steps: 0, correlationId: crypto.randomUUID(),
    consecutiveRecovery: 0, executed: [], startedAt: Date.now(),
    experienceHit: null, confidence: 0,
  });
  metrics.reset();
  try {
    const url = (await chrome.tabs.get(tabId)).url || "";
    state.scopeHost = new URL(url).host;
  } catch { state.scopeHost = ""; }

  publish("task.start", { goal, tabId, scopeHost: state.scopeHost, normalized: normalizeGoal(goal).key }, state.correlationId);

  let outcome = "unknown";
  try {
    // Experience-memory fast path
    const exp = await expLookup(goal, state.scopeHost);
    if (exp) publish("experience.hit", { key: exp.key, matchKind: exp.matchKind, confidence: exp.confidence, avgMs: exp.avgMs });
    if (exp && await tryExperienceReplay(exp, tabId)) {
      publish("task.completed", { reason: "experience-replay", step: state.executed.length, confidence: exp.confidence });
      outcome = "success";
    } else {
      const r = await planAndRun(tabId, goal, apiKey, model);
      outcome = r === "done" ? "success" : r;
    }
  } catch (e) {
    publish("log", { level: "error", msg: String(e?.message || e) });
    publish("task.escalated", { reason: "exception", error: String(e?.message || e) });
    outcome = "error";
  } finally {
    const summary = metrics.summary();
    publish("metrics", { summary });
    chrome.storage.local.set({ oa_last_metrics: summary });

    // Persist learned workflow — prune ineffective steps.
    const pruned = pruneWorkflow(state.executed.map((s) => ({
      action: s.action, prediction: s.prediction, checkpoint: true,
      verdict: s.verdict, structural: s.structural,
    })));
    await expRecord({
      goal, host: state.scopeHost,
      workflow: pruned,
      verdict: outcome === "success" ? "confirmed" : "failed",
      durationMs: Date.now() - state.startedAt,
    });
    publish("learn.saved", { goal, host: state.scopeHost, steps: pruned.length, outcome });
    state.running = false;
  }
}
