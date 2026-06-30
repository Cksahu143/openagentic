/**
 * BYO AI providers — Milestone 5.
 *
 * Each user can store their own API keys (Anthropic, OpenRouter, OpenAI,
 * custom OpenAI-compatible endpoints). Keys live in `provider_keys` with RLS
 * scoped to `auth.uid()`, so no other user — even other authenticated users —
 * can read them. The Lovable AI Gateway remains the zero-config default.
 */
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";

export type ProviderName =
  | "lovable"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "custom";

export interface ProviderKey {
  id: string;
  provider: ProviderName;
  label: string | null;
  baseUrl: string | null;
  isDefault: boolean;
  maskedKey: string;
  createdAt: string;
}

function mask(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return "•".repeat(k.length);
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export const providers = {
  async list(): Promise<ProviderKey[]> {
    const { data, error } = await supabase
      .from("provider_keys")
      .select("id, provider, label, base_url, is_default, api_key, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      provider: r.provider as ProviderName,
      label: r.label,
      baseUrl: r.base_url,
      isDefault: r.is_default,
      maskedKey: mask(r.api_key),
      createdAt: r.created_at,
    }));
  },

  async add(input: {
    provider: ProviderName;
    apiKey: string;
    label?: string;
    baseUrl?: string;
    isDefault?: boolean;
  }): Promise<void> {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in");
    const { error } = await supabase.from("provider_keys").insert({
      user_id: u.user.id,
      provider: input.provider,
      api_key: input.apiKey,
      label: input.label ?? null,
      base_url: input.baseUrl ?? null,
      is_default: input.isDefault ?? false,
    });
    if (error) throw error;
    void logActivity({
      module: "providers",
      message: "Provider key added",
      metadata: { provider: input.provider },
    });
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("provider_keys").delete().eq("id", id);
    if (error) throw error;
    void logActivity({ module: "providers", message: "Provider key removed" });
  },
};
