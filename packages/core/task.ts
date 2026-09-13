import fs from "node:fs/promises";
import path from "node:path";
import type { ActionPolicy, BrowserAction } from "./actions.js";
import { validateAction } from "./actions.js";
import type { BrowserExecutor } from "./executor.js";
import type { TaskResult, Evidence, Step, StepResult, StepTelemetry, StepPlannerTrace } from "./evidence.js";
import { observe } from "./observer.js";
import type { Planner } from "./planner.js";
import type { Page } from "playwright";

export type TaskLimits = {
  maxSteps: number;
  maxTimeMs: number;
};

export type TaskRunnerOptions = {
  planner: Planner;
  executor: BrowserExecutor;
  page: Page;
  task: string;
  limits: TaskLimits;
  defaultUrl?: string;
  artifactsRoot: string;
  taskId: string;
  policy?: ActionPolicy;
};

async function capture(page: Page, dir: string, index: number, label: string) {
  const filename = `${String(index).padStart(3, "0")}-${label}.png`;
  await page.screenshot({ path: path.join(dir, filename), fullPage: true });
}

function shouldCaptureBefore(action: BrowserAction, stepObservationText: string | undefined) {
  return action.type === "click" && /delete|remove/i.test(stepObservationText ?? "");
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

async function writeTrace(artifactsPath: string, result: TaskResult): Promise<TaskResult> {
  await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
  return result;
}

function plannerTrace(planner: Planner): StepPlannerTrace | undefined {
  const trace = planner.consumeTrace?.();
  if (trace) return trace;
  if (planner.provider) return { provider: planner.provider, model: planner.model };
  return undefined;
}

function failedStep(index: number, observation: unknown, action: unknown, validation: StepResult, telemetry: StepTelemetry, planner?: StepPlannerTrace): Step {
  return {
    index,
    observation,
    action,
    validation,
    result: { status: "failure", error: validation.error },
    timestamp: Date.now(),
    telemetry,
    planner,
  };
}

export async function runTask(options: TaskRunnerOptions): Promise<TaskResult> {
  const { planner, executor, page, task, limits, defaultUrl, artifactsRoot, taskId } = options;
  const startedAt = Date.now();
  const artifactsPath = path.join(artifactsRoot, taskId);
  const policy: ActionPolicy = {
    allowedOrigins: defaultUrl ? [new URL(defaultUrl).origin] : undefined,
    approval: "destructive",
    ...options.policy,
  };
  await fs.mkdir(artifactsPath, { recursive: true });

  const steps: Step[] = [];
  const evidence: Evidence[] = [];
  let hasVerifiedSuccess = false;

  let screenshotIndex = 1;
  await capture(page, artifactsPath, screenshotIndex++, "initial");

  for (let index = 1; index <= limits.maxSteps; index += 1) {
    if (Date.now() - startedAt > limits.maxTimeMs) {
      evidence.push({ type: "limit", assertion: "Task completed within time budget", result: "failed" });
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      return writeTrace(artifactsPath, {
        status: "blocked",
        steps,
        evidence,
        error: { reason: "Maximum task time exceeded." },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      });
    }

    const observationStarted = Date.now();
    const observation = await observe(page);
    const observationMs = Date.now() - observationStarted;
    const plannerInput = {
      task,
      observation,
      history: steps,
      remainingSteps: limits.maxSteps - index,
      defaultUrl,
    };
    const inferenceStarted = Date.now();
    let proposed: unknown;
    let stepPlannerTrace: StepPlannerTrace | undefined;
    try {
      proposed = await planner.next(plannerInput);
      stepPlannerTrace = plannerTrace(planner);
    } catch (error) {
      stepPlannerTrace = plannerTrace(planner);
      const telemetry: StepTelemetry = {
        observationMs,
        inferenceMs: Date.now() - inferenceStarted,
        validationMs: 0,
        executionMs: 0,
        inputTokens: estimateTokens(plannerInput),
        outputTokens: 0,
      };
      const reason = error instanceof Error ? error.message : String(error);
      steps.push(failedStep(index, observation, undefined, { status: "failure", error: reason }, telemetry, stepPlannerTrace));
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      return writeTrace(artifactsPath, {
        status: "blocked",
        steps,
        evidence,
        error: { reason },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      });
    }
    const telemetry: StepTelemetry = {
      observationMs,
      inferenceMs: Date.now() - inferenceStarted,
      validationMs: 0,
      executionMs: 0,
      inputTokens: estimateTokens(plannerInput),
      outputTokens: estimateTokens(proposed),
    };

    let action: BrowserAction;
    const validationStarted = Date.now();
    try {
      action = validateAction(proposed, observation, policy);
      telemetry.validationMs = Date.now() - validationStarted;
    } catch (error) {
      telemetry.validationMs = Date.now() - validationStarted;
      const reason = error instanceof Error ? error.message : String(error);
      steps.push(failedStep(index, observation, proposed, { status: "failure", error: reason }, telemetry, stepPlannerTrace));
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      return writeTrace(artifactsPath, {
        status: "blocked",
        steps,
        evidence,
        error: { reason },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      });
    }

    if (action.type === "blocked") {
      steps.push({
        index,
        observation,
        action,
        validation: { status: "success" },
        result: { status: "success" },
        timestamp: Date.now(),
        telemetry,
        planner: stepPlannerTrace,
      });
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      return writeTrace(artifactsPath, {
        status: "blocked",
        steps,
        evidence,
        error: { reason: action.reason },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      });
    }

    if (action.type === "finish") {
      if (!hasVerifiedSuccess) {
        const reason = "Planner requested finish before any successful observable verification.";
        steps.push(failedStep(index, observation, action, { status: "failure", error: reason }, telemetry, stepPlannerTrace));
        await capture(page, artifactsPath, screenshotIndex++, "failure");
        return writeTrace(artifactsPath, {
          status: "blocked",
          steps,
          evidence,
          error: { reason },
          artifactsPath,
          durationMs: Date.now() - startedAt,
        });
      }
      evidence.push({ type: "limit", assertion: "Task completed within step budget", result: "passed" });
      steps.push({
        index,
        observation,
        action,
        validation: { status: "success" },
        result: { status: "success" },
        timestamp: Date.now(),
        telemetry,
        planner: stepPlannerTrace,
      });
      await capture(page, artifactsPath, screenshotIndex++, "final");
      return writeTrace(artifactsPath, {
        status: "passed",
        steps,
        evidence,
        artifactsPath,
        durationMs: Date.now() - startedAt,
      });
    }

    if (shouldCaptureBefore(action, observation.text)) {
      await capture(page, artifactsPath, screenshotIndex++, "before-destructive");
    }

    const executionStarted = Date.now();
    const executed = await executor.execute(page, action, observation);
    telemetry.executionMs = Date.now() - executionStarted;

    if (action.type === "assert") {
      if (executed.status === "success") {
        hasVerifiedSuccess = true;
      }
      evidence.push({
        type: "assertion",
        assertion: action.assertion.type === "textVisible" ? `text '${action.assertion.text}' is visible` : `url contains '${action.assertion.value}'`,
        result: executed.status === "success" ? "passed" : "failed",
        detail: executed.error,
      });
    }

    const step: Step = {
      index,
      observation,
      action,
      validation: { status: "success" },
      result: { status: executed.status, error: executed.error, output: executed.output },
      timestamp: Date.now(),
      telemetry,
      planner: stepPlannerTrace,
    };
    steps.push(step);

    if (action.type === "assert" && executed.status === "failure") {
      await capture(page, artifactsPath, screenshotIndex++, `step-${String(index).padStart(3, "0")}`);
      continue;
    }

    if (executed.status === "failure") {
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      return writeTrace(artifactsPath, {
        status: "failed",
        steps,
        evidence,
        error: { reason: executed.error ?? "Action execution failed." },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      });
    }

    await capture(page, artifactsPath, screenshotIndex++, `step-${String(index).padStart(3, "0")}`);
  }

  evidence.push({ type: "limit", assertion: "Task completed within step budget", result: "failed" });
  await capture(page, artifactsPath, 999, "failure");
  return writeTrace(artifactsPath, {
    status: "blocked",
    steps,
    evidence,
    error: { reason: "Maximum step count exceeded." },
    artifactsPath,
    durationMs: Date.now() - startedAt,
  });
}
