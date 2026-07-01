import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/plugins")({
  head: () => ({ meta: [{ title: "Plugins · OpenAgent" }] }),
  component: PluginsPage,
});

const SAMPLE = `{
  "id": "weather",
  "name": "Weather",
  "version": "0.1.0",
  "tools": [
    { "name": "get_weather", "description": "Get weather for a city", "schema": { "city": "string" } }
  ],
  "requiredScopes": ["plugins:execute"]
}`;

function PluginsPage() {
  const qc = useQueryClient();
  const [manifest, setManifest] = useState(SAMPLE);

  const plugins = useQuery({
    queryKey: ["installed_plugins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installed_plugins")
        .select("id, plugin_id, name, version, enabled, manifest, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const install = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const parsed = JSON.parse(manifest);
      const { error } = await supabase.from("installed_plugins").upsert(
        {
          user_id: u.user.id,
          plugin_id: parsed.id,
          name: parsed.name,
          version: parsed.version,
          manifest: parsed,
          enabled: true,
        },
        { onConflict: "user_id,plugin_id" },
      );
      if (error) throw error;
      void logActivity({ module: "plugins", message: `Installed ${parsed.id}@${parsed.version}` });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["installed_plugins"] });
      toast.success("Plugin installed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Install failed"),
  });

  const toggle = useMutation({
    mutationFn: async (p: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("installed_plugins")
        .update({ enabled: !p.enabled })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["installed_plugins"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("installed_plugins").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["installed_plugins"] }),
  });

  return (
    <AppShell title="Plugins" subtitle="Extend the agent with sandboxed tool packs">
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
        <section className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <div className="flex items-start gap-3">
            <Blocks className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">Install a plugin manifest</h2>
              <p className="text-xs text-muted-foreground">
                Paste a JSON manifest. Plugins declare tools and required scopes — the runtime will
                execute them in the next milestone.
              </p>
            </div>
          </div>
          <Textarea
            value={manifest}
            onChange={(e) => setManifest(e.target.value)}
            className="mt-3 h-40 font-mono text-xs"
          />
          <div className="mt-2">
            <Button onClick={() => install.mutate()} disabled={install.isPending}>
              Install
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-surface/60">
          <div className="border-b border-border/60 px-4 py-3 text-sm font-semibold">
            Installed plugins
          </div>
          {(plugins.data?.length ?? 0) === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nothing installed yet.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {plugins.data!.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {p.name}
                      <span className="rounded border border-border/60 bg-background/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        v{p.version}
                      </span>
                      {!p.enabled && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          disabled
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{p.plugin_id}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggle.mutate({ id: p.id, enabled: p.enabled })}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove.mutate(p.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
