
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({ meta: [{ title: "Chat · OpenAgent" }] }),
  component: ChatIndex,
});

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

function ChatIndex() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createConv = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: u.user.id, title: "New conversation" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ to: "/chat/$threadId", params: { threadId: id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create chat"),
  });

  const deleteConv = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("conversations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  return (
    <AppShell
      title="Chat"
      subtitle="Conversations with your agent"
      actions={
        <Button size="sm" onClick={() => createConv.mutate()} disabled={createConv.isPending}>
          <Plus className="mr-1 h-4 w-4" /> New
        </Button>
      }
    >
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        {conversationsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (conversationsQuery.data?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-10 text-center">
            <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">No conversations yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a new chat to talk with your agent. Replies are a placeholder until the
              planner module ships in Milestone 3.
            </p>
            <Button className="mt-4" onClick={() => createConv.mutate()}>
              <Plus className="mr-1 h-4 w-4" /> New conversation
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-surface/60">
            {conversationsQuery.data!.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <button
                  className="flex flex-1 flex-col items-start text-left"
                  onClick={() => navigate({ to: "/chat/$threadId", params: { threadId: c.id } })}
                >
                  <span className="text-sm font-medium">{c.title}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {new Date(c.updated_at).toLocaleString()}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteConv.mutate(c.id)}
                  aria-label="Delete conversation"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
