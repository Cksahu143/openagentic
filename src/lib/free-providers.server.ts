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

/**
 * QUOTA BUDGET — OpenRouter's free tier is capped by REQUEST COUNT per day
 * (50/day without purchased credits). Every fallback attempt is a request,
 * so sweeping a 13-model catalog on each failure burned an entire day's
 * budget in one agent turn. The rotation is therefore strictly bounded:
 * at most a handful of models per generation, one pass, no re-sweeps.
 */
const MAX_ATTEMPTS_PER_CALL = 3;
/** Small pause between attempts so a rate-limited provider can recover. */
const ATTEMPT_PAUSE_MS = 350;

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
 * Errors that will fail identically on every model — bad request bodies,
 * unsupported tool schemas, auth problems. Rotating on these wastes the
 * daily request budget without any chance of succeeding, so we stop at once.
 */
function isFatalForAllModels(error: unknown): boolean {
  const msg = errorText(error);
  if (isTransient(error)) return false;
  return (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("invalid api key") ||
    msg.includes("400") ||
    msg.includes("invalid_request") ||
    msg.includes("schema") ||
    msg.includes("context length") ||
    msg.includes("too many tokens")
  );
}

/**
 * Wraps the candidate list into one model that walks a BOUNDED rotation:
 * at most `MAX_ATTEMPTS_PER_CALL` models per generation, single pass,
 * aborting immediately on errors that every model would reject.
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
    let tried = 0;
    for (const { candidate, model } of models) {
      if (tried >= MAX_ATTEMPTS_PER_CALL) break;
      tried++;
      try {
        return await run(model);
      } catch (error) {
        lastError = error;
        if (isFatalForAllModels(error)) {
          console.error(
            `[providers] fatal request error on ${candidate.label} — not rotating:`,
            errorText(error).slice(0, 300),
          );
          throw error;
        }
        candidate.markDown(error);
        // A key-wide daily cap means every OpenRouter model is unusable —
        // skip straight past them instead of spending more requests.
        const { isDailyFreeCapError } = await import("./openrouter-models.server");
        if (candidate.provider === "openrouter" && isDailyFreeCapError(error)) {
          console.warn("[providers] OpenRouter daily free-request cap reached — skipping to other providers");
          for (const other of models) {
            if (other.candidate.provider === "openrouter") other.candidate.markDown(error);
          }
          const next = models.find((m) => m.candidate.provider !== "openrouter");
          if (!next) throw error;
          try {
            return await run(next.model);
          } catch (e) {
            next.candidate.markDown(e);
            throw e;
          }
        }
        if (tried < MAX_ATTEMPTS_PER_CALL) {
          await new Promise((r) => setTimeout(r, ATTEMPT_PAUSE_MS));
        }
      }
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
async function buildCandidates(
  keys: ResolvedKeys,
  ignoreCooldowns: boolean,
): Promise<ProviderResult[]> {
  const candidates: ProviderResult[] = [];
  const down = (key: string) => !ignoreCooldowns && isCoolingDown(key);

  // 1. OpenRouter: include the complete live catalog, not an arbitrary slice.
  if (keys.openrouterKey) {
    const provider = createOpenRouterProvider(keys.openrouterKey);
    const { availableFreeModels, listFreeModels, markModelDown } = await import(
      "./openrouter-models.server"
    );
    const ids = ignoreCooldowns
      ? await listFreeModels(keys.openrouterKey)
      : await availableFreeModels(keys.openrouterKey);
    for (const modelId of ids) {
      if (down(`openrouter:${modelId}`)) continue;
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
      if (down(`groq:${modelId}`)) continue;
      candidates.push({ model: provider(modelId), label: `groq:${modelId}`, provider: "groq", modelId, markDown: (e) => markProviderDown("groq", modelId, e) });
    }
  }

  // 3. Gemini
  if (keys.geminiKey) {
    const provider = createGoogleGenerativeAI({ apiKey: keys.geminiKey });
    for (const modelId of GEMINI_MODELS) {
      if (down(`gemini:${modelId}`)) continue;
      candidates.push({ model: provider(modelId), label: `gemini:${modelId}`, provider: "gemini", modelId, markDown: (e) => markProviderDown("gemini", modelId, e) });
    }
  }

  // 4. Cerebras
  if (keys.cerebrasKey) {
    const provider = createCerebrasProvider(keys.cerebrasKey);
    for (const modelId of CEREBRAS_MODELS) {
      if (down(`cerebras:${modelId}`)) continue;
      candidates.push({ model: provider(modelId), label: `cerebras:${modelId}`, provider: "cerebras", modelId, markDown: (e) => markProviderDown("cerebras", modelId, e) });
    }
  }

  return candidates;
}

/**
 * Resolve the best available free model. Returns a single model that walks
 * the whole rotation and wraps back to the first model after the last one
 * runs out of credits or gets rate limited.
 */
export async function resolveFreeModel(
  keys: ResolvedKeys,
): Promise<ProviderResult | null> {
  let candidates = await buildCandidates(keys, false);
  if (candidates.length === 0) {
    // Everything is cooling down — wrap around and start from the top again.
    clearCooldowns();
    candidates = await buildCandidates(keys, true);
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
