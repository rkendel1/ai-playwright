// WASM Kernel Entry Point
// This module is designed to be compiled to WebAssembly

export {
  Kernel,
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
  type Target,
  type Assertion,
  type ActionRisk,
  taskId,
  observationId,
  elementId,
  type TaskId,
  type ObservationId,
  type ElementId,
  // Validation
  validateAction,
  // Contracts
  type PlannerAdapter,
  type PlannerRequest,
  type PlannerResponse,
  type BrowserAdapter,
  type BrowserRequest,
  type BrowserResponse,
} from "../src/index.js";

// Re-export for WASM consumers
export * from "../src/index.js";
