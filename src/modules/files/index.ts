/**
 * Files module — Milestone 5. Backed by the private Supabase Storage bucket
 * `user-files`; RLS restricts each user to objects under their own user-id
 * folder.
 */
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  updatedAt: string | null;
}

const BUCKET = "user-files";

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

function joinPath(userId: string, p: string): string {
  const clean = p.replace(/^\/+/, "").replace(/\.\.+/g, "");
  return `${userId}/${clean}`;
}

export const files = {
  async list(prefix = ""): Promise<FileEntry[]> {
    const userId = await uid();
    const full = joinPath(userId, prefix).replace(/\/$/, "");
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(full, { limit: 200, sortBy: { column: "updated_at", order: "desc" } });
    if (error) throw error;
    return (data ?? [])
      .filter((d) => d.name && !d.name.startsWith("."))
      .map((d) => ({
        name: d.name,
        path: `${prefix.replace(/^\/+|\/+$/g, "")}${prefix ? "/" : ""}${d.name}`,
        size: (d.metadata as { size?: number } | null)?.size ?? 0,
        updatedAt: d.updated_at ?? null,
      }));
  },

  async write(path: string, content: string, contentType = "text/plain"): Promise<void> {
    const userId = await uid();
    const full = joinPath(userId, path);
    const blob = new Blob([content], { type: contentType });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(full, blob, { upsert: true, contentType });
    if (error) throw error;
    void logActivity({ module: "files", message: "write", metadata: { path } });
  },

  async read(path: string): Promise<string> {
    const userId = await uid();
    const full = joinPath(userId, path);
    const { data, error } = await supabase.storage.from(BUCKET).download(full);
    if (error) throw error;
    return await data.text();
  },

  async remove(path: string): Promise<void> {
    const userId = await uid();
    const full = joinPath(userId, path);
    const { error } = await supabase.storage.from(BUCKET).remove([full]);
    if (error) throw error;
    void logActivity({ module: "files", message: "remove", metadata: { path } });
  },

  async signedUrl(path: string, expiresIn = 60): Promise<string> {
    const userId = await uid();
    const full = joinPath(userId, path);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(full, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },
};
