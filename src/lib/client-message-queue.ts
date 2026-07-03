// src/lib/client-message-queue.ts
// Browser-safe, non-throwing message persistence with validation,
// retry+backoff, and localStorage-backed offline queueing.

import type { SupabaseClient } from "@supabase/supabase-js";

const QUEUE_KEY = "openagent:pending_messages";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROLES = ["user", "assistant", "system", "tool"];

export interface MessagePayload {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  parts?: unknown;
  created_at?: string;
}

export interface WriteResult {
  ok: boolean;
  reason?: string;
  detail?: unknown;
  queued?: boolean;
}

/** Validate against the exact constraints in the `messages` table. */
export function validateMessagePayload(msg: Partial<MessagePayload>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!msg.id || !UUID_RE.test(msg.id)) errors.push(`id must be a UUID (got: ${String(msg.id)})`);
  if (!msg.conversation_id || !UUID_RE.test(msg.conversation_id)) errors.push("conversation_id must be a UUID");
  if (!msg.user_id || !UUID_RE.test(msg.user_id)) errors.push("user_id must be a UUID");
  if (!msg.role || !VALID_ROLES.includes(msg.role)) errors.push(`role must be one of ${VALID_ROLES.join("|")}`);
  if (msg.content !== null && msg.content !== undefined && typeof msg.content !== "string") {
    errors.push("content must be a string or null");
  }
  return { valid: errors.length === 0, errors };
}

function backoffMs(attempt: number, base = 250, max = 8000) {
  return Math.min(base * 2 ** attempt + Math.random() * base, max);
}

function readQueue(): MessagePayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as MessagePayload[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: MessagePayload[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // localStorage full/unavailable — nothing more we can safely do client-side.
  }
}

function queueLocally(msg: MessagePayload) {
  const items = readQueue();
  if (items.some((m) => m.id === msg.id)) return; // dedupe
  items.push(msg);
  writeQueue(items.slice(-200)); // cap growth
}

/**
 * Insert a message. NEVER throws. Validates first, retries transient
 * failures with backoff, and falls back to a local queue on permanent
 * failure so the chat flow is never interrupted by a persistence error.
 */
export async function insertMessageSafe(
  client: SupabaseClient,
  msg: MessagePayload,
  opts?: { maxRetries?: number },
): Promise<WriteResult> {
  const { valid, errors } = validateMessagePayload(msg);
  if (!valid) {
    console.error("[client-message-queue] validation failed, not sending:", errors, msg);
    queueLocally(msg);
    return { ok: false, reason: "validation_failed", detail: errors, queued: true };
  }

  const maxRetries = opts?.maxRetries ?? 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { error } = await client.from("messages").insert(msg);
    if (!error) return { ok: true };

    lastError = error;
    const code = (error as { code?: string }).code;
    const status = (error as { status?: number }).status;

    // Permanent errors (bad data, RLS, FK, check constraint) — don't retry, queue and stop.
    const permanent =
      code === "22P02" || // invalid input syntax (e.g. bad UUID)
      code === "23502" || // not-null violation
      code === "23503" || // FK violation
      code === "23514" || // check constraint violation
      code === "42501" || // RLS violation
      status === 400 ||
      status === 403;

    console.warn(`[client-message-queue] insert attempt ${attempt + 1} failed`, {
      code,
      status,
      message: error.message,
      details: (error as { details?: unknown }).details,
      hint: (error as { hint?: unknown }).hint,
    });

    if (permanent) break;
    if (attempt < maxRetries) await new Promise((r) => setTimeout(r, backoffMs(attempt)));
  }

  console.error("[client-message-queue] giving up, queueing locally for later flush", lastError);
  queueLocally(msg);
  return { ok: false, reason: "send_failed", detail: lastError, queued: true };
}

/** Attempt to resend anything queued from a previous failure. Call on app start / reconnect. */
export async function flushMessageQueue(client: SupabaseClient): Promise<void> {
  const items = readQueue();
  if (items.length === 0) return;
  const remaining: MessagePayload[] = [];
  for (const msg of items) {
    const { error } = await client.from("messages").insert(msg);
    if (error) remaining.push(msg);
  }
  writeQueue(remaining);
  if (remaining.length < items.length) {
    console.info(`[client-message-queue] flushed ${items.length - remaining.length} queued message(s)`);
  }
}
