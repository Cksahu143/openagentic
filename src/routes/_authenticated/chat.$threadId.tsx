import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, Loader2, Send, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  head: () => ({ meta: [{ title: "Chat · OpenAgent" }] }),
  component: ChatThread,
});

interface DbMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  created_at: string;
}

function ChatThread() {
  const { threadId } = Route.useParams();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, [threadId]);

  const conv = useQuery({
    queryKey: ["conversation", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title")
        .eq("id", threadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", threadId],
    queryFn: async (): Promise<DbMessage[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DbMessage[];
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messagesQuery.data?.length]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      const { error: insErr } = await supabase.from("messages").insert({
        conversation_id: threadId,
        user_id: u.user.id,
        role: "user",
        content: text,
      });
      if (insErr) throw insErr;

      // Milestone 1: placeholder assistant reply. Real planner lands in Milestone 3.
      const reply =
        "The planner module is still a stub in Milestone 1. Your message is saved — once the AI planner, browser controller, and local companion modules ship, I'll start completing tasks for you here.";
      const { error: aErr } = await supabase.from("messages").insert({
        conversation_id: threadId,
        user_id: u.user.id,
        role: "assistant",
        content: reply,
      });
      if (aErr) throw aErr;

      // Touch updated_at + auto-title from first message
      const shouldTitle = (messagesQuery.data?.length ?? 0) === 0;
      await supabase
        .from("conversations")
        .update({
          updated_at: new Date().toISOString(),
          ...(shouldTitle ? { title: text.slice(0, 60) } : {}),
        })
        .eq("id", threadId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", threadId] });
      qc.invalidateQueries({ queryKey: ["conversation", threadId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setTimeout(() => taRef.current?.focus(), 0);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Send failed"),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || send.isPending) return;
    setInput("");
    send.mutate(text);
  }

  return (
    <AppShell title={conv.data?.title ?? "Conversation"} subtitle={`Thread ${threadId.slice(0, 8)}`}>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        <div className="border-b border-border/60 px-4 py-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/chat">
              <ArrowLeft className="mr-1 h-4 w-4" /> All conversations
            </Link>
          </Button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
            {messagesQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (messagesQuery.data?.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-8 text-center">
                <Bot className="mx-auto h-7 w-7 text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Send a message to get started. Responses are placeholders until the planner
                  ships.
                </p>
              </div>
            ) : (
              messagesQuery.data!.map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role !== "user" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg border px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "border-primary/40 bg-primary/15"
                        : "border-border/60 bg-surface/60"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                  {m.role === "user" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <UserIcon className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
              ))
            )}
            {send.isPending && (
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="rounded-lg border border-border/60 bg-surface/60 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> thinking…
                </div>
              </div>
            )}
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="border-t border-border/60 bg-background/80 p-3 backdrop-blur md:p-4"
        >
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
            <Textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e as unknown as React.FormEvent);
                }
              }}
              placeholder="Ask the agent to do something…"
              className="min-h-[44px] max-h-40 resize-none"
              rows={1}
            />
            <Button type="submit" disabled={send.isPending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
