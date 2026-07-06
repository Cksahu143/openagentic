/**
 * Lovable AI Gateway provider helper (server-only).
 * Do not import this file from client code.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

export function createGoogleProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey });
}

/**
 * OpenRouter — OpenAI-compatible. Free tier available with `:free` suffixed
 * models. See https://openrouter.ai/models?q=free
 */
export function createOpenRouterProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://openagentic.lovable.app",
      "X-Title": "OpenAgent",
    },
  });
}
