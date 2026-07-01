import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { fetchUrl } from "@/lib/browser-fetch.server";
import { runJs } from "@/lib/code-runner.server";

const SYSTEM_PROMPT = `You are OpenAgent — a free, modular AI computer assistant.

You can do real work today using these tools:

Memory / tasks / files (client-applied):
- save_memory, create_task, write_file

Server-side research & compute:
- fetch_url: fetch any http(s) URL (title, text, links, status). 15s / 1.5MB caps.
- run_code: run JS on the server (5s timeout, top-level await, console captured).
- ask_ai: delegate a sub-prompt to another Lovable AI Gateway model.

Companion (talks to the user's paired browser extension — REAL browser control on their device):
- companion_list_tabs: list every tab in every window the user has open.
- companion_open_tab: open a URL in a new tab.
- companion_close_tab: close a tab by id.
- companion_activate_tab: focus a tab by id (bring window forward + activate).
- companion_search_web: run a Google/DuckDuckGo/Bing search — opens a new tab with the result page.
- companion_read_active_tab: read title, URL, and visible text of the currently active tab.
- companion_read_tab: same, for a specific tabId.

Rules:
1. Companion tools require the user to have installed the OpenAgent Companion Chrome extension and paired it (Devices page). If a companion tool errors with "No companion device", tell the user how to install it and STOP — do not retry.
2. Before using companion_open_tab or companion_search_web for the first time in a session, ask the user for confirmation if the request is ambiguous. Otherwise proceed.
3. Report what you did, in plain markdown. Show tab titles/URLs when relevant.
4. Never fabricate tab contents — always call the tool.
5. Use fetch_url for public pages, use companion tools when the user asks about "my tabs", "open X", "search for X in my browser".`;

async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(body.messages)) {
          return new Response("messages required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const userId = await getUserIdFromRequest(request);
        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        // Lazy-import companion helper (server-only)
        const { callCompanion } = await import("@/lib/companion.server");

        const companionTool = (action: string, description: string, schema: z.ZodTypeAny) =>
          tool({
            description,
            inputSchema: schema,
            execute: async (args) => {
              if (!userId) {
                return { ok: false, error: "Not authenticated. Sign in first." };
              }
              return callCompanion(userId, action, args as Record<string, unknown>);
            },
          });

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(body.messages as UIMessage[]),
          stopWhen: stepCountIs(50),
          tools: {
            save_memory: tool({
              description:
                "Save something the user wants the agent to remember (workflow, preference, site, note, fact).",
              inputSchema: z.object({
                kind: z.enum(["workflow", "preference", "site", "note", "fact"]),
                label: z.string().min(1).max(120),
                value: z.string().max(2000),
              }),
            }),
            create_task: tool({
              description: "Create a persistent task record for a multi-step user goal.",
              inputSchema: z.object({ goal: z.string().min(3).max(280) }),
            }),
            write_file: tool({
              description:
                "Write a document to the user's private storage. Path is relative to their folder.",
              inputSchema: z.object({
                path: z.string().min(1).max(200),
                content: z.string().max(200_000),
                contentType: z.string().optional(),
              }),
            }),

            fetch_url: tool({
              description:
                "Fetch a public http(s) URL. Returns status, final URL, title, readable text, links.",
              inputSchema: z.object({ url: z.string().url() }),
              execute: async ({ url }) => {
                try {
                  const r = await fetchUrl(url);
                  return {
                    ok: r.ok,
                    status: r.status,
                    finalUrl: r.finalUrl,
                    title: r.title,
                    contentType: r.contentType,
                    text: r.text,
                    links: r.links.slice(0, 20),
                    bytes: r.bytes,
                    truncated: r.truncated,
                    elapsedMs: r.elapsedMs,
                  };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            run_code: tool({
              description: "Run a short JS snippet on the server. 5s timeout.",
              inputSchema: z.object({ code: z.string().min(1).max(20_000) }),
              execute: async ({ code }) => runJs(code),
            }),
            ask_ai: tool({
              description:
                "Delegate a sub-prompt to another Lovable AI Gateway model. Zero-config for the user.",
              inputSchema: z.object({
                prompt: z.string().min(1).max(8000),
                system: z.string().max(2000).optional(),
                model: z.string().max(120).optional(),
              }),
              execute: async ({ prompt, system, model: modelId }) => {
                try {
                  const subModel = gateway(modelId || "google/gemini-3-flash-preview");
                  const sub = await streamText({ model: subModel, system, prompt });
                  let text = "";
                  for await (const chunk of sub.textStream) text += chunk;
                  return { ok: true, text };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),

            // --- Companion (browser extension) ---
            companion_list_tabs: companionTool(
              "list_tabs",
              "List all open browser tabs across all windows on the user's device.",
              z.object({}),
            ),
            companion_open_tab: companionTool(
              "open_tab",
              "Open a URL in a new tab on the user's browser.",
              z.object({ url: z.string().url(), active: z.boolean().optional() }),
            ),
            companion_close_tab: companionTool(
              "close_tab",
              "Close a browser tab by id.",
              z.object({ tabId: z.number() }),
            ),
            companion_activate_tab: companionTool(
              "activate_tab",
              "Bring a tab (and its window) to the foreground.",
              z.object({ tabId: z.number() }),
            ),
            companion_search_web: companionTool(
              "search_web",
              "Run a web search on the user's browser (opens a new tab with results).",
              z.object({
                query: z.string().min(1).max(400),
                engine: z.enum(["google", "duckduckgo", "bing"]).optional(),
              }),
            ),
            companion_read_active_tab: companionTool(
              "read_active_tab",
              "Read title, URL, and visible text of the user's currently active tab.",
              z.object({}),
            ),
            companion_read_tab: companionTool(
              "read_tab",
              "Read a specific tab's title, URL, and text by tabId.",
              z.object({ tabId: z.number() }),
            ),
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages as UIMessage[],
        });
      },
    },
  },
});
