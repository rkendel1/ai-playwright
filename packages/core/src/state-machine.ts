import type {
  Task,
  Observation,
  BrowserAction,
  ActionPolicy,
  TaskLimits,
  TaskResult,
  Step,
  StepTelemetry,
} from "./types.js";
import { validateAction } from "./validation.js";
import type { PlannerAdapter, BrowserAdapter } from "./adapter-contracts.js";

type KernelState =
  | { phase: "initial" }
  | { phase: "observe"; observation: Observation; stepIndex: number }
  | { phase: "plan"; observation: Observation; stepIndex: number }
  | {
      phase: "validate";
      observation: Observation;
      stepIndex: number;
      proposed: unknown;
    }
  | {
      phase: "execute";
      observation: Observation;
      stepIndex: number;
      action: BrowserAction;
    }
  | { phase: "blocked"; reason: string }
  | { phase: "passed" }
  | { phase: "failed"; reason: string };

export class Kernel {
  private state: KernelState = { phase: "initial" };
  private task: Task;
  private policy: ActionPolicy;
  private limits: TaskLimits;
  private planner: PlannerAdapter;
  private browser: BrowserAdapter;
  private steps: Step[] = [];
  private startedAt: number;
  private currentObservation: Observation | null = null;
  private hasVerifiedSuccess: boolean = false;

  constructor(
    task: Task,
    policy: ActionPolicy,
    limits: TaskLimits,
    planner: PlannerAdapter,
    browser: BrowserAdapter
  ) {
    this.task = task;
    this.policy = policy;
    this.limits = limits;
    this.planner = planner;
    this.browser = browser;
    this.startedAt = Date.now();
  }

  private estimateTokens(value: unknown): number {
    return Math.ceil(JSON.stringify(value).length / 4);
  }

  private createTelemetry(
    observationMs: number,
    inferenceMs: number,
    validationMs: number,
    executionMs: number,
    plannerInput: unknown,
    proposed: unknown
  ): StepTelemetry {
    return {
      observationMs,
      inferenceMs,
      validationMs,
      executionMs,
      inputTokens: this.estimateTokens(plannerInput),
      outputTokens: this.estimateTokens(proposed),
    };
  }

  private checkTimeLimit(): boolean {
    return Date.now() - this.startedAt > this.limits.maxTimeMs;
  }

  private checkStepLimit(stepIndex: number): boolean {
    return stepIndex > this.limits.maxSteps;
  }

  async step(): Promise<TaskResult | null> {
    const durationMs = Date.now() - this.startedAt;

    // Terminal states
    if (this.state.phase === "passed") {
      return {
        status: "passed",
        steps: this.steps,
        evidence: [
          {
            type: "limit",
            assertion: "Task completed within step budget",
            result: "passed",
          },
        ],
        durationMs,
      };
    }

    if (this.state.phase === "failed") {
      return {
        status: "failed",
        steps: this.steps,
        evidence: [],
        error: { reason: this.state.reason },
        durationMs,
      };
    }

    if (this.state.phase === "blocked") {
      return {
        status: "blocked",
        steps: this.steps,
        evidence: [],
        error: { reason: this.state.reason },
        durationMs,
      };
    }

    // INITIAL → OBSERVE
    if (this.state.phase === "initial") {
      // Get first observation
      const observation = await this.browser.observe();
      this.currentObservation = observation;
      this.state = {
        phase: "observe",
        observation,
        stepIndex: 1,
      };
      return null;
    }

    // OBSERVE → PLAN (or terminal)
    if (this.state.phase === "observe") {
      const { observation, stepIndex } = this.state;

      if (this.checkTimeLimit()) {
        this.state = {
          phase: "blocked",
          reason: "Maximum task time exceeded.",
        };
        return null;
      }

      if (this.checkStepLimit(stepIndex)) {
        this.state = {
          phase: "blocked",
          reason: "Maximum step count exceeded.",
        };
        return null;
      }

      this.state = {
        phase: "plan",
        observation,
        stepIndex,
      };
      return null;
    }

    // PLAN → VALIDATE (or blocked)
    if (this.state.phase === "plan") {
      const { observation, stepIndex } = this.state;
      const plannerInput = {
        task: this.task,
        observation,
        policy: this.policy,
        history: this.steps,
        remainingSteps: this.limits.maxSteps - stepIndex,
      };

      const inferenceStarted = Date.now();
      let proposed: unknown;
      try {
        const plannerResponse = await this.planner.plan({
          task: this.task,
          observation,
          policy: this.policy,
          history: this.steps,
          remainingSteps: this.limits.maxSteps - stepIndex,
        });
        proposed = plannerResponse.action;
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error);
        const telemetry = this.createTelemetry(0, Date.now() - inferenceStarted, 0, 0, plannerInput, undefined);
        this.steps.push({
          index: stepIndex,
          observation,
          action: {} as BrowserAction,
          validation: { status: "failure", error: reason },
          result: { status: "failure", error: reason },
          timestamp: Date.now(),
          telemetry,
        });
        // Feed the rejected finish back through history so the planner can
        // recover by producing an observable assertion on the next turn.
        this.state = { phase: "observe", observation, stepIndex: stepIndex + 1 };
        return null;
      }

      this.state = {
        phase: "validate",
        observation,
        stepIndex,
        proposed,
      };
      return null;
    }

