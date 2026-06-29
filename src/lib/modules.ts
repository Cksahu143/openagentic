/**
 * OpenAgent — Module Registry
 *
 * The application is intentionally split into independent modules so each
 * future capability (browser automation, desktop companion, planner, memory,
 * plugins, …) can be developed, versioned, and permission-gated in isolation.
 *
 * Milestone 1 ships this registry plus the **interface contracts** for every
 * module. Implementations are placeholders — they exist so the rest of the
 * codebase can reference a stable API while later milestones swap in real
 * behavior.
 *
 * Adding a new module = create a new entry that satisfies `ModuleDefinition`.
 */

export type ModuleStatus = "planned" | "stub" | "alpha" | "stable";

export interface ModuleDefinition {
  /** Stable kebab-case identifier; used as a permission scope prefix. */
  id: string;
  /** Human-facing module name. */
  name: string;
  /** One-line description shown in the UI. */
  description: string;
  /** Lifecycle status. */
  status: ModuleStatus;
  /** Permission scopes this module requires the user to grant. */
  requiredScopes: string[];
  /** Slug of the Milestone that owns the first real implementation. */
  ownerMilestone: number;
}

export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    id: "planner",
    name: "AI Planner",
    description:
      "Goal → observe → plan → act loop. Coordinates other modules to complete user tasks.",
    status: "planned",
    requiredScopes: ["ai:generate"],
    ownerMilestone: 3,
  },
  {
    id: "browser",
    name: "Browser Controller",
    description:
      "Headless browser automation: navigation, DOM reading, clicking, forms, downloads.",
    status: "planned",
    requiredScopes: ["browser:navigate", "browser:interact"],
    ownerMilestone: 4,
  },
  {
    id: "companion",
    name: "Local Companion",
    description:
      "Optional installable desktop bridge. Exposes accessibility, input, files via signed local channel.",
    status: "planned",
    requiredScopes: ["companion:connect", "desktop:input", "desktop:files"],
    ownerMilestone: 6,
  },
  {
    id: "memory",
    name: "Memory System",
    description:
      "Conversation history, task history, saved workflows, preferences, frequent sites.",
    status: "stub",
    requiredScopes: ["memory:read", "memory:write"],
    ownerMilestone: 2,
  },
  {
    id: "files",
    name: "File Manager",
    description:
      "Read/write/upload/download user files, with explicit per-path permission grants.",
    status: "planned",
    requiredScopes: ["files:read", "files:write"],
    ownerMilestone: 5,
  },
  {
    id: "tasks",
    name: "Task Manager",
    description: "Persistent task records, status tracking, retries, history.",
    status: "stub",
    requiredScopes: [],
    ownerMilestone: 2,
  },
  {
    id: "plugins",
    name: "Plugin System",
    description: "Sandbox third-party capabilities registered as tools the planner can call.",
    status: "planned",
    requiredScopes: ["plugins:install", "plugins:execute"],
    ownerMilestone: 7,
  },
  {
    id: "permissions",
    name: "Permission Manager",
    description: "Single source of truth for what the agent is allowed to do, scoped per user.",
    status: "stub",
    requiredScopes: [],
    ownerMilestone: 1,
  },
  {
    id: "logs",
    name: "Logging System",
    description: "Append-only audit log of every module action with metadata.",
    status: "stub",
    requiredScopes: [],
    ownerMilestone: 1,
  },
];

export function getModule(id: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find((m) => m.id === id);
}
