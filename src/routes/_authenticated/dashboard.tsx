import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  Cable,
  CheckCircle2,
  CircleDot,
  ListChecks,
  MessageSquare,
  Shield,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { MODULE_REGISTRY } from "@/lib/modules";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · OpenAgent" }] }),
  component: Dashboard,
});

const statusStyles: Record<string, string> = {
  planned: "text-muted-foreground",
  stub: "text-warning",
  alpha: "text-primary",
  stable: "text-success",
};

function Dashboard() {
  return (
    <AppShell title="Dashboard" subtitle="Agent overview and module status">
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
        {/* Hero status card */}
        <div className="relative overflow-hidden rounded-xl border border-border/60 bg-surface/60 p-5 md:p-7">
          <div className="pointer-events-none absolute inset-0 grid-bg opacity-30" />
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> online · idle
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                Welcome to OpenAgent
              </h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Foundation is ready. Browser, desktop and planner modules are scaffolded as
                stubs and will be activated in future milestones.
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/chat">
                  <MessageSquare className="mr-2 h-4 w-4" /> Open chat
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/permissions">
                  <Shield className="mr-2 h-4 w-4" /> Permissions
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid gap-3 md:grid-cols-4">
          {[
            { label: "Active tasks", value: "0", icon: ListChecks, to: "/tasks" },
            { label: "Conversations", value: "—", icon: MessageSquare, to: "/chat" },
            { label: "Granted scopes", value: "0", icon: Shield, to: "/permissions" },
            { label: "Connected devices", value: "0", icon: Cable, to: "/devices" },
          ].map((k) => (
            <Link
              key={k.label}
              to={k.to}
              className="rounded-lg border border-border/60 bg-surface/60 p-4 transition-colors hover:bg-surface-elevated"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{k.label}</span>
                <k.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 font-mono text-2xl">{k.value}</div>
            </Link>
          ))}
        </div>

        {/* Modules */}
        <div className="rounded-xl border border-border/60 bg-surface/60">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Module status</h3>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {MODULE_REGISTRY.length} modules
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {MODULE_REGISTRY.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CircleDot className={`h-3.5 w-3.5 ${statusStyles[m.status]}`} />
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      {m.id}
                    </span>
                    <span className="text-sm font-medium">{m.name}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.description}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`font-mono text-[11px] uppercase ${statusStyles[m.status]}`}>
                    {m.status}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Milestone {m.ownerMilestone}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity placeholder */}
        <div className="rounded-xl border border-border/60 bg-surface/60">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Recent activity</h3>
          </div>
          <div className="flex items-center gap-3 px-4 py-6 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Workspace initialized. Connect modules in future milestones to start logging activity.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
