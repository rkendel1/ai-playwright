// AI Playwright WASM Kernel
// Runtime-independent, portable state machine for browser automation

export {
  // Types
  type Task,
  type Observation,
  type BrowserAction,
  type ActionPolicy,
  type TaskResult,
  type TaskLimits,
  type Step,
  type StepTelemetry,
  type Evidence,
  type ElementObservation,
  type ElementState,
  type Target,
  type Assertion,
  type ActionRisk,
  type TaskError,
  type StepResult,
  taskId,
  observationId,
  elementId,
  type TaskId,
  type ObservationId,
  type ElementId,
} from "./types.js";

export {
  // Validation
  validateAction,
  actionSchema,
} from "./validation.js";

export {
  // Adapter contracts
  type PlannerAdapter,
  type PlannerRequest,
  type PlannerResponse,
  type BrowserAdapter,
  type BrowserRequest,
  type BrowserResponse,
  type ObservationAdapter,
} from "./adapter-contracts.js";

export {
  // State machine
  Kernel,
} from "./state-machine.js";
