export type Evidence =
  | {
      type: "assertion";
      assertion: string;
      result: "passed" | "failed";
      detail?: string;
    }
  | {
      type: "limit";
      assertion: string;
      result: "passed" | "failed";
    };

export type TaskError = {
  reason: string;
};

export type StepResult = {
  status: "success" | "failure";
  error?: string;
  output?: string;
};

export type StepTelemetry = {
  observationMs: number;
  inferenceMs: number;
  validationMs: number;
  executionMs: number;
  inputTokens: number;
  outputTokens: number;
};

export type StepPlannerTrace = {
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

export type Step = {
  index: number;
  observation: unknown;
  action: unknown;
  validation: StepResult;
  result: StepResult;
  timestamp: number;
  telemetry?: StepTelemetry;
  planner?: StepPlannerTrace;
};

export type TaskResult = {
  status: "passed" | "failed" | "blocked";
  steps: Step[];
  evidence: Evidence[];
  error?: TaskError;
  artifactsPath: string;
  durationMs: number;
};
