/**
 * Planner module — interface contract.
 *
 * Continuous loop: observe → plan → act → observe …
 * Real implementation lands in Milestone 3.
 */

export interface PlannerObservation {
  source: "browser" | "companion" | "memory" | "user";
  summary: string;
  data?: unknown;
}

export interface PlannerStep {
  id: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface PlannerPlan {
  goal: string;
  steps: PlannerStep[];
  reasoning?: string;
}

export interface Planner {
  plan(goal: string, context: PlannerObservation[]): Promise<PlannerPlan>;
  executeStep(step: PlannerStep): Promise<PlannerObservation>;
}

export const planner: Planner = {
  async plan() {
    throw new Error("Planner not implemented yet (Milestone 3).");
  },
  async executeStep() {
    throw new Error("Planner not implemented yet (Milestone 3).");
  },
};
