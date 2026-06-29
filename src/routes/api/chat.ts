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

const SYSTEM_PROMPT = `You are OpenAgent, a free, modular AI computer assistant.

You help users complete tasks. Today you can:
- Reason about the user's goal and explain a plan.
- Save things the user wants you to remember using the save_memory tool (workflows, preferences, frequent sites, notes, facts).
- Create persistent task records using the create_task tool when the user asks you to do something multi-step.

You CANNOT yet drive a browser, read files, or control a desktop — those modules ship in later milestones. If a task needs one of those, explain that clearly and offer to save a workflow for later.

Be concise. Use markdown. When you propose a plan, use numbered steps.`;

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
            save_memory: tool({
              description:
                "Save something the user explicitly asked the agent to remember (a preference, workflow, frequent site, note, or fact). The frontend persists the entry to the user's memory store.",
              inputSchema: z.object({
                kind: z.enum(["workflow", "preference", "site", "note", "fact"]),
                label: z.string().min(1).max(120),
                value: z
                  .string()
                  .max(2000)
                  .describe("Free-form details for the memory."),
              }),
            }),
            create_task: tool({
              description:
                "Create a persistent task record for a multi-step user goal. Use only when the user clearly wants the agent to track a task across the session.",
              inputSchema: z.object({
                goal: z.string().min(3).max(280),
              }),
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
