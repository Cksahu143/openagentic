/**
 * Task manager — interface contract. Milestone 2 wires to DB.
 */

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskRecord {
  id: string;
  goal: string;
  status: TaskStatus;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface TaskManager {
  create(goal: string): Promise<TaskRecord>;
  update(id: string, patch: Partial<Pick<TaskRecord, "status" | "result">>): Promise<TaskRecord>;
  list(limit?: number): Promise<TaskRecord[]>;
}

export const tasks: TaskManager = {
  async create() { throw new Error("Task module not implemented yet (Milestone 2)."); },
  async update() { throw new Error("Task module not implemented yet (Milestone 2)."); },
  async list() { return []; },
};
