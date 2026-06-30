import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2, Download, Eye, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { files } from "@/modules/files";

export const Route = createFileRoute("/_authenticated/files")({
  head: () => ({ meta: [{ title: "Files · OpenAgent" }] }),
  component: FilesPage,
});

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FilesPage() {
  const qc = useQueryClient();
  const [openNew, setOpenNew] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [viewing, setViewing] = useState<{ path: string; text: string } | null>(null);

  const list = useQuery({
    queryKey: ["files"],
    queryFn: () => files.list(""),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("File name required");
      await files.write(name.trim(), body, guessType(name));
    },
    onSuccess: () => {
      toast.success("File saved");
      setOpenNew(false);
      setName("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (path: string) => files.remove(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["files"] }),
  });

  async function view(path: string) {
    try {
      const text = await files.read(path);
      setViewing({ path, text });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Read failed");
    }
  }

  async function download(path: string) {
    try {
      const url = await files.signedUrl(path, 60);
      window.open(url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  const sorted = useMemo(() => (list.data ?? []).slice(), [list.data]);

  return (
    <AppShell
      title="Files"
      subtitle="Private storage the agent can read and write"
      actions={
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" /> New file
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New file</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="reports/notes.md"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Textarea
                rows={10}
                placeholder="File contents"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-3 p-4 md:p-6">
        {list.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-8 text-center text-sm text-muted-foreground">
            No files yet. Ask the agent to write one, or create one above.
          </div>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-border/60 bg-surface/60 text-sm">
            {sorted.map((f) => (
              <li
                key={f.path}
                className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0"
              >
                <FileText className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{f.path}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {fmtBytes(f.size)} · {f.updatedAt ? new Date(f.updatedAt).toLocaleString() : "—"}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => view(f.path)}>
                  <Eye className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => download(f.path)}>
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => del.mutate(f.path)}
                  disabled={del.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{viewing?.path}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-border/60 bg-background/60 p-3 text-xs">
            {viewing?.text}
          </pre>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setViewing(null)}>
              <X className="mr-1 h-4 w-4" /> Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function guessType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "html":
      return "text/html";
    case "csv":
      return "text/csv";
    default:
      return "text/plain";
  }
}
