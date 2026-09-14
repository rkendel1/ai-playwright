// Core WASM kernel types - runtime-independent

export type TaskId = string & { readonly __brand: "TaskId" };
export type ObservationId = string & { readonly __brand: "ObservationId" };
export type ElementId = string & { readonly __brand: "ElementId" };

export function taskId(value: string): TaskId {
  return value as TaskId;
}

export function observationId(value: string): ObservationId {
  return value as ObservationId;
}

export function elementId(value: string): ElementId {
  return value as ElementId;
}

export type Task = {
  id: TaskId;
  goal: string;
  defaultUrl?: string;
};

export type ElementState = {
  visible: boolean;
  enabled: boolean;
  selected?: boolean;
};

export type ElementObservation = {
  id: ElementId;
  role?: string;
  name?: string;
  value?: string;
  ariaLabel?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  state: ElementState;
};

export type Observation = {
  id: ObservationId;
  timestamp: number;
  url: string;
  title: string;
  text?: string;
  viewport?: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    pageWidth: number;
    pageHeight: number;
  };
  elements: ElementObservation[];
};

export type Target = {
  observationId: ObservationId;
  elementId: ElementId;
};

export type Assertion =
  | { type: "textVisible"; text: string }
  | { type: "urlIncludes"; value: string };

export type ActionRisk = "read" | "write" | "destructive";

export type BrowserAction =
  | {
      type: "goto";
      url: string;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "click";
      target: Target;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "fill";
      target: Target;
      value: string;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "press";
      target: Target;
      key: string;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "select";
      target: Target;
      value: string;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "hover";
      target: Target;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "scroll";
      direction: "up" | "down";
      amount?: number;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "wait";
      ms: number;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "extract";
      target: Target;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "assert";
      assertion: Assertion;
      reason?: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "finish";
      result: "success";
      reason: string;
      confidence?: number;
      risk?: ActionRisk;
    }
  | {
      type: "blocked";
      reason: string;
      confidence?: number;
      risk?: ActionRisk;
    };

export type ActionPolicy = {
  allowedOrigins?: string[];
  approval?: "never" | "destructive" | "all";
  allowedKeys?: string[];
};

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

export type Step = {
  index: number;
  observation: Observation;
  action: BrowserAction;
  validation: StepResult;
  result: StepResult;
  timestamp: number;
  telemetry: StepTelemetry;
};

export type TaskResult = {
  status: "passed" | "failed" | "blocked";
  steps: Step[];
  evidence: Evidence[];
  error?: TaskError;
  durationMs: number;
};

export type TaskLimits = {
  maxSteps: number;
  maxTimeMs: number;
};
