import { createFileRoute } from "@tanstack/react-router";
import { Cable, Cpu } from "lucide-react";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({ meta: [{ title: "Devices · OpenAgent" }] }),
  component: Devices,
});

function Devices() {
  return (
    <AppShell title="Connected devices" subtitle="Local companions paired to this account">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-8 text-center">
          <Cable className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold">No devices paired</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The local companion arrives in Milestone 6. Once installed, it will pair via a
            one-time code and appear here.
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <div className="flex items-start gap-3">
            <Cpu className="mt-0.5 h-5 w-5 text-primary" />
            <div className="text-sm text-muted-foreground">
              The companion will provide opt-in capabilities such as opening apps, reading
              accessibility trees, keyboard/mouse input, window management, and file access —
              each gated by an explicit permission grant.
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
