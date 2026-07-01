import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Chrome, Copy, Download, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({ meta: [{ title: "Devices · OpenAgent" }] }),
  component: Devices,
});

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function Devices() {
  const qc = useQueryClient();
  const [deviceName, setDeviceName] = useState("My browser");
  const [code, setCode] = useState<string | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState<string>("");
  const [publishableKey, setPublishableKey] = useState<string>("");

  useEffect(() => {
    // These are baked into the deployed integration; safe to read from env.
    setSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string);
    setPublishableKey(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);
  }, []);

  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companion_devices")
        .select("id, name, kind, last_seen, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5000,
  });

  const pair = useMutation({
    mutationFn: async (name: string) => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Not signed in");
      const raw = crypto.randomUUID() + crypto.randomUUID();
      const hash = await sha256(raw);
      const { data: dev, error } = await supabase
        .from("companion_devices")
        .insert({
          user_id: session.session.user.id,
          name,
          kind: "browser-extension",
          token_hash: hash,
          pairing_code: raw.slice(0, 8),
          paired_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;

      const payload = {
        url: supabaseUrl,
        key: publishableKey,
        access_token: session.session.access_token,
        refresh_token: session.session.refresh_token,
        user_id: session.session.user.id,
        device_id: dev.id,
        expires_at: session.session.expires_at,
      };
      const encoded = btoa(JSON.stringify(payload));
      void logActivity({ module: "companion", message: `Device paired: ${name}` });
      return encoded;
    },
    onSuccess: (encoded) => {
      setCode(encoded);
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Pair failed"),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("companion_devices").delete().eq("id", id);
      if (error) throw error;
      void logActivity({ module: "companion", message: `Device revoked` });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });

  const ping = useMutation({
    mutationFn: async (device_id: string) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase.from("companion_commands").insert({
        user_id: u.user.id,
        device_id,
        action: "ping",
        args: {},
      });
      if (error) throw error;
      toast.success("Ping queued — watch the activity feed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Ping failed"),
  });

  return (
    <AppShell title="Devices" subtitle="Browsers and desktop companions linked to your account">
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
        {/* Install extension */}
        <section className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <div className="flex items-start gap-3">
            <Chrome className="mt-0.5 h-5 w-5 text-primary" />
            <div className="flex-1">
              <h2 className="text-sm font-semibold">1. Install the OpenAgent Companion</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A Chrome / Edge / Brave extension. Lets the agent list, open, close, focus, search,
                and read your tabs — with every action logged.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href="/openagent-companion.zip" download>
                    <Download className="mr-1 h-4 w-4" /> Download extension (.zip)
                  </a>
                </Button>
              </div>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Unzip the file.</li>
                <li>
                  Open <code className="rounded bg-muted px-1">chrome://extensions</code>.
                </li>
                <li>Enable <b>Developer mode</b> (top right).</li>
                <li>Click <b>Load unpacked</b> and select the unzipped folder.</li>
                <li>Pin the OpenAgent icon in your toolbar.</li>
              </ol>
            </div>
          </div>
        </section>

        {/* Pair */}
        <section className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <h2 className="text-sm font-semibold">2. Generate a device code</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Copy the code and paste it into the extension popup. This grants the extension access to
            your account so it can execute agent commands on this browser.
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Device name (e.g. Work laptop)"
              className="max-w-xs"
            />
            <Button
              onClick={() => pair.mutate(deviceName || "My browser")}
              disabled={pair.isPending || !supabaseUrl}
            >
              {pair.isPending ? (
                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Generate code
            </Button>
          </div>
          {code && (
            <div className="mt-3 space-y-2">
              <textarea
                readOnly
                value={code}
                className="h-24 w-full resize-none rounded-md border border-border/60 bg-background/60 p-2 font-mono text-[11px]"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(code);
                  toast.success("Copied");
                }}
              >
                <Copy className="mr-1 h-4 w-4" /> Copy code
              </Button>
            </div>
          )}
        </section>

        {/* Linked devices */}
        <section className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <h2 className="text-sm font-semibold">Linked devices</h2>
          {(devices.data?.length ?? 0) === 0 ? (
            <div className="mt-3 rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              <Cable className="mx-auto h-6 w-6" />
              <p className="mt-2">No devices linked yet.</p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border/60">
              {devices.data!.map((d) => {
                const online =
                  d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 30_000;
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            online ? "bg-emerald-400" : "bg-muted"
                          }`}
                        />
                        {d.name}
                        <span className="text-xs uppercase text-muted-foreground">
                          · {d.kind}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.last_seen
                          ? `Last seen ${formatDistanceToNow(new Date(d.last_seen), {
                              addSuffix: true,
                            })}`
                          : "Never seen"}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => ping.mutate(d.id)}
                        disabled={ping.isPending}
                      >
                        Ping
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revoke.mutate(d.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
