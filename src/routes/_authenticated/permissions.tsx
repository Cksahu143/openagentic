import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";
import { MODULE_REGISTRY } from "@/lib/modules";

export const Route = createFileRoute("/_authenticated/permissions")({
  head: () => ({ meta: [{ title: "Permissions · OpenAgent" }] }),
  component: Permissions,
});

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "ai:generate": "Send prompts to the AI Gateway on your behalf",
  "browser:navigate": "Fetch public web pages server-side",
  "companion:connect": "Talk to your paired browser extension",
  "companion:tabs": "List, open, close, focus, and read your tabs",
  "desktop:input": "Send keyboard/mouse input (future desktop companion)",
  "desktop:files": "Read/write files on your machine (future desktop companion)",
  "memory:read": "Read the agent's saved memory about you",
  "memory:write": "Save new memories on your behalf",
  "files:read": "Read files in your private OpenAgent storage",
  "files:write": "Write files to your private OpenAgent storage",
  "plugins:install": "Install third-party plugin manifests",
  "plugins:execute": "Execute plugin tools from installed plugins",
};

function Permissions() {
  const qc = useQueryClient();

  const grants = useQuery({
    queryKey: ["permission_grants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permission_grants")
        .select("scope, granted");
      if (error) throw error;
      const map = new Map<string, boolean>();
      for (const g of data ?? []) map.set(g.scope, g.granted);
      return map;
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ scope, granted }: { scope: string; granted: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase.from("permission_grants").upsert(
        { user_id: u.user.id, scope, granted, updated_at: new Date().toISOString() },
        { onConflict: "user_id,scope" },
      );
      if (error) throw error;
      void logActivity({
        module: "permissions",
        message: `${granted ? "Granted" : "Revoked"} ${scope}`,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permission_grants"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rows = MODULE_REGISTRY.filter((m) => m.requiredScopes.length > 0).flatMap((m) =>
    m.requiredScopes.map((s) => ({ module: m.name, scope: s })),
  );

  return (
    <AppShell title="Permissions" subtitle="Capability grants per module">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <div className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 text-primary" />
            <div className="text-sm text-muted-foreground">
              OpenAgent asks before doing sensitive things. Grants persist across sessions and can
              be revoked at any time. Revoking a grant blocks the agent from calling any tool that
              requires that scope.
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60 bg-surface/60">
          <ul className="divide-y divide-border/60">
            {rows.map(({ module, scope }) => {
              const granted = grants.data?.get(scope) ?? false;
              return (
                <li
                  key={scope}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{module}</span>
                      <span className="rounded border border-border/60 bg-background/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                        {scope}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {SCOPE_DESCRIPTIONS[scope] ?? "Sensitive capability"}
                    </div>
                  </div>
                  <Switch
                    checked={granted}
                    disabled={toggle.isPending}
                    onCheckedChange={(v) => toggle.mutate({ scope, granted: v })}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
