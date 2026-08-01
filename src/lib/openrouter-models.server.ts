/**
 * OpenRouter free-model rotation (server-only).
 *
 * Discovers EVERY free model on OpenRouter (pricing prompt+completion == 0)
 * that supports tool calling, orders them by capability, and rotates through
 * them: any model that errors / rate-limits / runs out of free quota is put
 * on a cooldown so subsequent requests skip straight to the next one.
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
const CACHE_TTL_MS = 30 * 60 * 1000; // model catalog changes rarely
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000; // model failed → skip for 10 min
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000; // out of free credits → skip 1 hour

/** Fallback list used only when the catalog fetch itself fails. */
const STATIC_FALLBACK = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen3-coder:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "mistralai/mistral-small-3.2-24b-instruct:free",
  "google/gemma-3-27b-it:free",
];

/**
 * Vendors that historically produce clean tool-calling output on the free
 * tier get sorted first; everything else follows by context length.
 */
const VENDOR_RANK = ["meta-llama/", "qwen/", "mistralai/", "deepseek/", "nvidia/", "google/"];

let catalogCache: { at: number; ids: string[] } | null = null;
const cooldowns = new Map<string, number>();

function isFree(m: OpenRouterModel): boolean {
  const p = m.pricing ?? {};
  const zero = (v?: string) => v === undefined || Number(v) === 0;
  return zero(p.prompt) && zero(p.completion) && m.id.endsWith(":free");
}

function supportsTools(m: OpenRouterModel): boolean {
  return Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools");
}

function rankOf(id: string): number {
  const i = VENDOR_RANK.findIndex((v) => id.startsWith(v));
  return i === -1 ? VENDOR_RANK.length : i;
}

/** All free tool-capable model ids, best-first. Cached in-process. */
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
    const models = (json.data ?? []).filter((m) => isFree(m) && supportsTools(m));
    const ids = models
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
  // If literally everything is cooling down, clear the map and retry them all
  // rather than hard-failing the request.
  if (up.length === 0) {
    cooldowns.clear();
    return all;
  }
  return up;
}

/** Mark a model unusable for a while. Longer for quota/credit exhaustion. */
export function markModelDown(id: string, reason?: unknown): void {
  const msg = (reason instanceof Error ? reason.message : String(reason ?? "")).toLowerCase();
  const quota =
    msg.includes("402") ||
    msg.includes("credit") ||
    msg.includes("quota") ||
    msg.includes("insufficient");
  cooldowns.set(id, Date.now() + (quota ? QUOTA_COOLDOWN_MS : DEFAULT_COOLDOWN_MS));
  console.warn(`[openrouter] ${id} on cooldown (${quota ? "quota" : "error"}): ${msg.slice(0, 200)}`);
}

export function cooldownSnapshot(): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [id, until] of cooldowns) if (until > now) out[id] = Math.round((until - now) / 1000);
  return out;
}
