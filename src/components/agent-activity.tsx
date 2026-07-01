/**
 * Live agent activity feed — subscribes to activity_logs via Realtime and
 * shows what the agent is doing right now. Also surfaces companion command
 * status so the user can see when the extension is running commands, and
 * any errors that occur.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Loader2, Radio } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ActivityRow {
  id: string;
  module: string;
  level: string;
  message: string;
  metadata: unknown;
  created_at: string;
  kind: "log" | "command";
}

const MAX_ROWS = 60;

export function AgentActivity({ className }: { className?: string }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || !mounted) return;

      // seed from recent history
      const [{ data: logs }, { data: cmds }] = await Promise.all([
        supabase
          .from("activity_logs")
          .select("id, module, level, message, metadata, created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("companion_commands")
          .select("id, action, status, error, created_at, updated_at, args, result")
          .order("updated_at", { ascending: false })
          .limit(15),
      ]);

      const seed: ActivityRow[] = [
        ...(logs ?? []).map((l) => ({
          id: l.id,
          module: l.module,
          level: l.level,
          message: l.message,
          metadata: l.metadata,
          created_at: l.created_at,
          kind: "log" as const,
        })),
        ...(cmds ?? []).map((c) => ({
          id: c.id,
          module: "companion",
          level: c.status === "error" ? "error" : c.status === "done" ? "info" : "debug",
          message: `${c.action} · ${c.status}${c.error ? " · " + c.error : ""}`,
          metadata: { args: c.args, result: c.result },
          created_at: c.updated_at || c.created_at,
          kind: "command" as const,
        })),
      ]
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, MAX_ROWS);

      if (mounted) setRows(seed);
    })();

    const ch = supabase
      .channel("agent-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_logs" },
        (payload) => {
          const l = payload.new as ActivityRow;
          setRows((cur) =>
            [{ ...l, kind: "log" as const }, ...cur].slice(0, MAX_ROWS),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "companion_commands" },
        (payload) => {
          const c = payload.new as {
            id: string;
            action: string;
            status: string;
            error?: string | null;
            created_at: string;
            updated_at: string;
            args?: unknown;
            result?: unknown;
          };
          if (!c?.id) return;
          setRows((cur) => {
            const others = cur.filter((r) => r.id !== c.id);
            return [
              {
                id: c.id,
                module: "companion",
                level: c.status === "error" ? "error" : c.status === "done" ? "info" : "debug",
                message: `${c.action} · ${c.status}${c.error ? " · " + c.error : ""}`,
                metadata: { args: c.args, result: c.result },
                created_at: c.updated_at || c.created_at,
                kind: "command",
              },
              ...others,
            ].slice(0, MAX_ROWS);
          });
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-xl border border-border/60 bg-surface/60",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Radio
            className={cn("h-3 w-3", connected ? "text-emerald-400" : "text-muted-foreground")}
          />
          Agent activity
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {connected ? "live" : "offline"}
        </span>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border/40 overflow-y-auto font-mono text-[11px]">
        {rows.length === 0 && (
          <li className="p-4 text-center text-muted-foreground">Waiting for activity…</li>
        )}
        {rows.map((r) => {
          const isErr = r.level === "error";
          const isDone = r.kind === "command" && r.message.includes("done");
          const isRun = r.kind === "command" && r.message.includes("running");
          const Icon = isErr
            ? AlertTriangle
            : isDone
              ? CheckCircle2
              : isRun
                ? Loader2
                : Bot;
          return (
            <li key={r.id} className="flex gap-2 px-3 py-2">
              <Icon
                className={cn(
                  "mt-0.5 h-3 w-3 shrink-0",
                  isErr
                    ? "text-destructive"
                    : isDone
                      ? "text-emerald-400"
                      : isRun
                        ? "animate-spin text-primary"
                        : "text-primary",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="uppercase text-primary/80">{r.module}</span>
                  <span className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <div className={cn("break-words", isErr ? "text-destructive" : "text-foreground")}>
                  {r.message}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
