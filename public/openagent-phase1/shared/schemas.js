// Lightweight envelope validation. Avoids bundling zod so the extension
// loads unpacked with zero build step. Each check throws on invalid input.

const isStr = (v) => typeof v === "string" && v.length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

export const EVENT_TYPES = new Set([
  "task.start",
  "task.pause",
  "task.resume",
  "task.cancel",
  "task.completed",
  "task.escalated",
  "perception.snapshot.request",
  "perception.snapshot.ready",
  "reason.request",
  "reason.result",
  "action.dispatch.requested",
  "action.completed",
  "action.failed",
  "action.clipboard.copy",
  "action.clipboard.cut",
  "action.clipboard.paste",
  "action.upload-requested",
  "verification.request",
  "verification.result",
  "recovery.attempt",
  "recovery.result",
  "guardrail.check",
  "guardrail.blocked",
  "guardrail.approved",
  "guardrail.denied",
  "cursor.state",
  "log",
  "metrics",
]);

export function validateEnvelope(env) {
  if (!isObj(env)) throw new Error("envelope not object");
  if (!isStr(env.type) || !EVENT_TYPES.has(env.type)) {
    throw new Error(`unknown event type: ${env.type}`);
  }
  if (!isNum(env.timestamp)) throw new Error("envelope.timestamp missing");
  if (!isStr(env.correlationId)) throw new Error("envelope.correlationId missing");
  if (env.payload !== undefined && !isObj(env.payload) && !Array.isArray(env.payload)) {
    // allow primitives too; just check it exists
  }
  return env;
}

export function newEnvelope(type, payload, correlationId) {
  return {
    type,
    timestamp: Date.now(),
    correlationId: correlationId || crypto.randomUUID(),
    payload: payload ?? {},
  };
}
