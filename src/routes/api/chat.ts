import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { createGoogleProvider, createOpenRouterProvider } from "@/lib/ai-gateway.server";
import { resolveFreeModel, resolveKeys, noProviderError } from "@/lib/free-providers.server";
import { fetchUrl } from "@/lib/browser-fetch.server";
import { runJs } from "@/lib/code-runner.server";
import { requirePermission } from "@/lib/permissions.server";
import { executePythonTool, isPythonServiceHealthy, listPythonWorkspaceFiles, recallPythonMemory, runPythonAgent } from "@/lib/python-bridge.server";
import {
  ensureVM, createVM, vmExecuteCommand, vmWriteFile, vmReadFile, vmListFiles,
  getAppTools, type VMState,
} from "@/lib/vm.server";

const SYSTEM_PROMPT = `You are OpenAgent — a free, modular AI computer-use assistant.

You operate in a continuous OBSERVE → THINK → ACT → VERIFY loop with hybrid perception:

EFFICIENCY (you are running on a rate-limited API tier):
  - Every tool call and every model turn consumes quota shared across all
    your sessions. Don't observe speculatively, don't screenshot "just in
    case," and don't call ask_ai unless the task genuinely needs a second
    model's judgment — it costs an additional request on the same quota.
  - Prefer the FAST PATH below whenever conditions allow it. Fewer, more
    decisive tool calls beat many small cautious ones.
  - Plan generously up front (plan_session) so you don't need to re-plan
    mid-task, which costs extra turns.

OBSERVATION PRIORITY (always in this order):
  1. companion_observe   — structured DOM + accessibility + page state (PRIMARY)
  2. companion_read_active_tab / companion_list_tabs — text + tab context
  3. companion_screenshot — VISION FALLBACK ONLY when structured data is
     insufficient (canvas, webgl, pdf viewer, image-only UI, missing DOM).
     Never poll screenshots on a loop.

LOOP:
  1. OBSERVE with companion_observe (or companion_read_active_tab). Never
     guess page contents. The observation object gives you: url, title,
     pageState (ready|loading|error|dialog-open), summary, headings,
     landmarks, forms, tables, lists, dialogs, errors, loading indicators,
     images with alt text, paragraphs, and interactive \`elements[]\` with
     stable refs.
  2. THINK: set_reasoning with 1-3 sentences of plan/rationale.
  3. ACT with exactly one tool call, preferring a \`ref\` from the last
     observation for click/fill/select.
  4. VERIFY by observing again (or companion_wait_for) BEFORE the next act.
     Never assume an action succeeded.
  5. On failure: read the error → set_reasoning with a recovery plan →
     record_recovery({ attempt, strategy }) → wait the returned backoffMs →
     retry with an ALTERNATIVE (different ref/selector, wait_for
     visible/enabled, scroll, re-navigate, dismiss dialog, screenshot
     fallback). Never repeat the exact same action after a failure.

RECOVERY CAPS (server-enforced):
  - Max 4 recovery attempts per step, 8 per session.
  - record_recovery returns { attempt, backoffMs, capped }. When
    capped:true, STOP retrying that step: escalate via update_step
    status:"failed", set_reasoning why, and either try a different
    step, ask the user, or complete_session with the partial result.
  - Backoff is exponential (400ms → 800ms → 1600ms → 3200ms, capped
    5000ms). Honor it via companion_wait_for mode:"dom-stable" or a
    short delay before the next act.

VERIFICATION CRITERIA — after every ACT, an action is only "successful"
when at least ONE of these holds on the NEXT observation:
  - the target URL changed as expected (navigate/click that follows a link),
  - a new element referenced by the plan appears (post-click UI, dialog,
    result list, next form step),
  - the field value in \`elements[]\` matches what you typed (fill/select),
  - a redirected/final URL settled with pageState:"ready" (slow sites),
  - a known success text/toast/heading appears (search results, "Signed in").
If NONE hold, treat the step as failed and enter the recovery flow above.

INTELLIGENT WAITING — companion_wait_for modes:
  - mode:"selector"  — CSS selector exists
  - mode:"visible"   — selector exists AND is visible
  - mode:"enabled"   — selector visible AND not disabled
  - mode:"text"      — visible text appears
  - mode:"ready"     — document.readyState === "complete"
  - mode:"dialog"    — a modal dialog opens
  - mode:"dom-stable"— DOM stops mutating (quietMs, default 500)
Use these instead of fixed sleeps. On slow or redirect-heavy sites,
chain: wait_for ready → wait_for dom-stable → observe.


BROWSER MEMORY — call set_browser_memory to remember, for the current session:
  - visitedUrls, previousSearches, completedObjectives, currentObjective,
    knownTabs, notes. Reference it before re-searching or re-navigating.

SESSION TOOLS (ALWAYS for multi-step goals — the Workspace shows them live):
  - plan_session({ steps })     — call FIRST
  - set_reasoning({ reasoning })
  - update_step({ index, status, note })
  - record_recovery({ attempt, strategy, note })  — when retrying after failure
  - set_browser_memory({ memory }) — merge session memory
  - complete_session({ summary })

VIRTUAL COMPUTER — this is your PRIMARY workspace. It is a persistent,
  observable compatibility computer, not a hosted native OS. Use its tools
  before optional Python services for files, code, public web research, and
  delegation:
  - vm_terminal({ command })  — run shell commands (ls, cat, mkdir, echo, run, etc.)
  - vm_write_file({ path, content }) — create/edit files in your workspace
  - vm_read_file({ path })     — read a file
  - vm_list_files({ path })    — list directory contents
  - vm_run_code({ code })      — execute JavaScript in your sandbox
  - vm_browse({ url })         — visit a public page and save a readable snapshot
  Your workspace persists across the conversation. Use it to write docs, save
  research, run code, and organize files. The user watches your computer live
  in the chat cockpit and Computer view. Never claim it is unavailable just
  because the optional Python browser is offline; vm_browse is independent.
  When a request needs files, code, terminal work, isolated browsing, or
  delegation, call the relevant virtual-computer tool instead of merely
  describing what you could do.

SUB-AGENTS — for complex multi-part goals, spawn specialized sub-agents that
  each get their own mini-computer with a restricted set of apps:
  - spawn_subagent({ name, goal, apps }) — launch a sub-agent. For independent
    workstreams, issue multiple spawn_subagent calls in the SAME model step so
    they execute concurrently. apps is a
    list from: terminal, editor, filesystem, code-runner, web-browser,
    ai-brain, researcher, writer, analyst. The sub-agent runs independently
    with its own VM and tool set.
  - send_to_subagent({ subAgentId, message }) — send a follow-up instruction.
  - list_subagents — check status of all sub-agents.
  Sub-agents do NOT use the user's browser — they work in their own isolated
  VMs with only the apps you assign them.

SERVER TOOLS: fetch_url, run_code, ask_ai (ask_ai calls a second model —
  use only when genuinely needed, not as a default reasoning aid).
CLIENT-APPLIED: save_memory, create_task, write_file.
PYTHON SERVICE (optional, may be unavailable): delegate_to_python_agent for
  Python-native sub-goals — it internally routes to research (plain HTTP),
  browsing (headless JS-rendering browser, no login), coding (sandboxed
  Python in a persistent workspace), or file (PDF/DOCX/image parsing in
  that workspace) specialists as needed. use_agent_browser gives direct
  control of the agent's OWN persistent browser (its own login/cookies,
  separate from companion_* which controls the USER's browser) — navigate,
  click, fill, screenshot, upload, tabs. list_python_workspace shows files
  the Python agent has produced. recall_python_memory does semantic recall
  over past sessions. All no-op gracefully with an error if the service
  isn't configured — check the returned { ok } before relying on the result.

COMPANION BROWSER (real Chrome control):
  companion_list_tabs, companion_activate_tab, companion_open_tab,
  companion_close_tab, companion_release_tab, companion_navigate,
  companion_observe, companion_click, companion_fill, companion_select,
  companion_scroll, companion_wait_for, companion_read_active_tab,
  companion_read_tab, companion_search_web, companion_screenshot.

RULES:
- For "open X and do Y": plan_session first, then navigate → observe → act →
  wait_for → observe → verify. DO NOT open a pre-built ?q= URL and stop.
- Always observe before click/fill on a new page — never invent refs.
- Prefer structured observation over screenshots. Screenshot only when the
  DOM cannot describe the UI.
- If a companion tool errors with "No companion device", tell the user to
  install & pair the extension (Devices page) and STOP.
- Keep the conversation clean: do not narrate raw tool inputs/outputs or logs.
  Emit only useful progress, decision summaries, deliverables, and blockers.
  set_reasoning feeds the visible Decision summary outside the message stream.

STOPPING CONDITIONS — always end a session in one of these states, never
leave it hanging:
  - Goal fully achieved → complete_session with a summary.
  - A step is capped (record_recovery returned capped:true) → update_step
    status:"failed" with a clear note, then either move to a different
    step, ask the user a direct question, or complete_session with the
    partial result. Do not keep retrying past the cap.
  - The AI provider itself errors (rate limit, quota, auth) — this is not
    something you can fix by retrying the same request. Stop cleanly;
    the server surfaces this to the user directly.

FAST PATH (high-speed execution) — for simple, high-confidence actions
(clicking a labelled button you just observed, typing into a labelled
field, selecting a dropdown value, opening a known URL, switching to a
listed tab):
  - Skip re-observing if the last observation is <5 s old and the URL
    hasn't changed. Reuse its refs.
  - Batch: several fills into the same form can run back-to-back before
    the next observe. Always observe once after the final submit.
  - Skip set_reasoning for a single trivial action inside a larger plan.
  - companion_click returns { urlChanged, method, occluded } — treat
    urlChanged:true (for link/submit clicks) as verification and skip the
    extra observe.
For anything ambiguous, novel, or after a failure — fall back to the full
Observe → Think → Act → Verify loop.`;



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

        const userId = await getUserIdFromRequest(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Unified free-tier provider chain: Groq → Gemini → OpenRouter → Cerebras.
        // Each provider/model has per-failure cooldowns so a bad model is
        // skipped on the next request. Keys are resolved from the user's
        // stored provider_keys, falling back to server-side env vars.
        const keys = await resolveKeys(userId, supabaseAdmin);
        const provider = await resolveFreeModel(keys);
        if (!provider) {
          return new Response(noProviderError(), { status: 500 });
        }
        let model = provider.model;
        let providerLabel = provider.label;
        let activeFreeModelId: string | null = provider.modelId;
        let activeProviderRef = provider; // for onError markDown
        // Keys kept for ask_ai delegation tool
        const openrouterKey = keys.openrouterKey;


// Health-check the primary provider with a tiny, cheap call. Free-tier
// providers (esp. volunteer-hosted ones like Darkbloom) can be down or
// returning empty responses without warning — don't let that take the

        const { callCompanion } = await import("@/lib/companion.server");

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

        async function appendScreenshot(entry: Record<string, unknown>) {
          if (!sessionId) return;
          const { data: row } = await supabaseAdmin
            .from("agent_sessions").select("screenshots").eq("id", sessionId).maybeSingle();
          const list = Array.isArray(row?.screenshots) ? (row!.screenshots as unknown[]) : [];
          list.push({ t: Date.now(), ...entry });
          await patchSession({ screenshots: list.slice(-30) as never });
        }

        async function mergeBrowserMemory(patch: Record<string, unknown>) {
          if (!sessionId) return;
          const { data: row } = await supabaseAdmin
            .from("agent_sessions").select("browser_memory").eq("id", sessionId).maybeSingle();
          const cur = (row?.browser_memory && typeof row.browser_memory === "object")
            ? (row.browser_memory as Record<string, unknown>) : {};
          // Arrays merge uniquely, scalars overwrite.
          const merged: Record<string, unknown> = { ...cur };
          for (const [k, v] of Object.entries(patch)) {
            if (Array.isArray(v)) {
              const prev = Array.isArray(cur[k]) ? cur[k] as unknown[] : [];
              merged[k] = Array.from(new Set([...prev, ...v].map(String))).slice(-100);
            } else {
              merged[k] = v;
            }
          }
          await patchSession({ browser_memory: merged as never });
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

        if (userId) {
          try {
            await requirePermission(supabaseAdmin, userId, "computer:use");
            const vmState = await ensureVM(supabaseAdmin, userId, sessionId);
            await appendTimeline("🖥️", "Virtual computer ready", { vmId: vmState.id });
          } catch (error) {
            await appendTimeline("🔒", "Virtual computer disabled", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const companionTool = (action: string, description: string, schema: z.ZodTypeAny) =>
          tool({
            description,
            inputSchema: schema,
            execute: async (args) => {
              try {
                if (!userId) return { ok: false, error: "Not authenticated. Sign in first." };
                if (sessionId) {
                  const { data: s } = await supabaseAdmin
                    .from("agent_sessions").select("status").eq("id", sessionId).maybeSingle();
                  if (s?.status === "cancelled") return { ok: false, error: "Session cancelled by user." };
                  if (s?.status === "paused") return { ok: false, error: "Session paused. Resume from Workspace to continue." };
                }
                // Waiting-status hint for the workspace panel.
                if (action === "wait_for" || action === "navigate") {
                  await patchSession({ waiting_status: `${action} ${JSON.stringify(args).slice(0, 80)}` });
                }
                await appendTimeline("🛠", action, args);
                const res = await callCompanion(userId, action, args as Record<string, unknown>);
                await appendTool(action, args, res);
                await appendTimeline(res.ok ? "✅" : "⚠️", `${action} ${res.ok ? "ok" : "failed"}`,
                  { error: res.error });
                const r = res.result as {
                  url?: string; tabId?: number; title?: string;
                  summary?: string; pageState?: string;
                } | undefined;
                const patch: Record<string, unknown> = { waiting_status: null };
                if (r?.url) patch.current_url = r.url;
                if (r?.tabId) patch.active_tab_id = r.tabId;
                if (action === "observe" || action === "get_dom") {
                  if (r?.summary) patch.observation_summary = r.summary;
                  if (r?.pageState) patch.page_summary = `${r.title ?? ""} — ${r.pageState}`;
                  // Auto-remember visited URLs.
                  if (r?.url) {
                    await mergeBrowserMemory({ visitedUrls: [r.url] });
                  }
                }
                await patchSession(patch);
                return res;
              } catch (e) {
                return { ok: false, action, error: e instanceof Error ? e.message : String(e) };
              }
            },
          });

        // new
// new
// new
const result = streamText({
 model,
 system: SYSTEM_PROMPT,
 messages: await convertToModelMessages(body.messages as UIMessage[]),
 stopWhen: stepCountIs(20),
 maxRetries: 3,
 abortSignal: AbortSignal.timeout(300_000), // 5 min — must stay well above callCompanion's per-call timeout (45s default) since a plan can involve many sequential browser round-trips
 prepareStep: async ({ stepNumber }) => {
   if (stepNumber > 0) await new Promise((r) => setTimeout(r, 4300));
   return {};
 },
 // Don't hard-exclude Darkbloom — for this free model it may be the only
 // provider with capacity, and excluding it can leave zero providers
 // available (which is what just happened). Let OpenRouter's own routing
 // pick the best available option instead.
 onError: async ({ error }) => {
   const details = (error as { responseBody?: unknown; data?: unknown; cause?: unknown });
   console.error("[/api/chat] generation error — full detail:", {
     message: error instanceof Error ? error.message : String(error),
     responseBody: details.responseBody,
     data: details.data,
     cause: details.cause,
   });
     const message = error instanceof Error ? error.message : String(error);
     // Rotate away from the active provider/model so the next request picks another one.
     if (activeProviderRef) activeProviderRef.markDown(error);
    await patchSession({
      status: "failed",
      reasoning: `Generation error: ${message}`,
    });
    await appendTimeline("🛑", "Generation failed", { error: message });

 },
  tools: {
            plan_session: tool({
              description:
                "FIRST STEP for any multi-step browser goal. Create a live task tree of ordered steps. Steps appear in the user's Workspace immediately.",
              inputSchema: z.object({
                steps: z.array(z.string().min(2).max(160)).min(1).max(20),
              }),
              execute: async ({ steps }) => {
                try {
                  const tree = steps.map((label, i) => ({ i, label, status: "pending" }));
                  await patchSession({ task_tree: tree as never, current_step: 0, status: "running" });
                  await appendTimeline("📋", "Plan created", { steps });
                  return { ok: true, sessionId, steps: tree };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            update_step: tool({
              description:
                "Mark a task-tree step as running / done / failed / skipped. Call as you progress.",
              inputSchema: z.object({
                index: z.number().int().min(0),
                status: z.enum(["running", "done", "failed", "skipped"]),
                note: z.string().max(400).optional(),
              }),
              execute: async ({ index, status, note }) => {
                try {
                  if (!sessionId) return { ok: false, error: "no session" };
                  const { data: row } = await supabaseAdmin
                    .from("agent_sessions").select("task_tree").eq("id", sessionId).maybeSingle();
                  const tree = Array.isArray(row?.task_tree) ? (row!.task_tree as Array<Record<string, unknown>>) : [];
                  if (tree[index]) { tree[index].status = status; if (note) tree[index].note = note; }
                  await patchSession({ task_tree: tree as never, current_step: index });
                  await appendTimeline(
                    status === "done" ? "✅" : status === "failed" ? "❌" : status === "skipped" ? "⏭" : "▶️",
                    `Step ${index + 1}: ${status}`,
                    { note },
                  );
                  return { ok: true };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            set_reasoning: tool({
              description:
                "Record current chain-of-thought so the user sees WHY. Keep it short — 1-3 sentences.",
              inputSchema: z.object({ reasoning: z.string().min(1).max(600) }),
              execute: async ({ reasoning }) => {
                try {
                  await patchSession({ reasoning });
                  await appendTimeline("💭", "Thinking", { reasoning });
                  return { ok: true };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            record_recovery: tool({
              description:
                "Record a recovery attempt after an action failed. Increments retry_count and returns { attempt, backoffMs, capped, perStep, perSession }. Server enforces MAX_PER_STEP=4 and MAX_PER_SESSION=8; when capped:true STOP retrying that step and escalate (update_step failed, ask user, or move on).",
              inputSchema: z.object({
                strategy: z.string().min(2).max(300),
                attempt: z.number().int().min(1).max(20).optional(),
                stepIndex: z.number().int().min(0).max(200).optional(),
                note: z.string().max(400).optional(),
              }),
              execute: async ({ strategy, attempt, stepIndex, note }) => {
                try {
                  if (!sessionId) return { ok: false };
                  const MAX_PER_STEP = 4;
                  const MAX_PER_SESSION = 8;
                  const BACKOFFS = [400, 800, 1600, 3200, 5000];

                  const { data: row } = await supabaseAdmin
                    .from("agent_sessions")
                    .select("retry_count, tool_history, current_step")
                    .eq("id", sessionId)
                    .maybeSingle();
                  const perSession = (row?.retry_count ?? 0) + 1;
                  const effectiveStep =
                    typeof stepIndex === "number" ? stepIndex : (row?.current_step ?? 0);
                  // Count prior recovery events for this step from tool_history.
                  const history = Array.isArray(row?.tool_history) ? row!.tool_history as Array<Record<string, unknown>> : [];
                  const priorForStep = history.filter(
                    (h) => h?.tool === "record_recovery" && (h?.stepIndex ?? -1) === effectiveStep,
                  ).length;
                  const perStep = priorForStep + 1;
                  const capped = perStep > MAX_PER_STEP || perSession > MAX_PER_SESSION;
                  const backoffMs = capped
                    ? 0
                    : BACKOFFS[Math.min(perStep - 1, BACKOFFS.length - 1)];

                  await patchSession({
                    retry_count: attempt ?? perSession,
                    recovery_status: capped
                      ? `CAPPED after ${perStep - 1} attempts on step ${effectiveStep}: ${strategy.slice(0, 240)}`
                      : `${strategy.slice(0, 260)} (attempt ${perStep}/${MAX_PER_STEP}, backoff ${backoffMs}ms)`,
                    waiting_status: capped ? null : `backoff ${backoffMs}ms`,
                  });
                  await appendTool("record_recovery", { strategy, stepIndex: effectiveStep, note }, { attempt: perStep, backoffMs, capped });
                  await appendTimeline(
                    capped ? "🛑" : "🔁",
                    capped
                      ? `Recovery cap reached (step ${effectiveStep})`
                      : `Recovery ${perStep}/${MAX_PER_STEP}: ${strategy}`,
                    { note, backoffMs, perSession, perStep },
                  );
                  return { ok: true, attempt: perStep, backoffMs, capped, perStep, perSession };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),

            set_browser_memory: tool({
              description:
                "Merge fields into the current session's browser memory (visitedUrls, previousSearches, completedObjectives, currentObjective, knownTabs, notes). Arrays are unioned; scalars overwrite.",
              inputSchema: z.object({
                memory: z.object({
                  currentObjective: z.string().max(300).optional(),
                  completedObjectives: z.array(z.string().max(300)).optional(),
                  visitedUrls: z.array(z.string().max(400)).optional(),
                  previousSearches: z.array(z.string().max(200)).optional(),
                  knownTabs: z.array(z.string().max(200)).optional(),
                  notes: z.string().max(1000).optional(),
                }),
              }),
              execute: async ({ memory }) => {
                try {
                  await mergeBrowserMemory(memory as Record<string, unknown>);
                  await appendTimeline("🧾", "Browser memory updated", memory);
                  return { ok: true };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            complete_session: tool({
              description: "Mark the current agent session complete when the goal is fully done.",
              inputSchema: z.object({ summary: z.string().max(600).optional() }),
              execute: async ({ summary }) => {
                try {
                  await patchSession({
                    status: "completed",
                    completed_at: new Date().toISOString(),
                    reasoning: summary,
                    waiting_status: null,
                  });
                  await appendTimeline("🎉", "Goal completed", { summary });
                  return { ok: true };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),

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
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await requirePermission(supabaseAdmin, userId, "browser:use");
                  const r = await fetchUrl(url);
                  return {
                    ok: r.ok, status: r.status, finalUrl: r.finalUrl,
                    title: r.title, contentType: r.contentType, text: r.text,
                    links: r.links.slice(0, 20),
                    bytes: r.bytes, truncated: r.truncated, elapsedMs: r.elapsedMs,
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
                  const subModel = modelId ? (openrouterKey
                    ? createOpenRouterProvider(openrouterKey)(modelId)
                    : model) : model;
                  const sub = await streamText({ model: subModel, system, prompt });
                  let text = "";
                  for await (const chunk of sub.textStream) text += chunk;
                  return { ok: true, text };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),

            use_agent_browser: tool({
              description:
                "Control the agent's OWN persistent browser (separate from companion_* tools, " +
                "which control the USER's real browser instead). Cookies/login persist across " +
                "calls in this browser's own profile. Actions: 'navigate' (args: {url}), " +
                "'click' (args: {selector}), 'fill' (args: {selector, text}), 'screenshot' " +
                "(args: {filename}), 'upload_file' (args: {selector, workspace_path}), " +
                "'list_tabs' (no args), 'new_tab' (args: {url?}), 'close_tab' (args: {tab_index}), " +
                "'close_session' (no args). This browser does NOT auto-login to anything — if a " +
                "page needs a login the agent doesn't have, tell the user to run " +
                "`python scripts/login_google.py <user_id>` once themselves; don't try to type " +
                "credentials into login forms.",
              inputSchema: z.object({
                action: z.enum([
                  "navigate",
                  "click",
                  "fill",
                  "screenshot",
                  "upload_file",
                  "list_tabs",
                  "new_tab",
                  "close_tab",
                  "close_session",
                ]),
                args: z.record(z.string(), z.unknown()).default({}),
              }),
              execute: async ({ action, args }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await requirePermission(supabaseAdmin, userId, "browser:use");
                  if (!(await isPythonServiceHealthy())) {
                    return { ok: false, error: "Python service is not reachable or not configured." };
                  }
                  const toolName = `agent_browser_${action}`;
                  const needsSession = action === "screenshot" || action === "upload_file";
                  const input: Record<string, unknown> = {
                    user_id: userId,
                    ...(needsSession ? { session_id: sessionId ?? "default" } : {}),
                    ...args,
                  };
                  return await executePythonTool(toolName, input, ["agent_browser"]);
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            delegate_to_python_agent: tool({
              description:
                "Delegate a sub-goal to the Python multi-agent service (planner -> " +
                "research/browsing/coding/file specialists). Use ONLY for Python-native needs " +
                "(data-heavy analysis, sandboxed code execution, PDF/DOCX parsing, JS-rendered " +
                "page reads, semantic long-term memory) that the JS tools above can't do well. " +
                "Not a substitute for companion_* browser tools when login/authenticated browsing " +
                "is needed. The agent gets its own persistent workspace directory (files survive " +
                "across calls within this session) — use list_python_workspace to see what's in it. " +
                "Requires the Python service to be running and configured.",
              inputSchema: z.object({ goal: z.string().min(1).max(4000) }),
              execute: async ({ goal }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  if (!(await isPythonServiceHealthy())) {
                    return { ok: false, error: "Python service is not reachable or not configured." };
                  }
                  const result = await runPythonAgent(goal, userId, body.threadId, sessionId ?? undefined);
                  return { ok: true, ...result };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            list_python_workspace: tool({
              description:
                "List files currently in this session's Python agent workspace " +
                "(written by delegate_to_python_agent's coding/file steps).",
              inputSchema: z.object({}),
              execute: async () => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  if (!sessionId) return { ok: true, files: [] };
                  if (!(await isPythonServiceHealthy())) {
                    return { ok: false, error: "Python service is not reachable or not configured." };
                  }
                  const files = await listPythonWorkspaceFiles(userId, sessionId);
                  return { ok: true, files };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            recall_python_memory: tool({
              description:
                "Semantic search over this user's long-term memory (Python vector store). " +
                "Use when you need to recall something from past sessions that isn't in the current context.",
              inputSchema: z.object({ query: z.string().min(1).max(500) }),
              execute: async ({ query }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  if (!(await isPythonServiceHealthy())) {
                    return { ok: false, error: "Python service is not reachable or not configured." };
                  }
                  const memories = await recallPythonMemory(userId, query);
                  return { ok: true, memories };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),

            // --- Virtual Computer (VM) ---
            vm_terminal: tool({
              description:
                "Run a terminal command on your virtual computer. Supports: ls, cat, echo, mkdir, touch, rm, write, head, tail, wc, pwd, cd, date, whoami, uname, clear, help, neofetch, tree, find, grep, apps, run <lang> <code>. Your workspace (filesystem + current directory) persists across calls.",
              inputSchema: z.object({ command: z.string().min(1).max(2000) }),
              execute: async ({ command }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await requirePermission(supabaseAdmin, userId, "computer:use");
                  const vmState = await ensureVM(supabaseAdmin, userId, sessionId);
                  const { output, state } = await vmExecuteCommand(
                    supabaseAdmin, vmState.id, vmState, command,
                  );
                  await appendTimeline("💻", "vm: " + command.slice(0, 80), { output: output.slice(0, 200) });
                  return { ok: true, output, cwd: state.cwd };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            vm_write_file: tool({
              description: "Write a file to your virtual computer's filesystem. Path is relative to /home/agent. Content is saved persistently.",
              inputSchema: z.object({
                path: z.string().min(1).max(300),
                content: z.string().max(500_000),
              }),
              execute: async ({ path, content }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await requirePermission(supabaseAdmin, userId, "computer:use");
                  const vmState = await ensureVM(supabaseAdmin, userId, sessionId);
                  const { fs } = await vmWriteFile(supabaseAdmin, vmState.id, vmState.fs, path, content);
                  await appendTimeline("📝", "vm write: " + path, { bytes: content.length });
                  return { ok: true, path, size: content.length };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            vm_read_file: tool({
              description: "Read a file from your virtual computer. Returns the file content.",
              inputSchema: z.object({ path: z.string().min(1).max(300) }),
              execute: async ({ path }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await requirePermission(supabaseAdmin, userId, "computer:use");
                  const vmState = await ensureVM(supabaseAdmin, userId, sessionId);
                  return vmReadFile(vmState.fs, path);
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            vm_list_files: tool({
              description: "List files in a directory on your virtual computer. Omit path for current directory.",
              inputSchema: z.object({ path: z.string().max(300).optional() }),
              execute: async ({ path }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await requirePermission(supabaseAdmin, userId, "computer:use");
                  const vmState = await ensureVM(supabaseAdmin, userId, sessionId);
                  return vmListFiles(vmState.fs, vmState.cwd, path);
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            vm_run_code: tool({
              description: "Execute JavaScript code in your virtual computer's sandbox. 5s timeout. Use console.log() for output.",
              inputSchema: z.object({ code: z.string().min(1).max(50_000) }),
              execute: async ({ code }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await requirePermission(supabaseAdmin, userId, "computer:use");
                  const result = await runJs(code);
                  await appendTimeline("⚙️", "vm run_code", {});
                  return result;
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            vm_browse: tool({
              description: "Visit a public URL in the virtual computer's isolated web app. Returns readable page content and saves the latest snapshot in /home/agent/Downloads/browser-last.md.",
              inputSchema: z.object({ url: z.string().url() }),
              execute: async ({ url }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await Promise.all([
                    requirePermission(supabaseAdmin, userId, "computer:use"),
                    requirePermission(supabaseAdmin, userId, "browser:use"),
                  ]);
                  const [vmState, page] = await Promise.all([
                    ensureVM(supabaseAdmin, userId, sessionId),
                    fetchUrl(url),
                  ]);
                  if (!page.ok) return { ok: false, status: page.status, error: `Page returned ${page.status}` };
                  const snapshot = [`# ${page.title || url}`, "", `Source: ${url}`, "", page.text ?? "", "", "## Links", ...page.links.slice(0, 30).map((link) => `- ${link}`)].join("\n");
                  await Promise.all([
                    vmWriteFile(supabaseAdmin, vmState.id, vmState.fs, "/home/agent/Downloads/browser-last.md", snapshot),
                    patchSession({ current_url: url, observation_summary: page.title || url, page_summary: page.text?.slice(0, 500) ?? null }),
                    appendTimeline("🌐", "vm browser: " + (page.title || url), { url, status: page.status }),
                  ]);
                  return { ok: true, url, status: page.status, title: page.title, text: page.text?.slice(0, 12000), links: page.links.slice(0, 30), savedTo: "/home/agent/Downloads/browser-last.md" };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),

            // --- Sub-Agents ---
            spawn_subagent: tool({
              description:
                "Spawn a specialized sub-agent with its own mini-computer (VM) and a restricted set of apps. " +
                "The sub-agent runs independently to completion and returns its result. " +
                "Available apps: terminal, editor, filesystem, code-runner, web-browser, ai-brain, researcher, writer, analyst.",
              inputSchema: z.object({
                name: z.string().min(1).max(80),
                goal: z.string().min(3).max(2000),
                apps: z.array(z.enum([
                  "terminal", "editor", "filesystem", "code-runner",
                  "web-browser", "ai-brain", "researcher", "writer", "analyst",
                ])).default(["terminal", "filesystem", "code-runner"]),
              }),
              execute: async ({ name, goal, apps }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  await requirePermission(supabaseAdmin, userId, "computer:use");
                  if (apps.includes("web-browser")) {
                    await requirePermission(supabaseAdmin, userId, "browser:use");
                  }
                  // Create the sub-agent's mini-VM
                  const subVM = await createVM(supabaseAdmin, userId, sessionId, name + " VM", apps);
                  // Create the sub-agent record
                  const { data: subAgent } = await supabaseAdmin
                    .from("sub_agents")
                    .insert({
                      parent_session_id: sessionId,
                      vm_id: subVM.id,
                      user_id: userId,
                      name,
                      goal,
                      status: "running",
                      allowed_apps: apps,
                      started_at: new Date().toISOString(),
                    })
                    .select("id")
                    .single();
                  if (!subAgent) return { ok: false, error: "Failed to create sub-agent" };

                  await appendTimeline("🤖", "Spawned: " + name, { goal: goal.slice(0, 120), apps });

                  // Build restricted toolset from apps
                  const allowedToolNames = getAppTools(apps);
                  const subTools = {} as Record<string, unknown>;

                  if (allowedToolNames.includes("vm_terminal")) {
                    subTools.vm_terminal = tool({
                      description: "Run a terminal command on your mini-computer.",
                      inputSchema: z.object({ command: z.string().min(1).max(2000) }),
                      execute: async ({ command }: { command: string }) => {
                        const current = await getVM(supabaseAdmin, subVM.id);
                        if (!current) return { ok: false, error: "Mini-computer not found" };
                        const { output } = await vmExecuteCommand(supabaseAdmin, subVM.id, current, command);
                        return { ok: true, output };
                      },
                    });
                  }
                  if (allowedToolNames.includes("vm_write_file") || allowedToolNames.includes("vm_read_file")) {
                    if (allowedToolNames.includes("vm_write_file")) {
                      subTools.vm_write_file = tool({
                        description: "Write a file to your mini-computer.",
                        inputSchema: z.object({ path: z.string().min(1).max(300), content: z.string().max(200_000) }),
                        execute: async ({ path, content }: { path: string; content: string }) => {
                          const { fs } = await vmWriteFile(supabaseAdmin, subVM.id, subVM.fs, path, content);
                          subVM.fs = fs;
                          return { ok: true, path, size: content.length };
                        },
                      });
                    }
                    if (allowedToolNames.includes("vm_read_file")) {
                      subTools.vm_read_file = tool({
                        description: "Read a file from your mini-computer.",
                        inputSchema: z.object({ path: z.string().min(1).max(300) }),
                        execute: async ({ path }: { path: string }) => vmReadFile(subVM.fs, path),
                      });
                    }
                  }
                  if (allowedToolNames.includes("vm_list_files")) {
                    subTools.vm_list_files = tool({
                      description: "List files in a directory on your mini-computer.",
                      inputSchema: z.object({ path: z.string().max(300).optional() }),
                      execute: async ({ path }: { path?: string }) => vmListFiles(subVM.fs, subVM.cwd, path),
                    });
                  }
                  if (allowedToolNames.includes("vm_run_code")) {
                    subTools.vm_run_code = tool({
                      description: "Execute JavaScript code in your mini-computer's sandbox.",
                      inputSchema: z.object({ code: z.string().min(1).max(50_000) }),
                      execute: async ({ code }: { code: string }) => runJs(code),
                    });
                  }
                  if (allowedToolNames.includes("vm_browse")) {
                    subTools.vm_browse = tool({
                      description: "Visit a public URL in the mini-computer browser and save a readable snapshot.",
                      inputSchema: z.object({ url: z.string().url() }),
                      execute: async ({ url }: { url: string }) => {
                        const [r, current] = await Promise.all([fetchUrl(url), getVM(supabaseAdmin, subVM.id)]);
                        if (!current) return { ok: false, error: "Mini-computer not found" };
                        const snapshot = [`# ${r.title || url}`, "", `Source: ${url}`, "", r.text ?? ""].join("\n");
                        const written = await vmWriteFile(supabaseAdmin, subVM.id, current.fs, "/home/agent/Downloads/browser-last.md", snapshot);
                        subVM.fs = written.fs;
                        return { ok: r.ok, status: r.status, title: r.title, text: r.text?.slice(0, 5000), links: r.links.slice(0, 20), savedTo: "/home/agent/Downloads/browser-last.md" };
                      },
                    });
                  }
                  if (allowedToolNames.includes("ask_ai")) {
                    subTools.ask_ai = tool({
                      description: "Ask another AI model a question.",
                      inputSchema: z.object({ prompt: z.string().min(1).max(4000) }),
                      execute: async ({ prompt }: { prompt: string }) => {
                        try {
                          const sub = await streamText({ model, prompt });
                          let text = "";
                          for await (const chunk of sub.textStream) text += chunk;
                          return { ok: true, text };
                        } catch { return { ok: false, error: "AI unavailable" }; }
                      },
                    });
                  }

                  // Run the sub-agent to completion
                  const subResult = await streamText({
                    model,
                    system: `You are ${name}, a specialized sub-agent of OpenAgent. Goal: ${goal}. You have a virtual computer with these apps: ${apps.join(", ")}. Complete your task efficiently using only the tools provided. Keep responses concise.`,
                    prompt: goal,
                    tools: subTools as any,
                    stopWhen: stepCountIs(50),
                    maxRetries: 2,
                    abortSignal: AbortSignal.timeout(120_000),
                  });
                  let text = "";
                  for await (const chunk of subResult.textStream) text += chunk;

                  // Save the result
                  await supabaseAdmin.from("sub_agents").update({
                    status: "completed",
                    result: { text: text.slice(0, 10000) } as never,
                    completed_at: new Date().toISOString(),
                    messages: [{ role: "user", content: goal }, { role: "assistant", content: text.slice(0, 10000) }] as never,
                  }).eq("id", subAgent.id);

                  await appendTimeline("✅", "Sub-agent done: " + name, { result: text.slice(0, 200) });
                  return { ok: true, subAgentId: subAgent.id, name, result: text };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            list_subagents: tool({
              description: "List all sub-agents for the current session and their status.",
              inputSchema: z.object({}),
              execute: async () => {
                try {
                  if (!userId || !sessionId) return { ok: true, subAgents: [] };
                  const { data } = await supabaseAdmin
                    .from("sub_agents")
                    .select("id, name, goal, status, allowed_apps, created_at")
                    .eq("parent_session_id", sessionId)
                    .order("created_at", { ascending: false });
                  return { ok: true, subAgents: data ?? [] };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
              },
            }),
            send_to_subagent: tool({
              description: "Send a follow-up instruction to an existing sub-agent. The sub-agent continues working with its existing VM and tools.",
              inputSchema: z.object({
                subAgentId: z.string().uuid(),
                message: z.string().min(1).max(4000),
              }),
              execute: async ({ subAgentId, message }) => {
                try {
                  if (!userId) return { ok: false, error: "Not authenticated." };
                  const { data: subAgent } = await supabaseAdmin
                    .from("sub_agents")
                    .select("id, name, goal, allowed_apps, vm_id, messages")
                    .eq("id", subAgentId)
                    .maybeSingle();
                  if (!subAgent) return { ok: false, error: "Sub-agent not found" };

                  // Update status
                  await supabaseAdmin.from("sub_agents").update({
                    status: "running",
                  }).eq("id", subAgentId);

                  const subResult = await streamText({
                    model,
                    system: `You are ${subAgent.name}, a specialized sub-agent of OpenAgent. Original goal: ${subAgent.goal}. The user is sending you a follow-up instruction. Respond and complete the task.`,
                    prompt: message,
                    stopWhen: stepCountIs(5),
                    maxRetries: 2,
                    abortSignal: AbortSignal.timeout(60_000),
                  });
                  let text = "";
                  for await (const chunk of subResult.textStream) text += chunk;

                  await supabaseAdmin.from("sub_agents").update({
                    status: "completed",
                    completed_at: new Date().toISOString(),
                  }).eq("id", subAgentId);

                  return { ok: true, subAgentId, name: subAgent.name, result: text };
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
              "Navigate a tab (default: active tab) to a URL and wait for load complete.",
              z.object({ url: z.string().url(), tabId: z.number().optional() }),
            ),
            companion_observe: companionTool(
              "observe",
              "PRIMARY perception tool. Returns a UNIFIED observation of the active tab: url, title, pageState (ready|loading|error|dialog-open), summary, headings, landmarks (nav/main/aside/…), forms with fields, tables, lists, dialogs, errors (aria-live/role=alert), loading indicators, images with alt text, paragraphs, and an interactive `elements[]` array with stable {ref, tag, role, label, type, disabled, href, x, y, w, h}. Prefer this over reading raw HTML. Use returned refs with companion_click/fill/select.",
              z.object({
                tabId: z.number().optional(),
                max: z.number().min(1).max(300).optional(),
                includeText: z.boolean().optional(),
              }),
            ),
            companion_click: companionTool(
              "click",
              "Click an element. Prefer `ref` from observe; falls back to `selector` or fuzzy `text`.",
              z.object({
                tabId: z.number().optional(),
                ref: z.string().optional(),
                selector: z.string().optional(),
                text: z.string().optional(),
              }),
            ),
            companion_fill: companionTool(
              "fill",
              "Fill an input/textarea. Prefer `ref` from observe. Set submit:true to press Enter after filling.",
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
              "Intelligent wait. mode: 'selector' | 'visible' | 'enabled' | 'text' | 'ready' | 'dialog' | 'dom-stable'. Provide selector/text as needed. Default timeout 8s.",
              z.object({
                tabId: z.number().optional(),
                mode: z.enum(["selector","visible","enabled","text","ready","dialog","dom-stable"]).optional(),
                selector: z.string().optional(),
                text: z.string().optional(),
                timeoutMs: z.number().optional(),
                quietMs: z.number().optional(),
              }),
            ),
            companion_screenshot: tool({
              description:
                "VISION FALLBACK. Capture a JPEG screenshot of the active tab and (optionally) analyze it with a multimodal model. Only call this when structured observation is insufficient — canvas/webgl/pdf viewer, image-only UIs, or when observe cannot describe what the user is asking about. Result stored in the session's screenshot history for replay.",
              inputSchema: z.object({
                tabId: z.number().optional(),
                reason: z.string().min(2).max(300),
                analyze: z.string().max(500).optional().describe(
                  "Optional question to ask a vision model about the screenshot. Leave empty to only capture."),
                quality: z.number().min(20).max(90).optional(),
              }),
              execute: async ({ tabId, reason, analyze, quality }) => {
                if (!userId) return { ok: false, error: "Not authenticated." };
                if (sessionId) {
                  const { data: s } = await supabaseAdmin
                    .from("agent_sessions").select("status").eq("id", sessionId).maybeSingle();
                  if (s?.status === "cancelled") return { ok: false, error: "Session cancelled." };
                  if (s?.status === "paused") return { ok: false, error: "Session paused." };
                }
                await appendTimeline("📷", "screenshot", { reason });
                const cap = await callCompanion(userId, "screenshot",
                  { tabId, quality: quality ?? 55 }, { timeoutMs: 20_000 });
                if (!cap.ok) {
                  await appendTimeline("⚠️", "screenshot failed", { error: cap.error });
                  return { ok: false, error: cap.error };
                }
                const r = cap.result as { dataUrl: string; url?: string; title?: string; tabId?: number };
                let visualSummary: string | undefined;
                if (analyze) {
                  try {
                    const visionModel = model;
                    const messages = [{
                      role: "user" as const,
                      content: [
                        { type: "text" as const, text: analyze },
                        { type: "image" as const, image: r.dataUrl },
                      ],
                    }];
                    const v = await streamText({ model: visionModel, messages });
                    visualSummary = "";
                    for await (const c of v.textStream) visualSummary += c;
                  } catch (e) {
                    visualSummary = `vision error: ${e instanceof Error ? e.message : String(e)}`;
                  }
                }
                await appendScreenshot({
                  step: sessionId ? undefined : null,
                  reason,
                  url: r.url,
                  title: r.title,
                  tabId: r.tabId,
                  // Do not persist full dataUrl in JSONB — keep session lean.
                  // Show a placeholder marker; UI reads visualSummary + metadata.
                  hasImage: true,
                  visualSummary,
                });
                return {
                  ok: true, tabId: r.tabId, url: r.url, title: r.title,
                  visualSummary, capturedAt: Date.now(),
                };
              },
            }),
            companion_release_tab: companionTool(
              "release_tab",
              "Signal the agent is done controlling a tab — removes the glowing overlay.",
              z.object({ tabId: z.number().optional() }),
            ),
          },
        });

       // new — single, correctly-closed version
return result.toUIMessageStreamResponse({
  originalMessages: body.messages as UIMessage[],
  onError: (error) => {
    // The retry wrapper nests the real failure in `.cause` — unwrap it.
    const inner = (error as { cause?: unknown }).cause ?? error;
    const details = inner as { responseBody?: unknown; data?: unknown; statusCode?: unknown };
    const rawBody = typeof details.responseBody === "string" ? details.responseBody : JSON.stringify(details.data ?? "");
    const raw = `${error instanceof Error ? error.message : String(error)} | cause: ${
      inner instanceof Error ? inner.message : String(inner)
    } | status: ${details.statusCode ?? "?"} | body: ${rawBody}`;
    console.error("[/api/chat] stream error:", raw, error);
    if (/no.*provider|no.*endpoint/i.test(raw)) {
      return "⚠️ No AI provider currently has capacity for the free model. Try again shortly, or add a Gemini/OpenRouter key with billing for reliability.";
    }
    if (/resource_exhausted|quota/i.test(raw)) {
      return "⚠️ Free-tier quota hit. Wait a minute and retry.";
    }
    if (/api key not valid|invalid_api_key|permission_denied|401|403/i.test(raw)) {
      return "⚠️ API key rejected. Check the provider key secret is set and current.";
    }
    if (/429|rate.?limit/i.test(raw)) {
      return "⚠️ Rate limited. Wait a moment and retry.";
    }
    if (/503|unavailable|overloaded/i.test(raw)) {
      return "⚠️ Provider temporarily overloaded. Retry in a moment.";
    }
    return `AI error: ${raw}`;
  },
});
        },
    },
  },
});
