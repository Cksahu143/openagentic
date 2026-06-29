/**
 * Activity logger — client-side wrapper that writes to public.activity_logs.
 * Every module action should pass through this so the Logs page is the
 * single audit trail. Failures never throw — logging is best-effort.
 */
import { supabase } from "@/integrations/supabase/client";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogInput {
  module: string;
  message: string;
  level?: LogLevel;
  metadata?: Record<string, unknown>;
}

export async function logActivity(entry: LogInput): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("activity_logs").insert({
      user_id: u.user.id,
      module: entry.module,
      level: entry.level ?? "info",
      message: entry.message,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[logger]", err);
  }
}
