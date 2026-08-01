/**
 * Unified free-tier AI provider chain (server-only).
 *
 * Tries providers in order of preference:
 *   1. Groq — fast, generous free tier (30 RPM, 1,000 req/day)
 *   2. Google Gemini — most generous free tier (1,500 req/day)
 *   3. OpenRouter free models — auto-rotating 13+ free models
 *   4. Cerebras — very fast, large context (if key available)
 *
 * Each provider has per-model cooldowns so a failing model is
 * skipped on the next request. The chain falls through cleanly.
 *
 * Do not import this file from client code.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGoogleProvider, createOpenRouterProvider } from "./ai-gateway.server";
import { generateText as aiGenerateText, type LanguageModel } from "ai";

// ── Provider factories ──────────────────────────────────────

export function createGroqProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export function createCerebrasProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export { createGoogleProvider, createOpenRouterProvider };

// ── Model catalogs ───────────────────────────────────────────

/** Groq free-tier models with tool support, ranked by capability. */
export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
  "deepseek-r1-distill-llama-70b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];

/** Cerebras free-tier models with tool support. */
export const CEREBRAS_MODELS = [
  "llama-3.3-70b",
  "qwen-2.5-coder-32b",
  "llama3.1-8b",
];

/** Google Gemini free-tier models. */
export const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
];

// ── Cooldown tracking ────────────────────────────────────────

const cooldowns = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 30 * 60 * 1000;

function isCoolingDown(key: string): boolean {
  return (cooldowns.get(key) ?? 0) > Date.now();
}

export function markProviderDown(
  provider: string,
  model: string,
  reason?: unknown,
): void {
  const msg = (
    reason instanceof Error ? reason.message : String(reason ?? "")
  ).toLowerCase();
  const quota = msg.includes("402") || msg.includes("credit") || msg.includes("quota") || msg.includes("resource_exhausted");
  const ms = quota ? QUOTA_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;
  cooldowns.set(`${provider}:${model}`, Date.now() + ms);
  console.warn(
    `[providers] ${provider}:${model} cooldown ${quota ? "(quota)" : "(error)"}: ${msg.slice(0, 200)}`,
  );
}

export function cooldownStatus(): Record<string, number> {
  const out: Record<string, number> = {};
  const now = Date.now();
  for (const [key, until] of cooldowns)
    if (until > now) out[key] = Math.round((until - now) / 1000);
  return out;
}

// ── Key resolution ───────────────────────────────────────────

export interface ResolvedKeys {
  groqKey: string | null;
  geminiKey: string | null;
  openrouterKey: string | null;
  cerebrasKey: string | null;
}

export async function resolveKeys(
  userId: string | null,
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
): Promise<ResolvedKeys> {
  let groqKey: string | null = null;
  let openrouterKey: string | null = null;
  let cerebrasKey: string | null = null;

  if (userId) {
    const { data: keys } = await supabaseAdmin
      .from("provider_keys")
      .select("provider, api_key")
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    for (const k of keys ?? []) {
      if (k.provider === "groq" && !groqKey) groqKey = k.api_key;
      if (k.provider === "openrouter" && !openrouterKey) openrouterKey = k.api_key;
      if (k.provider === "cerebras" && !cerebrasKey) cerebrasKey = k.api_key;
    }
  }

  if (!groqKey && process.env.GROQ_API_KEY) groqKey = process.env.GROQ_API_KEY;
  if (!openrouterKey && process.env.OPENROUTER_API_KEY)
    openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!cerebrasKey && process.env.CEREBRAS_API_KEY)
    cerebrasKey = process.env.CEREBRAS_API_KEY;

  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null;

  return { groqKey, geminiKey, openrouterKey, cerebrasKey };
}

// ── Unified resolver ─────────────────────────────────────────

export interface ProviderResult {
  model: LanguageModel;
  label: string;
  provider: string;
  modelId: string;
  markDown: (error: unknown) => void;
}

/**
 * Resolve the best available free model. Tries each provider/model in
 * order, skipping cooled-down ones, until a probe succeeds. Returns the
 * first working model or null if everything is unavailable.
 */
export async function resolveFreeModel(
  keys: ResolvedKeys,
): Promise<ProviderResult | null> {
  // 1. Groq
  if (keys.groqKey) {
    const provider = createGroqProvider(keys.groqKey);
    for (const modelId of GROQ_MODELS) {
      const key = `groq:${modelId}`;
      if (isCoolingDown(key)) continue;
      try {
        await aiGenerateText({
          model: provider(modelId),
          prompt: "ping",
          maxOutputTokens: 4,
          abortSignal: AbortSignal.timeout(6_000),
        });
        return {
          model: provider(modelId),
          label: `groq:${modelId}`,
          provider: "groq",
          modelId,
          markDown: (e) => markProviderDown("groq", modelId, e),
        };
      } catch (e) {
        markProviderDown("groq", modelId, e);
      }
    }
  }

  // 2. Gemini
  if (keys.geminiKey) {
    const provider = createGoogleGenerativeAI({ apiKey: keys.geminiKey });
    for (const modelId of GEMINI_MODELS) {
      const key = `gemini:${modelId}`;
      if (isCoolingDown(key)) continue;
      try {
        await aiGenerateText({
          model: provider(modelId),
          prompt: "ping",
          maxOutputTokens: 4,
          abortSignal: AbortSignal.timeout(8_000),
        });
        return {
          model: provider(modelId),
          label: `gemini:${modelId}`,
          provider: "gemini",
          modelId,
          markDown: (e) => markProviderDown("gemini", modelId, e),
        };
      } catch (e) {
        markProviderDown("gemini", modelId, e);
      }
    }
  }

  // 3. OpenRouter free models
  if (keys.openrouterKey) {
    const provider = createOpenRouterProvider(keys.openrouterKey);
    const { availableFreeModels, markModelDown } = await import(
      "./openrouter-models.server"
    );
    const candidates = await availableFreeModels(keys.openrouterKey);
    for (const modelId of candidates.slice(0, 8)) {
      const key = `openrouter:${modelId}`;
      if (isCoolingDown(key)) continue;
      try {
        await aiGenerateText({
          model: provider(modelId),
          prompt: "ping",
          maxOutputTokens: 4,
          abortSignal: AbortSignal.timeout(8_000),
        });
        return {
          model: provider(modelId),
          label: `openrouter:${modelId}`,
          provider: "openrouter",
          modelId,
          markDown: (e) => {
            markProviderDown("openrouter", modelId, e);
            markModelDown(modelId, e);
          },
        };
      } catch (e) {
        markProviderDown("openrouter", modelId, e);
        markModelDown(modelId, e);
      }
    }
  }

  // 4. Cerebras
  if (keys.cerebrasKey) {
    const provider = createCerebrasProvider(keys.cerebrasKey);
    for (const modelId of CEREBRAS_MODELS) {
      const key = `cerebras:${modelId}`;
      if (isCoolingDown(key)) continue;
      try {
        await aiGenerateText({
          model: provider(modelId),
          prompt: "ping",
          maxOutputTokens: 4,
          abortSignal: AbortSignal.timeout(6_000),
        });
        return {
          model: provider(modelId),
          label: `cerebras:${modelId}`,
          provider: "cerebras",
          modelId,
          markDown: (e) => markProviderDown("cerebras", modelId, e),
        };
      } catch (e) {
        markProviderDown("cerebras", modelId, e);
      }
    }
  }

  return null;
}

export function noProviderError(): string {
  return "No free AI provider is currently available. All providers are rate-limited or cooling down. Try again in a few minutes, or add your own free Groq key (console.groq.com → API Keys) on the Providers page.";
}
