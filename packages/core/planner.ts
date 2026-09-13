import type { BrowserAction } from "./actions.js";
import type { Observation } from "./observer.js";
import type { Step } from "./evidence.js";

export type PlannerInput = {
  task: string;
  observation: Observation;
  history: Step[];
  remainingSteps: number;
  defaultUrl?: string;
};

export interface Planner {
  next(input: PlannerInput): Promise<BrowserAction>;
}

export function parseProjectName(task: string): string {
  const named = task.match(/named\s+["']([^"']+)["']/i) || task.match(/named\s+([A-Za-z0-9_-]+)/i);
  if (named?.[1]) return named[1].trim();
  const called = task.match(/called\s+["']([^"']+)["']/i) || task.match(/called\s+([A-Za-z0-9_-]+)/i);
  if (called?.[1]) return called[1].trim();
  return "Demo";
}
