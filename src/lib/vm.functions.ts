import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePermission } from "@/lib/permissions.server";
import { ensureVM, getVM, vmBrowse, vmExecuteCommand } from "@/lib/vm.server";

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

/** Browse a page inside the virtual computer's web browser app. */
export const browseInVirtualComputer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ vmId: z.string().uuid(), url: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "computer:use");
    await requirePermission(context.supabase, context.userId, "browser:use");
    const vm = await getVM(context.supabase, data.vmId);
    if (!vm) throw new Error("Virtual computer not found.");
    const url = /^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`;
    const { page, output } = await vmBrowse(context.supabase, vm.id, vm, url);
    if (!page) return { ok: false as const, error: output };
    return {
      ok: true as const,
      url: page.finalUrl,
      status: page.status,
      title: page.title,
      text: page.text.slice(0, 20000),
      links: page.links.slice(0, 60),
    };
  });

/** Install / launch an app inside the virtual computer. */
export const openVirtualComputerApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ vmId: z.string().uuid(), app: z.string().min(1).max(60) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "computer:use");
    const vm = await getVM(context.supabase, data.vmId);
    if (!vm) throw new Error("Virtual computer not found.");
    return vmExecuteCommand(context.supabase, vm.id, vm, `open ${data.app}`);
  });
