import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRight, Bot, Globe, Lock, Cpu, MessageSquare, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OpenAgent — Free, modular AI computer assistant" },
      {
        name: "description",
        content:
          "Build an AI that completes tasks on websites and, with permission, on your computer. Open, modular, security-first.",
      },
    ],
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary agent-glow">
            <Bot className="h-4 w-4" />
          </div>
          <span className="font-mono text-sm font-semibold">OpenAgent</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Sign in
          </Link>
          <Button asChild size="sm">
            <Link to="/auth">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-16 pt-16 text-center md:pt-24">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface/60 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Milestone 1 · Foundation
        </div>
        <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
          A free, modular{" "}
          <span className="bg-gradient-to-r from-primary via-primary to-accent-foreground/80 bg-clip-text text-transparent">
            AI computer assistant
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground md:text-lg">
          OpenAgent will help you complete tasks on websites — and, with your explicit
          permission, on your own machine through a secure local companion. Open
          architecture, permission-first, built one milestone at a time.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth">
              Open the app <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <a
            href="https://github.com"
            className="inline-flex h-11 items-center rounded-md border border-border/60 px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            View roadmap
          </a>
        </div>
      </section>

      <section className="relative z-10 mx-auto grid max-w-5xl gap-3 px-6 pb-24 md:grid-cols-3">
        {[
          { icon: MessageSquare, title: "Natural conversation", body: "Chat with an agent that plans, observes, and acts step by step." },
          { icon: Globe, title: "Browser tasks", body: "Open sites, fill forms, download files — soon, fully automated." },
          { icon: Cpu, title: "Local companion", body: "Optional installable bridge to interact with desktop apps you allow." },
          { icon: Workflow, title: "Plugin system", body: "Extend the agent with sandboxed tools and per-scope grants." },
          { icon: Lock, title: "Permission first", body: "Nothing happens without an explicit grant. Every action is logged." },
          { icon: Bot, title: "Modular core", body: "Planner, memory, browser, files — each module is independently swappable." },
        ].map((f) => (
          <div
            key={f.title}
            className="rounded-lg border border-border/60 bg-surface/60 p-5 backdrop-blur"
          >
            <f.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 text-sm font-semibold">{f.title}</div>
            <p className="mt-1 text-xs text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="relative z-10 border-t border-border/60 px-6 py-6 text-center font-mono text-xs text-muted-foreground">
        OpenAgent · open architecture · security-first · v0.1.0
      </footer>
    </div>
  );
}
