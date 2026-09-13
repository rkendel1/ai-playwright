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

export type PlannerTrace = {
  provider: string;
  model?: string;
  input?: unknown;
  rawOutput?: unknown;
  parsedAction?: unknown;
  inference?: {
    id?: string;
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: string;
};

export interface Planner {
  readonly provider?: string;
  readonly model?: string;
  next(input: PlannerInput): Promise<BrowserAction>;
  plan?(input: Omit<PlannerInput, "history" | "remainingSteps">): Promise<BrowserAction[]>;
  consumeTrace?(): PlannerTrace | undefined;
}

export function parseProjectName(task: string): string {
  const named = task.match(/named\s+["']([^"']+)["']/i) || task.match(/named\s+([A-Za-z0-9_-]+)/i);
  if (named?.[1]) return named[1].trim();
  const called = task.match(/called\s+["']([^"']+)["']/i) || task.match(/called\s+([A-Za-z0-9_-]+)/i);
  if (called?.[1]) return called[1].trim();
  return "Demo";
}
