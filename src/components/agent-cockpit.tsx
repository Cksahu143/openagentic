import { useEffect, useMemo, useState } from "react";
import { Code2, ExternalLink, ListChecks, Monitor, Play, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type VMFile = { content: string; type: string; size: number };
type VMRow = {
  id: string;
  label: string;
  cwd: string;
  fs: Record<string, VMFile>;
  terminal_history: Array<{ command: string; output: string; timestamp: number; cwd: string }>;
  installed_apps: string[];
  spec: { os?: string };
  status: string;
};
type SessionRow = { id: string; task_tree: Array<{ label: string; status: string; note?: string }>; reasoning: string | null; current_url: string | null };
type SubAgentRow = { id: string; name: string; goal: string; status: string };
type View = "computer" | "tasks" | "code" | "preview";

export function AgentCockpit({ threadId, compact = false }: { threadId: string; compact?: boolean }) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [vm, setVM] = useState<VMRow | null>(null);
  const [subagents, setSubagents] = useState<SubAgentRow[]>([]);
  const [view, setView] = useState<View>("computer");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: sessionRow } = await supabase.from("agent_sessions").select("id, task_tree, reasoning, current_url").eq("thread_id", threadId).order("last_activity_at", { ascending: false }).limit(1).maybeSingle();
      if (!alive) return;
      const nextSession = sessionRow as unknown as SessionRow | null;
      setSession(nextSession);
      if (!nextSession) return;
      const [{ data: vmRow }, { data: agents }] = await Promise.all([
        supabase.from("agent_vms").select("id, label, cwd, fs, terminal_history, installed_apps, spec, status").eq("session_id", nextSession.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
        supabase.from("sub_agents").select("id, name, goal, status").eq("parent_session_id", nextSession.id).order("created_at", { ascending: false }),
      ]);
      if (!alive) return;
      setVM(vmRow as unknown as VMRow | null);
      setSubagents((agents ?? []) as unknown as SubAgentRow[]);
    };
    void load();
    const channel = supabase.channel(`cockpit-${threadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_sessions" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_vms" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "sub_agents" }, () => void load())
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(channel); };
  }, [threadId]);

  const files = useMemo(() => Object.entries(vm?.fs ?? {}).filter(([, file]) => file.type === "file").sort(([a], [b]) => a.localeCompare(b)), [vm]);
  const selected = selectedPath ? vm?.fs[selectedPath] : undefined;
  const previewFile = selectedPath?.endsWith(".html") ? selected : files.find(([path]) => /(?:index|preview)\.html$/i.test(path))?.[1];

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card" aria-label="Agent computer">
      <div className="flex items-center gap-1 border-b border-border p-1">
        {(["computer", "tasks", "code", "preview"] as View[]).map((item) => (
          <Button key={item} size="sm" variant={view === item ? "secondary" : "ghost"} onClick={() => setView(item)} className="h-7 px-2 text-[11px] capitalize">
            {item === "computer" && <Monitor className="mr-1 h-3 w-3" />}
            {item === "tasks" && <ListChecks className="mr-1 h-3 w-3" />}
            {item === "code" && <Code2 className="mr-1 h-3 w-3" />}
            {item === "preview" && <Play className="mr-1 h-3 w-3" />}
            {item}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {view === "computer" && (
          <div className="space-y-2 font-mono text-[11px]">
            <div className="flex items-center justify-between text-muted-foreground"><span>{vm?.label ?? "Waiting for computer…"}</span><span>{vm?.status ?? "offline"}</span></div>
            <div className="rounded-sm bg-background p-2 text-foreground/80">
              {(vm?.terminal_history ?? []).slice(compact ? -12 : -30).map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className="mb-2 whitespace-pre-wrap"><span className="text-primary">agent@vm:{entry.cwd}$ {entry.command}</span>{entry.output && `\n${entry.output}`}</div>
              ))}
              {!vm?.terminal_history?.length && <span className="text-muted-foreground">Terminal activity will stream here.</span>}
            </div>
            {subagents.length > 0 && <div className="grid gap-1 sm:grid-cols-2">{subagents.map((agent) => <div key={agent.id} className="border border-border p-2"><div className="flex justify-between"><span>{agent.name}</span><span className="text-primary">{agent.status}</span></div><div className="truncate text-muted-foreground">{agent.goal}</div></div>)}</div>}
          </div>
        )}
        {view === "tasks" && <div className="space-y-2 text-xs">{(session?.task_tree ?? []).map((task, index) => <div key={index} className="flex gap-2 border-b border-border pb-2"><span className="font-mono text-primary">{task.status === "done" ? "✓" : task.status === "running" ? "●" : "○"}</span><div><div>{task.label}</div>{task.note && <div className="text-muted-foreground">{task.note}</div>}</div></div>)}{session?.reasoning && <div className="border-t border-border pt-2"><div className="mb-1 font-medium">Decision summary</div><p className="text-muted-foreground">{session.reasoning}</p></div>}</div>}
        {view === "code" && <div className="grid h-full min-h-[260px] grid-cols-[130px_1fr] gap-2"><div className="overflow-auto border-r border-border pr-2 font-mono text-[10px]">{files.map(([path]) => <button key={path} className={`block w-full truncate px-1 py-1 text-left ${selectedPath === path ? "bg-primary/10 text-primary" : "text-muted-foreground"}`} onClick={() => setSelectedPath(path)}>{path}</button>)}</div><pre className="overflow-auto whitespace-pre-wrap break-words bg-background p-2 font-mono text-[11px]">{selected?.content ?? "Select a file to inspect the agent's work."}</pre></div>}
        {view === "preview" && previewFile?.content ? <iframe title="Agent website preview" sandbox="allow-scripts" srcDoc={previewFile.content} className="h-full min-h-[360px] w-full bg-background" /> : session?.current_url ? <div className="space-y-3 text-sm"><p className="text-muted-foreground">The active browser site may block embedding. Open it directly if the preview is unavailable.</p><iframe title="Agent browser preview" sandbox="allow-scripts allow-forms" src={session.current_url} className="h-[360px] w-full bg-background" /><Button asChild size="sm" variant="secondary"><a href={session.current_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3 w-3" />Open site</a></Button></div> : <div className="flex h-full min-h-[260px] items-center justify-center text-xs text-muted-foreground"><Terminal className="mr-2 h-4 w-4" />Create an HTML file or open a browser page to preview it.</div>}
      </div>
    </section>
  );
}