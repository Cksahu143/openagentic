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

- save_memory: remember a workflow, preference, frequent site, note or fact.
- create_task: track a multi-step goal for the user.
- fetch_url: fetch any public http(s) URL and return its title, readable text, status and outgoing links. Use this for research, link/health checks, reading docs, scraping a public page, calling JSON APIs.
- run_code: run a small JavaScript snippet on the server (5s timeout, captured console). Use for quick math, parsing, transformations. Top-level await is allowed. Return the value as the last expression.
- ask_ai: send a sub-prompt to another model on YOUR Lovable AI account (the user does not need their own API key). Use to delegate a sub-task to a cheaper / faster model, or to get a second opinion.
- write_file: write a document (markdown, code, json, txt) to the user's private file storage. Use when the user asks you to produce a doc, report, summary, snippet, dataset.
- read_file / list_files: read files the user previously wrote or uploaded.

Rules:
1. Pick tools deliberately — call fetch_url when you need fresh info, run_code when computing, write_file when the user asks for a deliverable.
2. After tool calls, summarise the result in plain language.
3. Never invent URLs, file contents, or run_code output — call the tool.
4. When asked to test a website, fetch_url it and report status, title, broken links if any, headings.
5. Use markdown. Be concise but show your work.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(body.messages)) {
          return new Response("messages required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(body.messages as UIMessage[]),
          stopWhen: stepCountIs(50),
          tools: {
            // --- client-applied tools (planner loop persists them) ---
            save_memory: tool({
              description:
                "Save something the user wants the agent to remember (workflow, preference, site, note, fact). Persisted to the user's memory store.",
              inputSchema: z.object({
                kind: z.enum(["workflow", "preference", "site", "note", "fact"]),
                label: z.string().min(1).max(120),
                value: z.string().max(2000),
              }),
            }),
            create_task: tool({
              description:
                "Create a persistent task record for a multi-step user goal.",
              inputSchema: z.object({
                goal: z.string().min(3).max(280),
              }),
            }),
            write_file: tool({
              description:
                "Write a document/file to the user's private storage (markdown, txt, json, code). Path is relative to the user's folder, e.g. 'reports/research.md'. Overwrites if it exists.",
              inputSchema: z.object({
                path: z.string().min(1).max(200),
                content: z.string().max(200_000),
                contentType: z.string().optional(),
              }),
            }),

            // --- server-executed tools ---
            fetch_url: tool({
              description:
                "Fetch a public http(s) URL. Returns status, final URL after redirects, title, readable text, content-type and up to 40 outgoing links. Use for research, link/health checks, scraping public pages, reading APIs. 15s timeout, 1.5MB cap.",
              inputSchema: z.object({
                url: z.string().url(),
              }),
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
                  return {
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                  };
                }
              },
            }),
            run_code: tool({
              description:
                "Run a short JavaScript snippet on the server. 5 second timeout. Top-level await allowed. Use 'return <value>' to return; console.log is captured.",
              inputSchema: z.object({
                code: z.string().min(1).max(20_000),
              }),
              execute: async ({ code }) => {
                const r = await runJs(code);
                return r;
              },
            }),
            ask_ai: tool({
              description:
                "Delegate a sub-prompt to another model on the agent's Lovable AI account (the user doesn't need their own API key). Returns the model's text. Use for cheap one-shot questions, second opinions, or specialised models.",
              inputSchema: z.object({
                prompt: z.string().min(1).max(8000),
                system: z.string().max(2000).optional(),
                model: z
                  .string()
                  .max(120)
                  .optional()
                  .describe(
                    "Optional model id. Defaults to google/gemini-3-flash-preview. Use google/gemini-3-pro-preview for harder tasks.",
                  ),
              }),
              execute: async ({ prompt, system, model: modelId }) => {
                try {
                  const subModel = gateway(modelId || "google/gemini-3-flash-preview");
                  const sub = await streamText({
                    model: subModel,
                    system,
                    prompt,
                  });
                  let text = "";
                  for await (const chunk of sub.textStream) text += chunk;
                  return { ok: true, text };
                } catch (e) {
                  return {
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                  };
                }
              },
            }),
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages as UIMessage[],
        });
      },
    },
  },
});
