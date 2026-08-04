/**
 * Unified free-tier AI provider chain (server-only).
 *
 * Tries providers in order of preference:
 *   1. Every available OpenRouter tool-capable free model
 *   2. User-configured Groq models (only when a key exists)
 *   3. Google Gemini free-tier models (only when a key exists)
 *   4. User-configured Cerebras models (only when a key exists)
 *
 * Each provider has per-model cooldowns so a failing model is
 * skipped on the next request. The chain falls through cleanly.
 *
 * Do not import this file from client code.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGoogleProvider, createOpenRouterProvider } from "./ai-gateway.server";
import type { LanguageModel } from "ai";

type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: "v3" }>;

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

function errorText(reason: unknown): string {
  if (reason instanceof Error) {
    const extra = reason as Error & { responseBody?: unknown; data?: unknown; cause?: unknown };
    return [reason.message, extra.responseBody, extra.data, extra.cause]
      .filter(Boolean)
      .map(String)
      .join(" ")
      .toLowerCase();
  }
  return String(reason ?? "").toLowerCase();
}

export function markProviderDown(
  provider: string,
  model: string,
  reason?: unknown,
): void {
  const msg = errorText(reason);
  const quota = msg.includes("402") || msg.includes("credit") || msg.includes("quota") || msg.includes("resource_exhausted");
  const ms = quota ? QUOTA_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;
  cooldowns.set(`${provider}:${model}`, Date.now() + ms);
  console.warn(
    `[providers] ${provider}:${model} cooldown ${quota ? "(quota)" : "(error)"}: ${msg.slice(0, 200)}`,
  );
}

/** Forget every cooldown so rotation wraps back around to the first model. */
export function clearCooldowns(): void {
  if (cooldowns.size > 0) {
    console.warn(`[providers] cycling rotation — clearing ${cooldowns.size} cooldown(s)`);
    cooldowns.clear();
  }
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

/** How many times the rotation wraps back to the first model before giving up. */
const ROTATION_CYCLES = 3;
/** Pause before starting another cycle so rate-limited models can recover. */
const CYCLE_PAUSE_MS = 1500;

function isTransient(error: unknown): boolean {
  const msg = errorText(error);
  return (
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("timeout") ||
    msg.includes("overload") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("temporar")
  );
}

/**
 * Wraps the whole candidate list into one model that walks the rotation.
 * When the LAST model fails (credits gone or rate limited) it wraps around
 * to the FIRST model again — cooldowns are cleared between cycles so the
 * rotation is a true loop rather than a one-shot pass.
 */
function fallbackLanguageModel(candidates: ProviderResult[]): LanguageModel {
  const models = candidates.map((candidate) => ({
    candidate,
    model: candidate.model as LanguageModelV3,
  }));
  const primary = models[0]?.model;
  if (!primary) throw new Error("No language models available");

  async function attempt<T>(run: (model: LanguageModelV3) => PromiseLike<T>): Promise<T> {
    let lastError: unknown;
    for (let cycle = 0; cycle < ROTATION_CYCLES; cycle++) {
      if (cycle > 0) {
        // Full loop completed — wrap around to the first model again.
        clearCooldowns();
        const { clearModelCooldowns } = await import("./openrouter-models.server");
        clearModelCooldowns();
        await new Promise((r) => setTimeout(r, CYCLE_PAUSE_MS * cycle));
        console.warn(`[providers] rotation cycle ${cycle + 1}/${ROTATION_CYCLES} — restarting at the first free model`);
      }
      for (const { candidate, model } of models) {
        try {
          return await run(model);
        } catch (error) {
          candidate.markDown(error);
          lastError = error;
        }
      }
      // Only keep cycling while failures look recoverable.
      if (!isTransient(lastError) && cycle >= 1) break;
    }
    throw lastError ?? new Error("Every free model failed");
  }

  return {
    specificationVersion: "v3",
    provider: "openagent-free-fallback",
    modelId: candidates.map((item) => item.label).join(" -> "),
    supportedUrls: primary.supportedUrls,
    doGenerate: (options) => attempt((model) => model.doGenerate(options)),
    doStream: (options) => attempt((model) => model.doStream(options)),
  } satisfies LanguageModelV3;
}

/**
 * Resolve the best available free model. Tries each provider/model in
 * order, skipping cooled-down ones, until a probe succeeds. Returns the
 * first working model or null if everything is unavailable.
 */
export async function resolveFreeModel(
  keys: ResolvedKeys,
): Promise<ProviderResult | null> {
  const candidates: ProviderResult[] = [];

  // 1. OpenRouter: include the complete live catalog, not an arbitrary slice.
  if (keys.openrouterKey) {
    const provider = createOpenRouterProvider(keys.openrouterKey);
    const { availableFreeModels, markModelDown } = await import(
      "./openrouter-models.server"
    );
    for (const modelId of await availableFreeModels(keys.openrouterKey)) {
      if (isCoolingDown(`openrouter:${modelId}`)) continue;
      candidates.push({
        model: provider(modelId),
        label: `openrouter:${modelId}`,
        provider: "openrouter",
        modelId,
        markDown: (error) => {
          markProviderDown("openrouter", modelId, error);
          markModelDown(modelId, error);
        },
      });
    }
  }

  // 2. Groq — never attempted without a configured key.
  if (keys.groqKey) {
    const provider = createGroqProvider(keys.groqKey);
    for (const modelId of GROQ_MODELS) {
      if (isCoolingDown(`groq:${modelId}`)) continue;
      candidates.push({ model: provider(modelId), label: `groq:${modelId}`, provider: "groq", modelId, markDown: (e) => markProviderDown("groq", modelId, e) });
    }
  }

  // 3. Gemini
  if (keys.geminiKey) {
    const provider = createGoogleGenerativeAI({ apiKey: keys.geminiKey });
    for (const modelId of GEMINI_MODELS) {
      if (isCoolingDown(`gemini:${modelId}`)) continue;
      candidates.push({ model: provider(modelId), label: `gemini:${modelId}`, provider: "gemini", modelId, markDown: (e) => markProviderDown("gemini", modelId, e) });
    }
  }

  // 4. Cerebras
  if (keys.cerebrasKey) {
    const provider = createCerebrasProvider(keys.cerebrasKey);
    for (const modelId of CEREBRAS_MODELS) {
      if (isCoolingDown(`cerebras:${modelId}`)) continue;
      candidates.push({ model: provider(modelId), label: `cerebras:${modelId}`, provider: "cerebras", modelId, markDown: (e) => markProviderDown("cerebras", modelId, e) });
    }
  }

  const first = candidates[0];
  if (!first) return null;
  return {
    ...first,
    model: fallbackLanguageModel(candidates),
    label: `${first.label} (+${candidates.length - 1} fallbacks)`,
  };
}

export function noProviderError(): string {
  return "No free AI model is currently available. Add an OpenRouter key on Providers, or wait for cooled-down free models to recover.";
}
