import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Logs · OpenAgent" }] }),
  component: Logs,
});

function Logs() {
  const logs = useQuery({
    queryKey: ["logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, module, level, message, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <AppShell title="Logs" subtitle="Append-only audit trail">
      <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
        {(logs.data?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-10 text-center">
            <ScrollText className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">No log entries yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Module activity will appear here once Milestone 2 wires the logger to the database.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-surface/60 font-mono text-xs">
            <ul className="divide-y divide-border/60">
              {logs.data!.map((l) => (
                <li key={l.id} className="grid grid-cols-[auto_auto_auto_1fr] gap-3 px-4 py-2">
                  <span className="text-muted-foreground">
                    {new Date(l.created_at).toLocaleTimeString()}
                  </span>
                  <span className="uppercase text-primary">[{l.module}]</span>
                  <span className="uppercase text-muted-foreground">{l.level}</span>
                  <span>{l.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
