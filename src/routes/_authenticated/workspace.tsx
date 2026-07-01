/**
 * AI Workspace — Milestone 9 completion pass.
 *
 * Live control center for persistent agent sessions with the full hybrid
 * observation state: task tree, reasoning, browser state, page summary,
 * retry/recovery, waiting status, browser memory, screenshot log, timeline.
 * Everything updates in realtime via postgres_changes on `agent_sessions`.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Brain,
  Camera,
  CheckCircle2,
  Circle,
  CircleDashed,
  Eye,
  Hourglass,
  ListTree,
  Loader2,
  Notebook,
  Pause,
  Play,
  RefreshCw,
  Square,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  pauseSession,
  resumeSession,
  cancelSession,
} from "@/lib/agent-sessions.functions";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({ meta: [{ title: "AI Workspace · OpenAgent" }] }),
  component: Workspace,
});

interface Step { i: number; label: string; status: string; note?: string }
interface TimelineEvent { t: number; icon: string; label: string; detail?: unknown }
interface ToolEvent { t: number; action: string; args: unknown; result: unknown }
interface Screenshot {
  t: number; reason?: string; url?: string; title?: string;
  tabId?: number; visualSummary?: string;
}
type BrowserMemory = {
  currentObjective?: string;
  completedObjectives?: string[];
  visitedUrls?: string[];
  previousSearches?: string[];
  knownTabs?: string[];
  notes?: string;
};

interface Session {
  id: string;
  thread_id: string | null;
  goal: string;
  status: string;
  task_tree: Step[];
  current_step: number;
  timeline: TimelineEvent[];
  tool_history: ToolEvent[];
  screenshots: Screenshot[];
  browser_memory: BrowserMemory;
  reasoning: string | null;
  observation_summary: string | null;
  page_summary: string | null;
  waiting_status: string | null;
  recovery_status: string | null;
  retry_count: number | null;
  current_url: string | null;
  active_tab_id: number | null;
  started_at: string;
  last_activity_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  running: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse",
  waiting: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  paused: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  completed: "bg-primary/20 text-primary border-primary/40",
  failed: "bg-destructive/20 text-destructive border-destructive/40",
  cancelled: "bg-muted text-muted-foreground border-border",
};

function Workspace() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const pauseFn = useServerFn(pauseSession);
  const resumeFn = useServerFn(resumeSession);
  const cancelFn = useServerFn(cancelSession);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("agent_sessions")
        .select("*")
        .order("last_activity_at", { ascending: false })
        .limit(30);
      if (!alive) return;
      const rows = (data ?? []) as unknown as Session[];
      setSessions(rows);
      const active = rows.find((r) =>
        ["planning", "running", "waiting", "paused"].includes(r.status),
      );
      setActiveId(active?.id ?? rows[0]?.id ?? null);
      setLoading(false);
    })();

    const ch = supabase
      .channel("workspace-sessions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_sessions" },
        (p) => {
          const row = p.new as Session;
          if (!row?.id) return;
          setSessions((cur) => {
            const rest = cur.filter((r) => r.id !== row.id);
            return [row, ...rest].slice(0, 30);
          });
        },
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, []);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  async function ctrl(fn: (o: { data: { id: string } }) => Promise<unknown>, label: string) {
    if (!active) return;
    try {
      await fn({ data: { id: active.id } });
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const mem = active?.browser_memory ?? {};

  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-4 p-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">
              AI Workspace
            </h1>
            <p className="text-xs text-muted-foreground">
              Hybrid observation · live task tree · browser memory · recovery
            </p>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link to="/chat">
              <Sparkles className="mr-2 h-4 w-4" /> New chat
            </Link>
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_1fr_1fr]">
          {/* ---- Sessions ---- */}
          <Card icon={<Activity className="h-4 w-4" />} title="Sessions" className="flex min-h-0 flex-col">
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No sessions yet. Start a chat to give the agent a goal.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => setActiveId(s.id)}
                        className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${
                          s.id === activeId
                            ? "border-primary/50 bg-primary/10"
                            : "border-border/60 hover:bg-muted/40"
                        }`}
                      >
                        <div className="truncate font-medium">{s.goal}</div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span
                            className={`rounded border px-1 py-px text-[9px] uppercase tracking-wide ${
                              STATUS_COLORS[s.status] ?? STATUS_COLORS.paused
                            }`}
                          >
                            {s.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(s.last_activity_at).toLocaleTimeString()}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* ---- Task tree + reasoning + browser state ---- */}
          <section className="flex min-h-0 flex-col gap-4">
            <Card icon={<ListTree className="h-4 w-4" />} title="Task tree" className="flex min-h-0 flex-col">
              {!active ? (
                <p className="text-xs text-muted-foreground">Pick a session on the left.</p>
              ) : (
                <>
                  <div className="mb-3 space-y-1">
                    <div className="text-sm font-medium">{active.goal}</div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span className={`rounded border px-1.5 py-0.5 uppercase ${STATUS_COLORS[active.status] ?? ""}`}>
                        {active.status}
                      </span>
                      {active.current_url && (
                        <a
                          href={active.current_url}
                          target="_blank"
                          rel="noreferrer"
                          className="max-w-[280px] truncate text-primary hover:underline"
                        >
                          {active.current_url}
                        </a>
                      )}
                      {active.active_tab_id != null && <span>tab #{active.active_tab_id}</span>}
                      {(active.retry_count ?? 0) > 0 && (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px text-amber-300">
                          <RefreshCw className="mr-1 inline h-2.5 w-2.5" />
                          {active.retry_count} retries
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      {active.status === "paused" ? (
                        <Button size="sm" variant="secondary" onClick={() => ctrl(resumeFn, "Resumed")}>
                          <Play className="mr-1 h-3 w-3" /> Resume
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={["completed", "failed", "cancelled"].includes(active.status)}
                          onClick={() => ctrl(pauseFn, "Paused")}
                        >
                          <Pause className="mr-1 h-3 w-3" /> Pause
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={["completed", "failed", "cancelled"].includes(active.status)}
                        onClick={() => ctrl(cancelFn, "Cancelled")}
                      >
                        <Square className="mr-1 h-3 w-3" /> Cancel
                      </Button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {(active.task_tree ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Waiting for the agent to plan…
                      </p>
                    ) : (
                      <ol className="space-y-1.5">
                        {active.task_tree.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm">
                            <StepIcon status={step.status} />
                            <div className="min-w-0 flex-1">
                              <div
                                className={
                                  step.status === "done"
                                    ? "line-through text-muted-foreground"
                                    : step.status === "running"
                                      ? "font-medium text-primary"
                                      : ""
                                }
                              >
                                {step.label}
                              </div>
                              {step.note && (
                                <div className="text-[11px] text-muted-foreground">
                                  {step.note}
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </>
              )}
            </Card>

            <Card icon={<Brain className="h-4 w-4" />} title="Current reasoning">
              {active?.reasoning ? (
                <p className="text-sm leading-relaxed text-foreground/90">{active.reasoning}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The agent hasn't emitted a reasoning trace yet.
                </p>
              )}
            </Card>
          </section>

          {/* ---- Perception column: observation / waiting / recovery / memory ---- */}
          <section className="flex min-h-0 flex-col gap-4">
            <Card icon={<Eye className="h-4 w-4" />} title="Observation summary">
              {active?.observation_summary ? (
                <>
                  <div className="text-[13px] leading-relaxed">{active.observation_summary}</div>
                  {active.page_summary && (
                    <div className="mt-1 text-[11px] text-muted-foreground">{active.page_summary}</div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No observation yet. The agent will populate this after
                  calling <code>companion_observe</code>.
                </p>
              )}
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <Card icon={<Hourglass className="h-4 w-4" />} title="Waiting on">
                {active?.waiting_status ? (
                  <p className="truncate text-xs text-blue-300">{active.waiting_status}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Idle.</p>
                )}
              </Card>
              <Card icon={<RefreshCw className="h-4 w-4" />} title="Recovery">
                {active?.recovery_status ? (
                  <p className="text-xs text-amber-300">{active.recovery_status}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">No recovery in progress.</p>
                )}
              </Card>
            </div>

            <Card icon={<Notebook className="h-4 w-4" />} title="Browser memory" className="flex min-h-0 flex-col">
              {!active || Object.keys(mem).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Empty. The agent adds visited URLs and objectives as it
                  works.
                </p>
              ) : (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto text-[11px]">
                  {mem.currentObjective && (
                    <MemBlock label="Current objective">{mem.currentObjective}</MemBlock>
                  )}
                  {mem.completedObjectives?.length ? (
                    <MemBlock label="Completed">
                      <ul className="list-disc pl-4">
                        {mem.completedObjectives.map((o, i) => <li key={i}>{o}</li>)}
                      </ul>
                    </MemBlock>
                  ) : null}
                  {mem.visitedUrls?.length ? (
                    <MemBlock label={`Visited (${mem.visitedUrls.length})`}>
                      <ul className="space-y-0.5">
                        {mem.visitedUrls.slice(-8).map((u, i) => (
                          <li key={i} className="truncate text-muted-foreground">{u}</li>
                        ))}
                      </ul>
                    </MemBlock>
                  ) : null}
                  {mem.previousSearches?.length ? (
                    <MemBlock label="Searches">
                      {mem.previousSearches.slice(-6).join(" · ")}
                    </MemBlock>
                  ) : null}
                  {mem.notes && <MemBlock label="Notes">{mem.notes}</MemBlock>}
                </div>
              )}
            </Card>
          </section>

          {/* ---- Timeline + tool history + screenshots ---- */}
          <section className="flex min-h-0 flex-col gap-4">
            <Card icon={<Activity className="h-4 w-4" />} title="Timeline" className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px]">
                {!active || (active.timeline ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Timeline events stream here as the agent works.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {[...active.timeline].reverse().map((e, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-4 shrink-0 text-base leading-tight">{e.icon}</span>
                        <span className="w-14 shrink-0 text-muted-foreground">
                          {new Date(e.t).toLocaleTimeString().split(" ")[0]}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{e.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card icon={<Camera className="h-4 w-4" />} title="Screenshots">
              {!active || (active.screenshots ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Vision fallback only — none captured yet.
                </p>
              ) : (
                <ul className="max-h-32 space-y-1 overflow-y-auto text-[11px]">
                  {[...active.screenshots].reverse().slice(0, 10).map((s, i) => (
                    <li key={i} className="rounded border border-border/50 bg-surface/40 p-1.5">
                      <div className="flex items-center gap-1">
                        <Camera className="h-2.5 w-2.5 text-primary" />
                        <span className="truncate font-medium">{s.title || s.url || "screenshot"}</span>
                        <span className="ml-auto text-muted-foreground">
                          {new Date(s.t).toLocaleTimeString().split(" ")[0]}
                        </span>
                      </div>
                      {s.reason && (
                        <div className="mt-0.5 text-muted-foreground">Reason: {s.reason}</div>
                      )}
                      {s.visualSummary && (
                        <div className="mt-0.5 line-clamp-2 text-foreground/80">{s.visualSummary}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card icon={<CircleDashed className="h-4 w-4" />} title="Tool history">
              {!active || (active.tool_history ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No tools called yet.</p>
              ) : (
                <ul className="max-h-32 space-y-1 overflow-y-auto font-mono text-[11px]">
                  {[...active.tool_history].reverse().slice(0, 20).map((t, i) => {
                    const r = t.result as { ok?: boolean; error?: string } | undefined;
                    return (
                      <li key={i} className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${r?.ok ? "bg-emerald-400" : "bg-destructive"}`}
                        />
                        <span className="text-primary/90">{t.action}</span>
                        {r?.error && <span className="truncate text-destructive">· {r.error}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function MemBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  if (status === "failed") return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (status === "running") return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  if (status === "skipped") return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
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
      <div className="flex min-h-0 flex-1 flex-col p-3">{children}</div>
    </div>
  );
}
