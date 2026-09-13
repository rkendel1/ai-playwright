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
    }
  | {
      type: "dryRun";
      assertion: string;
      result: "passed";
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
  executionMs: number;
  inputTokens: number;
  outputTokens: number;
};

export type Step = {
  index: number;
  observation: unknown;
  action: unknown;
  result: StepResult;
  timestamp: number;
  telemetry?: StepTelemetry;
};

export type TaskResult = {
  status: "passed" | "failed" | "blocked";
  steps: Step[];
  evidence: Evidence[];
  error?: TaskError;
  artifactsPath: string;
  durationMs: number;
  dryRun?: boolean;
};
