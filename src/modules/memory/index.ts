/**
 * Memory module — Milestone 2 implementation. DB-backed.
 *
 * Stores saved workflows, preferences, frequent sites, notes, and facts the
 * agent should remember about the user. Conversations & messages have their
 * own tables and are surfaced via the chat module.
 */
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";

export type MemoryKind = "workflow" | "preference" | "site" | "note" | "fact";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  label: string;
  value: unknown;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  kind: string;
  label: string;
  value: unknown;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

function fromRow(r: Row): MemoryEntry {
  return {
    id: r.id,
    kind: r.kind as MemoryKind,
    label: r.label,
    value: r.value,
    pinned: r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface MemoryStore {
  save(kind: MemoryKind, label: string, value?: unknown): Promise<MemoryEntry>;
  list(kind?: MemoryKind, limit?: number): Promise<MemoryEntry[]>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  remove(id: string): Promise<void>;
  togglePin(id: string, pinned: boolean): Promise<MemoryEntry>;
}

export const memory: MemoryStore = {
  async save(kind, label, value = {}) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in");
    const { data, error } = await supabase
      .from("memories")
      .insert({ user_id: u.user.id, kind, label, value: value as never })
      .select("id, kind, label, value, pinned, created_at, updated_at")
      .single();
    if (error) throw error;
    void logActivity({ module: "memory", message: `Saved ${kind}: ${label}`, metadata: { id: data.id } });
    return fromRow(data as Row);
  },

  async list(kind, limit = 100) {
    let q = supabase
      .from("memories")
      .select("id, kind, label, value, pinned, created_at, updated_at")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => fromRow(r as Row));
  },

  async search(query, limit = 50) {
    const { data, error } = await supabase
      .from("memories")
      .select("id, kind, label, value, pinned, created_at, updated_at")
      .ilike("label", `%${query}%`)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => fromRow(r as Row));
  },

  async remove(id) {
    const { error } = await supabase.from("memories").delete().eq("id", id);
    if (error) throw error;
    void logActivity({ module: "memory", message: `Removed memory ${id}` });
  },

  async togglePin(id, pinned) {
    const { data, error } = await supabase
      .from("memories")
      .update({ pinned })
      .eq("id", id)
      .select("id, kind, label, value, pinned, created_at, updated_at")
      .single();
    if (error) throw error;
    return fromRow(data as Row);
  },
};
