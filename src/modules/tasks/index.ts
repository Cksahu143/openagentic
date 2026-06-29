/**
 * Task manager — Milestone 2 implementation. DB-backed.
 */
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/logger";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskRecord {
  id: string;
  goal: string;
  status: TaskStatus;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

function fromRow(r: {
  id: string;
  goal: string;
  status: string;
  result: unknown;
  created_at: string;
  updated_at: string;
}): TaskRecord {
  return {
    id: r.id,
    goal: r.goal,
    status: r.status as TaskStatus,
    result: r.result,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface TaskManager {
  create(goal: string): Promise<TaskRecord>;
  update(
    id: string,
    patch: Partial<Pick<TaskRecord, "status" | "result">>,
  ): Promise<TaskRecord>;
  list(limit?: number): Promise<TaskRecord[]>;
  cancel(id: string): Promise<TaskRecord>;
}

export const tasks: TaskManager = {
  async create(goal: string) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in");
    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: u.user.id, goal, status: "pending" })
      .select("id, goal, status, result, created_at, updated_at")
      .single();
    if (error) throw error;
    void logActivity({ module: "tasks", message: `Task created: ${goal}`, metadata: { id: data.id } });
    return fromRow(data);
  },

  async update(id, patch) {
    const update: { status?: TaskStatus; result?: unknown } = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.result !== undefined) update.result = patch.result;
    const { data, error } = await supabase
      .from("tasks")
      .update(update as never)
      .eq("id", id)
      .select("id, goal, status, result, created_at, updated_at")
      .single();
    if (error) throw error;
    void logActivity({
      module: "tasks",
      message: `Task ${id} → ${patch.status ?? "updated"}`,
      metadata: { id, patch },
    });
    return fromRow(data);
  },

  async list(limit = 100) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, goal, status, result, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },

  async cancel(id) {
    return this.update(id, { status: "cancelled" });
  },
};
