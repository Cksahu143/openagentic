/* src/lib/supabase-wrapper.ts
   Centralized safe writer for the 'messages' table:
   - Validates payloads
   - Retries transient failures (exponential backoff + jitter)
   - On permanent failure or validation failure: caches to a local JSONL file and returns a result (does not throw)
   - Background flush attempts to resend cached messages periodically
*/
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';

type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface MessageRecord {
  id?: string;
  role: Role;
  content: string;
  metadata?: Record<string, any> | null;
  created_at?: string;
  [key: string]: any;
}

export interface WriteResult {
  ok: boolean;
  error?: Error | string;
  status?: number;
  details?: any;
}

const CACHE_DIR = process.env.OFFLINE_CACHE_DIR ?? path.join(process.cwd(), 'var', 'offline_cache');
const CACHE_FILE = path.join(CACHE_DIR, 'messages.jsonl');

function nowIso() {
  return new Date().toISOString();
}

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function isPlainObject(v: any) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Lightweight validation for MessageRecord.
 */
export function validateMessageRecord(msg: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(msg)) {
    errors.push(`message must be an object, got ${typeof msg}`);
    return { valid: false, errors };
  }
  if (!msg.role) {
    errors.push('missing required field: role');
  } else if (!['user', 'assistant', 'system', 'tool'].includes(String(msg.role))) {
    errors.push(`invalid role: ${String(msg.role)} (expected one of user|assistant|system|tool)`);
  }
  if (typeof msg.content !== 'string' || msg.content.trim().length === 0) {
    errors.push('content must be a non-empty string');
  } else if (msg.content.length > 100000) {
    errors.push('content exceeds 100000 characters limit');
  }
  if (msg.metadata !== undefined && msg.metadata !== null && typeof msg.metadata !== 'object') {
    errors.push('metadata must be an object or null if present');
  }
  if (msg.created_at !== undefined && typeof msg.created_at !== 'string') {
    errors.push('created_at must be an ISO string if provided');
  }
  Object.keys(msg).forEach((k) => {
    if (msg[k] === undefined) {
      errors.push(`field "${k}" is undefined (use null or omit it)`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/** Append messages to local disk cache (JSONL). */
export async function cacheMessagesLocally(messages: MessageRecord[] | MessageRecord, reason?: string) {
  await ensureCacheDir();
  const arr = Array.isArray(messages) ? messages : [messages];
  const lines = arr.map((m) =>
    JSON.stringify({
      cached_at: nowIso(),
      reason: reason ?? 'unspecified',
      payload: m,
    }),
  );
  try {
    await fs.appendFile(CACHE_FILE, lines.join('\n') + '\n', 'utf8');
  } catch (err) {
    console.error('[supabase-wrapper] failed to write to offline cache', err);
  }
}

/** Exponential backoff + jitter */
function backoffDelay(attempt: number, baseMs = 200, maxDelay = 30_000) {
  const exp = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(exp + jitter, maxDelay);
}

export class SupabaseWrapper {
  private supabase: SupabaseClient;
  private tableName: string;

  constructor(supabaseUrl: string, supabaseKey: string, tableName = 'messages') {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.tableName = tableName;
    this.startPeriodicFlush();
  }

  /**
   * Insert messages. NEVER throws. Returns WriteResult.
   */
  async insert(messages: MessageRecord | MessageRecord[], opts?: { maxRetries?: number }): Promise<WriteResult> {
    const maxRetries = opts?.maxRetries ?? 4;
    const arr = Array.isArray(messages) ? messages : [messages];

    // Validate
    const validationErrors: { index: number; errors: string[] }[] = [];
    arr.forEach((msg, idx) => {
      const { valid, errors } = validateMessageRecord(msg);
      if (!valid) validationErrors.push({ index: idx, errors });
    });

    if (validationErrors.length > 0) {
      console.error('[supabase-wrapper] validation failed for messages', JSON.stringify(validationErrors, null, 2));
      await cacheMessagesLocally(arr, `validation_failed: ${JSON.stringify(validationErrors)}`);
      return { ok: false, error: 'validation_failed', details: validationErrors };
    }

    // Retry loop for transient errors
    let lastError: any = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const { data, error, status } = await this.supabase
          .from(this.tableName)
          .insert(arr)
          .select('id,created_at')
          .then((r) => r)
          .catch((err) => ({ data: null, error: err, status: 0 }));

        if (!error) {
          return { ok: true, status: status ?? 201, details: data };
        }

        // If Supabase indicates a 400 / invalid payload, do not retry
        if (error && (error.status === 400 || (error.message && String(error.message).toLowerCase().includes('invalid')))) {
          console.error('[supabase-wrapper] supabase returned 400 / invalid payload:', error);
          await cacheMessagesLocally(arr, `supabase_400: ${JSON.stringify(error)}`);
          return { ok: false, error: 'supabase_400', status: 400, details: error };
        }

        lastError = error;
        console.warn(`[supabase-wrapper] attempt ${attempt + 1} failed`, error);
      } catch (err) {
        lastError = err;
        console.warn(`[supabase-wrapper] attempt ${attempt + 1} caught error`, err);
      }

      if (attempt < maxRetries) {
        const delayMs = backoffDelay(attempt);
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }

    // Retries exhausted: cache and continue
    console.error('[supabase-wrapper] all retries exhausted. Caching messages locally. lastError:', lastError);
    await cacheMessagesLocally(arr, `retries_exhausted: ${String(lastError)}`);
    return { ok: false, error: 'retries_exhausted', details: String(lastError) };
  }

  /** Flush cached messages in batches (non-blocking). */
  async flushCachedMessages(): Promise<void> {
    try {
      await ensureCacheDir();
      const content = await fs.readFile(CACHE_FILE, 'utf8').catch(() => '');
      if (!content.trim()) return;
      const lines = content.trim().split('\n');
      const items = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      }).filter(Boolean) as Array<{ cached_at: string; reason: string; payload: MessageRecord }>;

      if (items.length === 0) {
        await fs.writeFile(CACHE_FILE, '', 'utf8').catch(() => {});
        return;
      }

      const batchSize = 25;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize).map((x) => x.payload);
        const result = await this.insert(batch, { maxRetries: 2 });
        if (!result.ok) {
          console.warn('[supabase-wrapper] flush batch failed; aborting flush to avoid tight loop', result);
          if (result.error === 'supabase_400' || result.error === 'validation_failed') {
            const remaining = items.slice(0, i).concat(items.slice(i + batch.length));
            const linesOut = remaining.map((r) => JSON.stringify(r));
            await fs.writeFile(CACHE_FILE, linesOut.join('\n') + (linesOut.length ? '\n' : ''), 'utf8').catch(() => {});
          }
          return;
        }
      }

      await fs.writeFile(CACHE_FILE, '', 'utf8').catch(() => {});
      console.info('[supabase-wrapper] successfully flushed cached messages to supabase');
    } catch (err) {
      console.warn('[supabase-wrapper] error while flushing cached messages', err);
    }
  }

  private startPeriodicFlush() {
    const intervalMs = Number(process.env.SUPABASE_FLUSH_INTERVAL_MS ?? 60_000);
    setInterval(() => {
      this.flushCachedMessages().catch((err) => {
        console.warn('[supabase-wrapper] periodic flush error', err);
      });
    }, intervalMs).unref();
  }
}
