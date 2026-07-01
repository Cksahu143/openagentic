/**
 * Companion helper — server side.
 *
 * Enqueues a command for a user's paired browser extension and waits for the
 * result. Uses the service role to bypass RLS but always scopes by user_id
 * (we get user_id from the verified JWT before calling this).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface CompanionResult {
  ok: boolean;
  action: string;
  result?: unknown;
  error?: string;
  deviceId?: string;
  timeoutMs?: number;
}

export async function callCompanion(
  userId: string,
  action: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<CompanionResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;

  // Pick the most recently seen device for this user
  const { data: devices, error: devErr } = await supabaseAdmin
    .from("companion_devices")
    .select("id, last_seen")
    .eq("user_id", userId)
    .order("last_seen", { ascending: false, nullsFirst: false })
    .limit(1);
  if (devErr) return { ok: false, action, error: devErr.message };
  const device = devices?.[0];
  if (!device) {
    return {
      ok: false,
      action,
      error:
        "No companion device is paired. Install the OpenAgent Companion Chrome extension and pair it from the Devices page.",
    };
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("companion_commands")
    .insert({
      user_id: userId,
      device_id: device.id,
      action,
      args: args as never,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return { ok: false, action, error: insErr?.message || "insert failed" };
  }
  const commandId = inserted.id;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    const { data: row } = await supabaseAdmin
      .from("companion_commands")
      .select("status, result, error")
      .eq("id", commandId)
      .maybeSingle();
    if (!row) continue;
    if (row.status === "done") {
      return { ok: true, action, result: row.result, deviceId: device.id };
    }
    if (row.status === "error") {
      return {
        ok: false,
        action,
        error: row.error ?? "companion error",
        deviceId: device.id,
      };
    }
  }
  return {
    ok: false,
    action,
    error: `Companion did not respond in ${timeoutMs}ms. Is the extension running?`,
    deviceId: device.id,
    timeoutMs,
  };
}