    // VALIDATE → EXECUTE (or blocked/failed)
    if (this.state.phase === "validate") {
      const { observation, stepIndex, proposed } = this.state;
      const validationStarted = Date.now();
      let action: BrowserAction;

      try {
        action = validateAction(proposed, observation, this.policy);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error);
        const telemetry = this.createTelemetry(
          0,
          0,
          Date.now() - validationStarted,
          0,
          { observation },
          proposed
        );
        this.steps.push({
          index: stepIndex,
          observation,
          action: proposed as BrowserAction,
          validation: { status: "failure", error: reason },
          result: { status: "failure", error: reason },
          timestamp: Date.now(),
          telemetry,
        });
        this.state = { phase: "blocked", reason };
        return null;
      }

      // Handle blocked action
      if (action.type === "blocked") {
        const telemetry = this.createTelemetry(
          0,
          0,
          Date.now() - validationStarted,
          0,
          { observation },
          action
        );
        this.steps.push({
          index: stepIndex,
          observation,
          action,
          validation: { status: "success" },
          result: { status: "success" },
          timestamp: Date.now(),
          telemetry,
        });
        this.state = { phase: "blocked", reason: action.reason };
        return null;
      }

      // Handle finish before verification
      if (action.type === "finish" && !this.hasVerifiedSuccess) {
        const reason =
          "Planner requested finish before any successful observable verification.";
        const telemetry = this.createTelemetry(
          0,
          0,
          Date.now() - validationStarted,
          0,
          { observation },
          action
        );
        this.steps.push({
          index: stepIndex,
          observation,
          action,
          validation: { status: "failure", error: reason },
          result: { status: "failure", error: reason },
          timestamp: Date.now(),
          telemetry,
        });
        this.state = { phase: "blocked", reason };
        return null;
      }

      this.state = {
        phase: "execute",
        observation,
        stepIndex,
        action,
      };
      return null;
    }

    // EXECUTE → OBSERVE (or blocked/failed)
    if (this.state.phase === "execute") {
      const { observation, stepIndex, action } = this.state;
      const validationStarted = Date.now(); // reuse for overall
      const executionStarted = Date.now();

      const browserResponse = await this.browser.execute({
        action,
        observationId: observation.id,
      });

      const executionMs = Date.now() - executionStarted;
      const executed = browserResponse.result;

      if (action.type === "assert") {
        if (executed.status === "success") {
          this.hasVerifiedSuccess = true;
        }
      }

      // Handle finish action (after validation)
      if (action.type === "finish") {
        const telemetry = this.createTelemetry(0, 0, 0, executionMs, { action }, action);
        this.steps.push({
          index: stepIndex,
          observation,
          action,
          validation: { status: "success" },
          result: { status: executed.status, error: executed.error },
          timestamp: Date.now(),
          telemetry,
        });
        this.state = { phase: "passed" };
        return null;
      }

      // Handle execution failure
      if (executed.status === "failure" && action.type !== "assert") {
        const telemetry = this.createTelemetry(0, 0, 0, executionMs, { action }, action);
        this.steps.push({
          index: stepIndex,
          observation,
          action,
          validation: { status: "success" },
          result: { status: "failure", error: executed.error },
          timestamp: Date.now(),
          telemetry,
        });
        this.state = {
          phase: "failed",
          reason: executed.error ?? "Action execution failed.",
        };
        return null;
      }

      // Create step record
      const telemetry = this.createTelemetry(0, 0, 0, executionMs, { action }, action);
      this.steps.push({
        index: stepIndex,
        observation,
        action,
        validation: { status: "success" },
        result: { status: executed.status, error: executed.error },
        timestamp: Date.now(),
        telemetry,
      });

      // Get next observation if action succeeded or was assertion
      if (
        executed.status === "success" ||
        action.type === "assert"
      ) {
        const nextObservation =
          browserResponse.observation || (await this.browser.observe());
        this.currentObservation = nextObservation;
        this.state = {
          phase: "observe",
          observation: nextObservation,
          stepIndex: stepIndex + 1,
        };
        return null;
      }

      // Continue loop
      this.state = {
        phase: "observe",
        observation,
        stepIndex: stepIndex + 1,
      };
      return null;
    }

    // Unreachable
    return {
      status: "blocked",
      steps: this.steps,
      evidence: [],
      error: { reason: "Kernel in unknown state" },
      durationMs,
    };
  }

  async run(): Promise<TaskResult> {
    while (true) {
      const result = await this.step();
      if (result !== null) {
        return result;
      }
    }
  }

  getState() {
    return this.state;
  }

  getSteps() {
    return this.steps;
  }
}
