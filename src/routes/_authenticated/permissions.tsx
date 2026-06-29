import { createFileRoute } from "@tanstack/react-router";
import { Shield } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { MODULE_REGISTRY } from "@/lib/modules";

export const Route = createFileRoute("/_authenticated/permissions")({
  head: () => ({ meta: [{ title: "Permissions · OpenAgent" }] }),
  component: Permissions,
});

function Permissions() {
  return (
    <AppShell title="Permissions" subtitle="Capability grants per module">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <div className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 text-primary" />
            <div className="text-sm text-muted-foreground">
              OpenAgent never performs sensitive actions without an explicit grant. Every
              module declares the scopes it needs. Granular UI lands in Milestone 1.5; this
              page lists the declared scopes today.
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60 bg-surface/60">
          <div className="border-b border-border/60 px-4 py-3 text-sm font-semibold">
            Declared scopes
          </div>
          <ul className="divide-y divide-border/60">
            {MODULE_REGISTRY.filter((m) => m.requiredScopes.length > 0).map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="text-sm font-medium">{m.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {m.requiredScopes.map((s) => (
                    <span
                      key={s}
                      className="rounded border border-border/60 bg-background/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
