// Experience Memory — persistent per-goal workflow store (Handbook Ch. 14).
// Chrome storage-backed. Keeps last known successful action sequence,
// success/failure counts, average duration, confidence, recovery history,
// and last-execution timestamp so repeat tasks skip re-reasoning.

import { normalizeGoal, goalSimilarity } from "../shared/goal-normalize.js";

const KEY = "oa_experience_v2";
const MAX_ENTRIES = 300;

async function load() {
  const v = await chrome.storage.local.get([KEY]);
  return v[KEY] || {};
}
async function save(db) { await chrome.storage.local.set({ [KEY]: db }); }

/** Fetch the best matching experience for a goal on a given host. */
export async function lookup(goal, host) {
  const { key } = normalizeGoal(goal);
  const db = await load();
  // Exact match wins
  const exact = db[`${host}|${key}`];
  if (exact) return { ...exact, matchKind: "exact", score: 1 };
  // Fuzzy match — same host, similar tokens
  let best = null;
  for (const [k, entry] of Object.entries(db)) {
    if (!k.startsWith(`${host}|`)) continue;
    const s = goalSimilarity(goal, entry.goal);
    if (s >= 0.72 && (!best || s > best.score)) best = { ...entry, matchKind: "fuzzy", score: s };
  }
  return best;
}

/** Record the result of an execution. Merges into existing entry. */
export async function record({ goal, host, workflow, verdict, durationMs, recovery = [] }) {
  const { key } = normalizeGoal(goal);
  const db = await load();
  const id = `${host}|${key}`;
  const prev = db[id] || { goal, host, key, workflow: [], successes: 0, failures: 0, avgMs: 0, confidence: 0.5, recovery: [], lastAt: 0 };
  const success = verdict === "confirmed" || verdict === "success";
  const n = prev.successes + prev.failures;
  const avgMs = Math.round(((prev.avgMs * n) + (durationMs || 0)) / (n + 1));
  const successes = prev.successes + (success ? 1 : 0);
  const failures = prev.failures + (success ? 0 : 1);
  const confidence = Math.max(0.05, Math.min(0.99, (successes + 1) / (successes + failures + 2)));
  db[id] = {
    ...prev,
    workflow: success && workflow?.length ? workflow : prev.workflow,
    successes, failures, avgMs, confidence,
    recovery: [...prev.recovery, ...recovery].slice(-20),
    lastAt: Date.now(),
  };
  // LRU-ish cap
  const entries = Object.entries(db);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0));
    const trimmed = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    await save(trimmed); return;
  }
  await save(db);
}

/**
 * Diff planned vs executed workflow and prune unnecessary steps.
 * Steps whose verification verdict was "unconfirmed" and that produced no
 * measurable structural delta are removed from the stored trajectory.
 */
export function pruneWorkflow(executed) {
  return (executed || []).filter((step) => {
    if (step?.verdict === "contradicted") return false;
    if (step?.verdict === "unconfirmed" && !step?.structural) return false;
    return true;
  });
}

export async function dumpAll() { return load(); }
export async function clearAll() { await chrome.storage.local.remove([KEY]); }
