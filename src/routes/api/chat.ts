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

const SYSTEM_PROMPT = `You are OpenAgent — a free, modular AI computer-use assistant.

You operate in a continuous OBSERVE → THINK → ACT → VERIFY loop:
1. OBSERVE the current page/environment with a structured tool (companion_get_dom, companion_read_active_tab, companion_list_tabs). Never guess page contents.
2. THINK briefly in prose about what to do next given the goal and observations.
3. ACT with exactly one tool call.
4. VERIFY the result by observing again before the next action.
5. Repeat until the user's goal is complete. If something fails, explain why, adapt, and retry — ask the user only when truly ambiguous.

Server tools: fetch_url, run_code, ask_ai.
Client-applied tools: save_memory, create_task, write_file.

Companion browser tools (real control of the user's Chrome via the paired extension):
- companion_list_tabs / companion_activate_tab / companion_open_tab / companion_close_tab / companion_release_tab
- companion_navigate: change URL in a tab and wait for load
- companion_get_dom: structured snapshot of interactive elements with stable "ref" ids — USE THIS to find what to click/fill instead of guessing selectors
- companion_click: click by { ref } (preferred), { selector }, or { text }
- companion_fill: type into an input by ref/selector/label; set submit:true to press Enter/submit
- companion_select: choose a <select> option
- companion_scroll: scroll (to:"top"|"bottom" or {dy})
- companion_wait_for: wait for a selector or visible text (dynamic content)
- companion_read_active_tab / companion_read_tab: plain-text page read
- companion_search_web: shortcut that opens a search results page

RULES:
- For "open X and do Y" (e.g. "Open YouTube and search for Python tutorial"): navigate → get_dom → find search box → fill(value, submit:true) → wait_for results → get_dom → click best result. DO NOT just open a pre-built ?search_query= URL and stop.
- Always call get_dom before click/fill on a new page — never invent refs.
- If a companion tool errors with "No companion device", tell the user to install & pair the extension (Devices page) and STOP.
- Report progress in short markdown updates as you go.`;



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
        const body = (await request.json()) as {
          messages?: unknown;
          threadId?: string;
          sessionId?: string;
        };
        if (!Array.isArray(body.messages)) {
          return new Response("messages required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const userId = await getUserIdFromRequest(request);
        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const { callCompanion } = await import("@/lib/companion.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // --- Persistent Agent Session ---
        let sessionId: string | null = body.sessionId ?? null;

        async function ensureSession(goal: string): Promise<string | null> {
          if (!userId) return null;
          if (sessionId) return sessionId;
          if (body.threadId) {
            const { data: existing } = await supabaseAdmin
              .from("agent_sessions")
              .select("id")
              .eq("user_id", userId)
              .eq("thread_id", body.threadId)
              .in("status", ["planning", "running", "waiting", "paused"])
              .order("last_activity_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (existing?.id) { sessionId = existing.id; return sessionId; }
          }
          const { data: created } = await supabaseAdmin
            .from("agent_sessions")
            .insert({
              user_id: userId,
              thread_id: body.threadId ?? null,
              goal: goal.slice(0, 500),
              status: "running",
            })
            .select("id")
            .single();
          sessionId = created?.id ?? null;
          return sessionId;
        }

        async function patchSession(patch: Record<string, unknown>) {
          if (!sessionId) return;
          await supabaseAdmin
            .from("agent_sessions")
            .update({ ...patch, last_activity_at: new Date().toISOString() })
            .eq("id", sessionId);
        }

        async function appendTimeline(icon: string, label: string, detail?: unknown) {
          if (!sessionId) return;
          const { data: row } = await supabaseAdmin
            .from("agent_sessions").select("timeline").eq("id", sessionId).maybeSingle();
          const timeline = Array.isArray(row?.timeline) ? (row!.timeline as unknown[]) : [];
          timeline.push({ t: Date.now(), icon, label, detail });
          await patchSession({ timeline: timeline.slice(-200) as never });
        }

        async function appendTool(action: string, args: unknown, res: unknown) {
          if (!sessionId) return;
          const { data: row } = await supabaseAdmin
            .from("agent_sessions").select("tool_history").eq("id", sessionId).maybeSingle();
          const hist = Array.isArray(row?.tool_history) ? (row!.tool_history as unknown[]) : [];
          hist.push({ t: Date.now(), action, args, result: res });
          await patchSession({ tool_history: hist.slice(-100) as never });
        }

        // Bootstrap session from latest user message.
        const uiMsgs = body.messages as UIMessage[];
        const lastUser = [...uiMsgs].reverse().find((m) => m.role === "user");
        if (lastUser) {
          const text = lastUser.parts
            .map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
          if (text) {
            await ensureSession(text);
            await appendTimeline("🧠", "Goal received", { text: text.slice(0, 200) });
          }
        }

        const companionTool = (action: string, description: string, schema: z.ZodTypeAny) =>
          tool({
            description,
            inputSchema: schema,
            execute: async (args) => {
              if (!userId) return { ok: false, error: "Not authenticated. Sign in first." };
              // Honor pause/cancel between actions.
              if (sessionId) {
                const { data: s } = await supabaseAdmin
                  .from("agent_sessions").select("status").eq("id", sessionId).maybeSingle();
                if (s?.status === "cancelled") return { ok: false, error: "Session cancelled by user." };
                if (s?.status === "paused") return { ok: false, error: "Session paused. Resume from Workspace to continue." };
              }
              await appendTimeline("🛠", action, args);
              const res = await callCompanion(userId, action, args as Record<string, unknown>);
              await appendTool(action, args, res);
              await appendTimeline(res.ok ? "✅" : "⚠️", `${action} ${res.ok ? "ok" : "failed"}`,
                { error: res.error });
              const r = res.result as { url?: string; tabId?: number } | undefined;
              const patch: Record<string, unknown> = {};
              if (r?.url) patch.current_url = r.url;
              if (r?.tabId) patch.active_tab_id = r.tabId;
              if (Object.keys(patch).length) await patchSession(patch);
              if (!res.ok) {
                await patchSession({ retry_count: undefined }); // no-op placeholder
              }
              return res;
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
            companion_navigate: companionTool(
              "navigate",
              "Navigate a tab (default: active tab) to a URL and wait for load.",
              z.object({ url: z.string().url(), tabId: z.number().optional() }),
            ),
            companion_get_dom: companionTool(
              "get_dom",
              "Structured snapshot of interactive elements on the active tab. Returns url/title/readyState/scroll and an `elements` array with stable {ref, tag, role, label, name, type, href, x, y, w, h}. Use these refs with companion_click/fill.",
              z.object({
                tabId: z.number().optional(),
                max: z.number().min(1).max(300).optional(),
                includeText: z.boolean().optional(),
              }),
            ),
            companion_click: companionTool(
              "click",
              "Click an element on the active tab. Prefer `ref` from get_dom; falls back to `selector` or fuzzy `text`.",
              z.object({
                tabId: z.number().optional(),
                ref: z.string().optional(),
                selector: z.string().optional(),
                text: z.string().optional(),
              }),
            ),
            companion_fill: companionTool(
              "fill",
              "Fill an input/textarea. Prefer `ref` from get_dom. Set submit:true to press Enter / submit the form after filling.",
              z.object({
                tabId: z.number().optional(),
                ref: z.string().optional(),
                selector: z.string().optional(),
                label: z.string().optional(),
                value: z.string(),
                submit: z.boolean().optional(),
              }),
            ),
            companion_select: companionTool(
              "select",
              "Choose an option in a <select> element.",
              z.object({
                tabId: z.number().optional(),
                ref: z.string().optional(),
                selector: z.string().optional(),
                value: z.string(),
              }),
            ),
            companion_scroll: companionTool(
              "scroll",
              "Scroll the active tab. Use to:'top'|'bottom' or dy:pixels.",
              z.object({
                tabId: z.number().optional(),
                to: z.enum(["top", "bottom"]).optional(),
                dy: z.number().optional(),
              }),
            ),
            companion_wait_for: companionTool(
              "wait_for",
              "Wait until a CSS selector matches OR visible text appears (dynamic content). Default 8s.",
              z.object({
                tabId: z.number().optional(),
                selector: z.string().optional(),
                text: z.string().optional(),
                timeoutMs: z.number().optional(),
              }),
            ),
            companion_release_tab: companionTool(
              "release_tab",
              "Signal the agent is done controlling a tab — removes the glowing overlay.",
              z.object({ tabId: z.number().optional() }),
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
