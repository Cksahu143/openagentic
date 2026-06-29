/**
 * Memory module — interface contract.
 * Milestone 2 wires it to the database.
 */

export interface MemoryEntry {
  id: string;
  kind: "conversation" | "task" | "workflow" | "preference" | "site";
  value: unknown;
  createdAt: string;
}

export interface MemoryStore {
  save(kind: MemoryEntry["kind"], value: unknown): Promise<MemoryEntry>;
  list(kind: MemoryEntry["kind"], limit?: number): Promise<MemoryEntry[]>;
  search(query: string): Promise<MemoryEntry[]>;
}

export const memory: MemoryStore = {
  async save() { throw new Error("Memory module not implemented yet (Milestone 2)."); },
  async list() { return []; },
  async search() { return []; },
};
