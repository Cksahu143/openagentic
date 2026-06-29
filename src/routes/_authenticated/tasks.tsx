import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tasks, type TaskStatus } from "@/modules/tasks";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks · OpenAgent" }] }),
  component: Tasks,
});

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  completed: "text-emerald-400",
  failed: "text-destructive",
  cancelled: "text-muted-foreground line-through",
};

function Tasks() {
  const qc = useQueryClient();
  const [goal, setGoal] = useState("");

  const list = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasks.list(100),
  });

  const create = useMutation({
    mutationFn: (g: string) => tasks.create(g),
    onSuccess: () => {
      setGoal("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Task created");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create task"),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => tasks.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  return (
    <AppShell title="Tasks" subtitle="Persistent goals the agent is tracking">
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const g = goal.trim();
            if (g) create.mutate(g);
          }}
        >
          <Input
            placeholder="Add a goal for the agent to track…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={create.isPending}
          />
          <Button type="submit" disabled={create.isPending || !goal.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </form>

        {(list.data?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-10 text-center">
            <ListChecks className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">No tasks yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a goal above, or ask the agent in chat to track one for you.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-surface/60">
            {list.data!.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{t.goal}</div>
                  <div className="font-mono text-[10px] uppercase text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`font-mono text-[11px] uppercase ${STATUS_COLOR[t.status]}`}
                >
                  {t.status}
                </span>
                {t.status !== "completed" && t.status !== "cancelled" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => cancel.mutate(t.id)}
                    aria-label="Cancel task"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
