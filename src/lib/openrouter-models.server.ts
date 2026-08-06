/**
 * OpenRouter free-model rotation (server-only).
 *
 * Discovers every free model on OpenRouter (`:free`, zero prompt+completion
 * pricing) that advertises tool calling, filters out models that are known
 * NOT to emit real tool calls, orders them by measured reliability, and
 * rotates through them with cooldowns.
 *
 * IMPORTANT — quota model: OpenRouter's free tier is limited by REQUEST
 * COUNT per day (50/day without purchased credits), not by tokens. Every
 * model attempt — including a fallback attempt after another model failed —
 * burns one request. So the rotation must be *frugal*: try a small number of
 * models per call, never sweep the whole catalog, and never re-sweep it in
 * multiple "cycles".
 *
 * Do not import this file from client code.
 */

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: Record<string, string>;
  supported_parameters?: string[];
}

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Models that advertise `tools` but, in live testing, answer in prose
 * instead of emitting tool calls. An agent loop on these models burns the
 * daily request budget without ever acting, so they are excluded.
 */
const NO_REAL_TOOL_CALLS = [
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
];

/**
 * Preference order, verified by live tool-calling probes. Anything not
 * listed still gets used, just after these.
 */
const PREFERRED = [
  "openai/gpt-oss-20b:free",
  "inclusionai/ling-3.0-flash:free",
  "poolside/laguna-s-2.1:free",
  "cohere/north-mini-code:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-xs-2.1:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
];

/** Used only when the catalog fetch itself fails. */
const STATIC_FALLBACK = PREFERRED.slice(0, 4);

let catalogCache: { at: number; ids: string[] } | null = null;
const cooldowns = new Map<string, number>();

function isFree(m: OpenRouterModel): boolean {
  const p = m.pricing ?? {};
  const zero = (v?: string) => v === undefined || Number(v) === 0;
  // Any zero-priced model counts — not only the ones whose id ends in
  // ":free". OpenRouter also lists permanently free variants without the
  // suffix, and excluding them shrank the rotation for no reason.
  return zero(p.prompt) && zero(p.completion);
}

function supportsTools(m: OpenRouterModel): boolean {
  return Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools");
}

function rankOf(id: string): number {
  const i = PREFERRED.indexOf(id);
  return i === -1 ? PREFERRED.length : i;
}

/** All free, tool-capable, non-blocklisted model ids, best-first. */
export async function listFreeModels(apiKey: string): Promise<string[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CACHE_TTL_MS) return catalogCache.ids;

  try {
    const res = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const json = (await res.json()) as { data?: OpenRouterModel[] };
    const ids = (json.data ?? [])
      .filter((m) => isFree(m) && supportsTools(m) && !NO_REAL_TOOL_CALLS.includes(m.id))
      .sort((a, b) => {
        const r = rankOf(a.id) - rankOf(b.id);
        if (r !== 0) return r;
        return (b.context_length ?? 0) - (a.context_length ?? 0);
      })
      .map((m) => m.id);
    if (ids.length === 0) throw new Error("no free tool-capable models in catalog");
    catalogCache = { at: now, ids };
    return ids;
  } catch (e) {
    console.warn("[openrouter] model catalog fetch failed, using static list:", e);
    catalogCache = { at: now, ids: STATIC_FALLBACK };
    return STATIC_FALLBACK;
  }
}

/** Free models that are not currently cooling down, best-first. */
export async function availableFreeModels(apiKey: string): Promise<string[]> {
  const all = await listFreeModels(apiKey);
  const now = Date.now();
  const up = all.filter((id) => (cooldowns.get(id) ?? 0) <= now);
  return up.length > 0 ? up : all;
}

/** Mark a model unusable for a while. Longer for quota/credit exhaustion. */
export function markModelDown(id: string, reason?: unknown): void {
  const msg = (reason instanceof Error ? reason.message : String(reason ?? "")).toLowerCase();
  const quota =
    msg.includes("402") ||
    msg.includes("credit") ||
    msg.includes("quota") ||
    msg.includes("insufficient") ||
    msg.includes("daily limit");
  cooldowns.set(id, Date.now() + (quota ? QUOTA_COOLDOWN_MS : DEFAULT_COOLDOWN_MS));
  console.warn(`[openrouter] ${id} on cooldown (${quota ? "quota" : "error"}): ${msg.slice(0, 200)}`);
}

/** Forget every cooldown so the rotation wraps back to the first model. */
export function clearModelCooldowns(): void {
  if (cooldowns.size > 0) {
    console.warn(`[openrouter] clearing ${cooldowns.size} cooldown(s)`);
    cooldowns.clear();
  }
}

export function cooldownSnapshot(): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [id, until] of cooldowns) if (until > now) out[id] = Math.round((until - now) / 1000);
  return out;
}

/**
 * True when the whole OpenRouter key has hit its daily free-request cap.
 * OpenRouter reports this as a 429 mentioning "free-models-per-day".
 */
export function isDailyFreeCapError(reason: unknown): boolean {
  const msg = (reason instanceof Error ? reason.message : String(reason ?? "")).toLowerCase();
  return (
    msg.includes("free-models-per-day") ||
    msg.includes("daily limit") ||
    (msg.includes("429") && msg.includes("add 10 credits"))
  );
}
