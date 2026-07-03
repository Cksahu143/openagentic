// Performance metrics — collect per-phase durations across a task and
// expose summaries to the workspace UI (debug mode).

const buckets = new Map(); // phase -> number[]
let lastFlush = 0;

export function reset() { buckets.clear(); lastFlush = 0; }

export function record(phase, ms) {
  const arr = buckets.get(phase) || [];
  arr.push(ms);
  buckets.set(phase, arr);
}

function pctl(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

export function summary() {
  const out = {};
  for (const [phase, arr] of buckets) {
    out[phase] = {
      p50: Math.round(pctl(arr, 0.5)),
      p95: Math.round(pctl(arr, 0.95)),
      avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      n: arr.length,
    };
  }
  return out;
}

/** Utility: time an async function and record it. */
export async function timed(phase, fn) {
  const t0 = performance.now();
  try { return await fn(); }
  finally { record(phase, performance.now() - t0); }
}
