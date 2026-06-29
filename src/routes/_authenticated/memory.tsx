import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { memory, type MemoryKind } from "@/modules/memory";

export const Route = createFileRoute("/_authenticated/memory")({
  head: () => ({ meta: [{ title: "Memory · OpenAgent" }] }),
  component: Memory,
});

const KINDS: MemoryKind[] = ["workflow", "preference", "site", "note", "fact"];

function Memory() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<MemoryKind>("note");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const list = useQuery({
    queryKey: ["memories"],
    queryFn: () => memory.list(),
  });

  const save = useMutation({
    mutationFn: () => memory.save(kind, label.trim(), { text: value.trim() }),
    onSuccess: () => {
      setLabel("");
      setValue("");
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Memory saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => memory.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories"] }),
  });

  const togglePin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      memory.togglePin(id, pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories"] }),
  });

  return (
    <AppShell title="Memory" subtitle="Workflows, preferences, sites, notes, and facts">
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
        <form
          className="grid gap-2 rounded-xl border border-border/60 bg-surface/60 p-3 md:grid-cols-[140px_1fr_2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) save.mutate();
          }}
        >
          <Select value={kind} onValueChange={(v) => setKind(v as MemoryKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Label (e.g. Prefers dark UI)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Input
            placeholder="Details (optional)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" disabled={!label.trim() || save.isPending}>
            <Plus className="mr-1 h-4 w-4" /> Save
          </Button>
        </form>

        {(list.data?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-10 text-center">
            <Brain className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">No memories yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Save things here, or tell the agent in chat: "remember that…".
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-surface/60">
            {list.data!.map((m) => {
              const detail =
                m.value && typeof m.value === "object" && "text" in (m.value as object)
                  ? (m.value as { text: string }).text
                  : "";
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="rounded border border-border/60 bg-background/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {m.kind}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.label}</div>
                    {detail && (
                      <div className="truncate text-xs text-muted-foreground">{detail}</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => togglePin.mutate({ id: m.id, pinned: !m.pinned })}
                    aria-label={m.pinned ? "Unpin" : "Pin"}
                  >
                    {m.pinned ? (
                      <Pin className="h-4 w-4 text-primary" />
                    ) : (
                      <PinOff className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove.mutate(m.id)}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
