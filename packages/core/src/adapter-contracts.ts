// Message-based contracts between WASM kernel and host adapters
// The kernel never knows about the concrete implementation

import type {
  Task,
  Observation,
  BrowserAction,
  ActionPolicy,
  TaskLimits,
  Step,
} from "./types.js";

// ============================================================================
// Planner Adapter Contract
// ============================================================================

export type PlannerRequest = {
  task: Task;
  observation: Observation;
  policy: ActionPolicy;
  history: Step[];
  remainingSteps: number;
};

export type PlannerResponse = {
  action: unknown;
  model?: {
    provider: string;
    model: string;
    inferenceMs: number;
    tokensIn?: number;
    tokensOut?: number;
  };
};

export type PlannerAdapter = {
  plan(request: PlannerRequest): Promise<PlannerResponse>;
};

// ============================================================================
// Browser Adapter Contract
// ============================================================================

export type BrowserRequest = {
  action: BrowserAction;
  observationId: string;
};

export type BrowserResponse = {
  result: {
    status: "success" | "failure";
    error?: string;
    output?: string;
  };
  observation?: Observation;
  evidence?: Array<{
    type: "assertion" | "execution";
    assertion?: string;
    result?: "passed" | "failed";
    detail?: string;
  }>;
};

export type BrowserAdapter = {
  execute(request: BrowserRequest): Promise<BrowserResponse>;
  observe(): Promise<Observation>;
};

// ============================================================================
// Observation Adapter Contract (for initial and refreshed observations)
// ============================================================================

export type ObservationAdapter = {
  observe(): Promise<Observation>;
};
