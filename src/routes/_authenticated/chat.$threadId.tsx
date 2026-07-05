import { useEffect, useMemo, useRef, useState } from "react";
import { insertMessageSafe, flushMessageQueue } from "@/lib/client-message-queue";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  ListChecks,
  Loader2,
  Send,
  Sparkles,
  User as UserIcon,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AgentActivity } from "@/components/agent-activity";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";
import { memory, type MemoryKind } from "@/modules/memory";
import { tasks } from "@/modules/tasks";
import { files } from "@/modules/files";


export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  head: () => ({ meta: [{ title: "Chat · OpenAgent" }] }),
  component: ChatThread,
});

interface DbMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  parts: unknown;
  created_at: string;
}

// --- helpers -------------------------------------------------------------

function dbRowToUiMessage(row: DbMessage): UIMessage {
  // Prefer stored UI parts (preserves tool calls), fall back to plain text.
  const parts =
    Array.isArray(row.parts) && row.parts.length > 0
      ? (row.parts as UIMessage["parts"])
      : [{ type: "text" as const, text: row.content ?? "" }];
  return { id: row.id, role: row.role as UIMessage["role"], parts };
}

function partsToText(parts: UIMessage["parts"]): string {
  return parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("");
}

// --- component -----------------------------------------------------------

function ChatThread() {
  const { threadId } = Route.useParams();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const initialMessages = useQuery({
    queryKey: ["messages", threadId],
    queryFn: async (): Promise<UIMessage[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, parts, created_at")
        .eq("conversation_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => dbRowToUiMessage(r as DbMessage));
    },
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { threadId },
        fetch: async (url, init) => {
          const { data } = await supabase.auth.getSession();
          const headers = new Headers(init?.headers);
          if (data.session?.access_token) {
            headers.set("Authorization", `Bearer ${data.session.access_token}`);
          }
          return fetch(url, { ...init, headers });
        },
      }),
    [threadId],
  );

  const { messages, sendMessage, status, setMessages, error } = useChat({
    id: threadId,
    transport,
    messages: initialMessages.data,
    onError: (e) => {
      console.error(e);
      toast.error(e.message || "Chat error");
    },
    onFinish: async ({ message }) => {
      // Persist the assistant message (with parts so tool calls survive reload)
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const content = partsToText(message.parts);
        const res = await insertMessageSafe(supabase, {
          id: crypto.randomUUID(),       // DB row id — independent of the AI SDK's stream id
          conversation_id: threadId,
          user_id: u.user.id,
          role: "assistant",
          content,
          parts: message.parts as never,
        });
        if (!res.ok) {
          toast.error(
            res.queued
              ? "Reply saved locally — will retry when the connection recovers."
              : "Could not save assistant reply.",
          );
        }

        // Execute approved tools client-side (browser-side modules).
        for (const part of message.parts) {
          if (part.type === "tool-save_memory" && part.state === "input-available") {
            const { kind, label, value } = part.input as {
              kind: MemoryKind;
              label: string;
              value: string;
            };
            await memory.save(kind, label, { text: value }).catch(() => {});
          }
          if (part.type === "tool-create_task" && part.state === "input-available") {
            const { goal } = part.input as { goal: string };
            await tasks.create(goal).catch(() => {});
          }
          if (part.type === "tool-write_file" && part.state === "input-available") {
            const { path, content, contentType } = part.input as {
              path: string;
              content: string;
              contentType?: string;
            };
            await files.write(path, content, contentType).catch(() => {});
          }

        }

        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", threadId);
        qc.invalidateQueries({ queryKey: ["conversations"] });
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["memories"] });
      } catch (err) {
        console.error("persist assistant message", err);
      }
    },
  });

  // Sync messages once initial DB load completes.
  useEffect(() => {
    if (initialMessages.data) setMessages(initialMessages.data);
  }, [initialMessages.data, setMessages]);

  useEffect(() => {
    taRef.current?.focus();
  }, [threadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, status]);

  useEffect(() => {
   flushMessageQueue(supabase);
   const onOnline = () => flushMessageQueue(supabase);
   window.addEventListener("online", onOnline);
   return () => window.removeEventListener("online", onOnline);
 }, []);

  const isLoading = status === "submitted" || status === "streaming";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");

    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      // Persist user message before streaming so the row survives reloads.
      const userMsgId = crypto.randomUUID();
      const res = await insertMessageSafe(supabase, {
       id: userMsgId,
       conversation_id: threadId,
       user_id: u.user.id,
       role: "user",
       content: text,
       parts: [{ type: "text", text }] as never,
        });
      if (!res.ok && !res.queued) {
        toast.error("Could not save your message. Retrying in the background.");
      }
      const isFirst = (messages?.length ?? 0) === 0;
      if (isFirst) {
        await supabase
          .from("conversations")
          .update({ title: text.slice(0, 60) })
          .eq("id", threadId);
        qc.invalidateQueries({ queryKey: ["conversation", threadId] });
      }

      void logActivity({
        module: "planner",
        message: "User message sent",
        metadata: { conversation_id: threadId },
      });

      await sendMessage({ text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send";
      toast.error(msg);
    }
  }

  return (
    <AppShell
      title={conv.data?.title ?? "Chat"}
      subtitle="Conversations with your agent"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/chat">
            <ArrowLeft className="mr-1 h-4 w-4" /> All chats
          </Link>
        </Button>
      }
    >
      <div className="grid h-full grid-cols-1 md:grid-cols-[1fr_320px]">
        <div className="flex h-full min-w-0 flex-col border-r border-border/60">
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-5 p-4 md:p-6">
              {initialMessages.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : messages.length === 0 ? (
                <EmptyState />
              ) : (
                messages.map((m) => <MessageBubble key={m.id} m={m} />)
              )}
              {status === "submitted" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </div>
              )}
              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  {error.message}
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
                    void onSubmit(e as unknown as React.FormEvent);
                  }
                }}
                placeholder="Ask the agent to do something…"
                className="min-h-[44px] max-h-40 resize-none"
                rows={1}
                disabled={isLoading}
              />
              <Button type="submit" disabled={isLoading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>
        <div className="hidden min-h-0 p-3 md:block">
          <AgentActivity className="h-full" />
        </div>
      </div>
    </AppShell>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-surface/40 p-8 text-center">
      <Sparkles className="mx-auto h-8 w-8 text-primary" />
      <h3 className="mt-3 text-base font-semibold">Start a new conversation</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Try: "Remember that I prefer dark UIs" or "Track a task: review pull requests every morning."
      </p>
    </div>
  );
}

function MessageBubble({ m }: { m: UIMessage }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
          isUser
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/60 bg-surface text-foreground"
        }`}
      >
        {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={`min-w-0 max-w-[calc(100%-3rem)] space-y-2 rounded-2xl px-4 py-3 text-sm ${
          isUser
            ? "bg-primary/10 text-foreground"
            : "border border-border/60 bg-surface/60"
        }`}
      >
        {m.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div key={i} className="prose prose-sm prose-invert max-w-none break-words">
                <ReactMarkdown>{part.text}</ReactMarkdown>
              </div>
            );
          }
          if (part.type.startsWith("tool-")) {
            const name = part.type.replace(/^tool-/, "");
            const state = "state" in part ? part.state : "unknown";
            const Icon = name === "create_task" ? ListChecks : Wrench;
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 font-mono text-[11px] text-muted-foreground"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="uppercase tracking-wider text-primary">
                    {name} <span className="text-muted-foreground">· {state}</span>
                  </div>
                  {"input" in part && part.input ? (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-foreground/80">
                      {JSON.stringify(part.input, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
