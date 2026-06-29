import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks · OpenAgent" }] }),
  component: Tasks,
});

function Tasks() {
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, goal, status, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <AppShell title="Tasks" subtitle="History of agent-completed work">
      <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
        {(tasks.data?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-10 text-center">
            <ListChecks className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">No tasks yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Tasks will appear here once the planner module is enabled in Milestone 3.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-surface/60">
            {tasks.data!.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm">{t.goal}</div>
                  <div className="font-mono text-[10px] uppercase text-muted-foreground">
                    {new Date(t.created_at).toLocaleString()}
                  </div>
                </div>
                <span className="font-mono text-[11px] uppercase text-muted-foreground">
                  {t.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
