import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePermission } from "@/lib/permissions.server";
import { ensureVM, getVM, vmExecuteCommand } from "@/lib/vm.server";

export const startVirtualComputer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePermission(context.supabase, context.userId, "computer:use");
    return ensureVM(context.supabase, context.userId, null);
  });

export const runVirtualComputerCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ vmId: z.string().uuid(), command: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "computer:use");
    const vm = await getVM(context.supabase, data.vmId);
    if (!vm) throw new Error("Virtual computer not found.");
    return vmExecuteCommand(context.supabase, vm.id, vm, data.command);
  });