// src/services/message-service.ts
import { SupabaseWrapper, MessageRecord } from '@/lib/supabase-wrapper';

// Use server-side service role key for admin writes
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[message-service] SUPABASE_URL or SUPABASE_SERVICE_KEY not set — writes will be cached locally only.');
}

export const supabaseWrapper = new SupabaseWrapper(SUPABASE_URL, SUPABASE_SERVICE_KEY, 'messages');

/**
 * Safe wrapper to persist a message. NEVER throws. Returns WriteResult.
 */
export async function writeMessageSafe(msg: MessageRecord) {
  const res = await supabaseWrapper.insert(msg);
  if (!res.ok) {
    console.error('[message-service] writeMessageSafe: failed to persist message', { res });
  }
  return res;
}
