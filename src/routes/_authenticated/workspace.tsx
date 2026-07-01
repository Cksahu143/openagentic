/**
 * AI Workspace — a dedicated live view of what the agent is doing.
 *
 * Shows in one place: current task, active companion commands, recent memory,
 * open tools, and the live activity feed. Everything on this page updates in
 * realtime (postgres_changes subscriptions), no polling and no manual refresh.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  Brain,
  ListChecks,
  MonitorPlay,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AgentActivity } from "@/components/agent-activity";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({ meta: [{ title: "AI Workspace · OpenAgent" }] }),
  component: Workspace,
});

interface Task {
  id: string;
  goal: string;
  status: string;
  created_at: string;
}
interface Command {
  id: string;
  action: string;
  status: string;
  args: unknown;
  result: unknown;
  error: string | null;
  updated_at: string;
}
interface Memory {
  id: string;
  kind: string;
  label: string;
  value: unknown;
}

function Workspace() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: t }, { data: c }, { data: m }] = await Promise.all([
        supabase.from("tasks").select("id,goal,status,created_at").order("created_at", { ascending: false }).limit(8),
        supabase.from("companion_commands").select("id,action,status,args,result,error,updated_at").order("updated_at", { ascending: false }).limit(8),
        supabase.from("memories").select("id,kind,label,value").order("created_at", { ascending: false }).limit(6),
      ]);
      if (!alive) return;
      setTasks(t ?? []);
      setCommands(c ?? []);
      setMemories(m ?? []);
    })();

    const ch = supabase
      .channel("workspace")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (p) => {
        const row = p.new as Task;
        if (!row?.id) return;
        setTasks((cur) => [row, ...cur.filter((x) => x.id !== row.id)].slice(0, 8));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "companion_commands" }, (p) => {
        const row = p.new as Command;
        if (!row?.id) return;
        setCommands((cur) => [row, ...cur.filter((x) => x.id !== row.id)].slice(0, 8));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "memories" }, (p) => {
        const row = p.new as Memory;
        if (!row?.id) return;
        setMemories((cur) => [row, ...cur.filter((x) => x.id !== row.id)].slice(0, 6));
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);

  const activeCmd = commands.find((c) => c.status === "running" || c.status === "pending");

  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-4 p-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">AI Workspace</h1>
            <p className="text-xs text-muted-foreground">
              Live view of what the agent is currently observing, thinking, and doing.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link to="/chat">
                <Sparkles className="mr-2 h-4 w-4" /> New chat
              </Link>
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="flex flex-col gap-4">
            <Card icon={<MonitorPlay className="h-4 w-4" />} title="Current focus">
              {activeCmd ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${activeCmd.status === "running" ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} />
                    <span className="font-mono">{activeCmd.action}</span>
                    <span className="text-xs uppercase text-muted-foreground">{activeCmd.status}</span>
                  </div>
                  <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
                    {JSON.stringify(activeCmd.args, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Pause className="h-4 w-4" /> Agent is idle. Start a chat to give it a goal.
                </div>
              )}
            </Card>

            <Card icon={<ListChecks className="h-4 w-4" />} title="Tasks">
              {tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tasks yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex items-start gap-2">
                      <Play className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{t.goal}</div>
                        <div className="text-[10px] uppercase text-muted-foreground">{t.status}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card icon={<Brain className="h-4 w-4" />} title="Memory">
              {memories.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing remembered yet.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {memories.map((m) => (
                    <li key={m.id} className="rounded bg-muted/30 p-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] uppercase text-primary">{m.kind}</span>
                        <span className="font-medium">{m.label}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground line-clamp-2">{String(m.value ?? "")}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section className="lg:col-span-2 flex min-h-0 flex-col gap-4">
            <Card icon={<Activity className="h-4 w-4" />} title="Live activity" className="flex min-h-0 flex-1 flex-col">
              <AgentActivity className="min-h-[400px] flex-1" />
            </Card>
            <Card icon={<MonitorPlay className="h-4 w-4" />} title="Recent commands">
              {commands.length === 0 ? (
                <p className="text-xs text-muted-foreground">No commands run yet.</p>
              ) : (
                <ul className="space-y-1.5 font-mono text-[11px]">
                  {commands.slice(0, 6).map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        c.status === "done" ? "bg-emerald-400" :
                        c.status === "error" ? "bg-destructive" :
                        c.status === "running" ? "animate-pulse bg-primary" : "bg-amber-400"
                      }`} />
                      <span className="text-primary/90">{c.action}</span>
                      <span className="text-muted-foreground">{c.status}</span>
                      {c.error && <span className="truncate text-destructive">· {c.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function Card({
  title, icon, children, className = "",
}: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border/60 bg-surface/60 ${className}`}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs font-medium">
        {icon}
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
