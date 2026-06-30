import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providers, type ProviderName } from "@/modules/providers";

export const Route = createFileRoute("/_authenticated/providers")({
  head: () => ({ meta: [{ title: "AI Providers · OpenAgent" }] }),
  component: Providers,
});

function Providers() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderName>("openai");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const list = useQuery({ queryKey: ["provider_keys"], queryFn: () => providers.list() });

  const add = useMutation({
    mutationFn: async () => {
      if (!apiKey.trim()) throw new Error("API key required");
      await providers.add({
        provider,
        apiKey: apiKey.trim(),
        label: label.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Provider key saved");
      setOpen(false);
      setApiKey("");
      setLabel("");
      setBaseUrl("");
      qc.invalidateQueries({ queryKey: ["provider_keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => providers.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["provider_keys"] }),
  });

  return (
    <AppShell
      title="AI providers"
      subtitle="Lovable AI by default · bring your own keys for more"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" /> Add provider key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add provider key</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => setProvider(v as ProviderName)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Label (optional)</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="work" />
              </div>
              <div className="space-y-1.5">
                <Label>API key</Label>
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  placeholder="sk-…"
                />
              </div>
              {provider === "custom" && (
                <div className="space-y-1.5">
                  <Label>Base URL</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Keys are stored encrypted at rest and locked to your account by row-level security.
                Other users cannot read them.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => add.mutate()} disabled={add.isPending}>
                Save key
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <div className="rounded-xl border border-border/60 bg-surface/60 p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-semibold">Lovable AI Gateway</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Default provider — zero config. The agent uses it for chat and for the
                <code className="mx-1 rounded bg-background/60 px-1">ask_ai</code> tool, so you
                never have to provide a key for basic operation.
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60 bg-surface/60">
          <div className="border-b border-border/60 px-4 py-3 text-sm font-semibold">
            Your provider keys
          </div>
          {list.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : (list.data ?? []).length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No keys yet. Add one to use Anthropic, OpenRouter or your own endpoint.
            </div>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {(list.data ?? []).map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                  <Key className="h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium capitalize">
                      {k.provider}
                      {k.label ? (
                        <span className="ml-2 text-xs text-muted-foreground">· {k.label}</span>
                      ) : null}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {k.maskedKey}
                      {k.baseUrl ? ` · ${k.baseUrl}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => del.mutate(k.id)}
                    disabled={del.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
