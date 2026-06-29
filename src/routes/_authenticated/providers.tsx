import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/providers")({
  head: () => ({ meta: [{ title: "AI Providers · OpenAgent" }] }),
  component: Providers,
});

function Providers() {
  return (
    <AppShell title="AI providers" subtitle="Models the planner can call">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <div className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-semibold">Lovable AI Gateway</div>
              <div className="mt-1 text-xs text-muted-foreground">
                OpenAgent's default provider — no key required. Activated automatically when the
                planner module ships in Milestone 3.
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60 bg-surface/60">
          <div className="border-b border-border/60 px-4 py-3 text-sm font-semibold">
            Planned providers
          </div>
          <ul className="divide-y divide-border/60 text-sm">
            {[
              { name: "Google Gemini", status: "default", desc: "Multimodal reasoning models" },
              { name: "OpenAI GPT-5 family", status: "available", desc: "General-purpose reasoning" },
              { name: "Bring your own key", status: "milestone 5", desc: "Anthropic, OpenRouter, custom endpoints" },
            ].map((p) => (
              <li key={p.name} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.desc}</div>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
