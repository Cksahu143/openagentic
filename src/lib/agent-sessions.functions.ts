/**
 * Agent session control — pause / resume / cancel.
 * All routes go through requireSupabaseAuth so RLS scopes to the user.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const idInput = (d: unknown) => z.object({ id: z.string().uuid() }).parse(d);

async function setStatus(
  ctx: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string },
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  const patch: Record<string, unknown> = {
    status,
    last_activity_at: new Date().toISOString(),
    ...extra,
  };
  if (status === "completed" || status === "failed" || status === "cancelled") {
    patch.completed_at = new Date().toISOString();
  }
  const { error } = await ctx.supabase
    .from("agent_sessions")
    .update(patch)
    .eq("id", id)
    .eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const pauseSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => setStatus(context, data.id, "paused"));

export const resumeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => setStatus(context, data.id, "running"));

export const cancelSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => setStatus(context, data.id, "cancelled"));
