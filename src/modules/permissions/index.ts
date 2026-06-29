/**
 * Permission manager — interface contract.
 *
 * Every sensitive module action must be checked through `ensure(scope)` first.
 * A scope is a colon-separated capability string, e.g. "browser:navigate"
 * or "companion:files".
 *
 * Milestone 1 wires the DB-backed read API; later milestones add UI prompts
 * and just-in-time consent flows.
 */

export interface PermissionGrant {
  scope: string;
  granted: boolean;
  details?: Record<string, unknown>;
}

export interface PermissionManager {
  list(): Promise<PermissionGrant[]>;
  ensure(scope: string): Promise<void>;
  grant(scope: string, details?: Record<string, unknown>): Promise<void>;
  revoke(scope: string): Promise<void>;
}

export const permissions: PermissionManager = {
  async list() { return []; },
  async ensure(scope: string) {
    throw new Error(`Permission "${scope}" not granted. Visit Settings → Permissions.`);
  },
  async grant() { throw new Error("Permission grant not implemented yet (Milestone 1.5)."); },
  async revoke() { throw new Error("Permission revoke not implemented yet (Milestone 1.5)."); },
};
