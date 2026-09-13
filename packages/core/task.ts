import fs from "node:fs/promises";
import path from "node:path";
import type { ActionPolicy, BrowserAction } from "./actions.js";
import { validateAction } from "./actions.js";
import type { BrowserExecutor } from "./executor.js";
import type { TaskResult, Evidence, Step, StepTelemetry } from "./evidence.js";
import { observe } from "./observer.js";
import type { Planner } from "./planner.js";
import type { Page } from "playwright";

export type TaskLimits = {
  maxSteps: number;
  maxTimeMs: number;
};

export type TaskRunOptions = {
  dryRun?: boolean;
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
  runOptions?: TaskRunOptions;
};

async function capture(page: Page, dir: string, index: number, label: string) {
  const filename = `${String(index).padStart(3, "0")}-${label}.png`;
  await page.screenshot({ path: path.join(dir, filename), fullPage: true });
}

function shouldCaptureBefore(action: BrowserAction, stepObservationText: string | undefined) {
  return action.type === "click" && /delete|remove/i.test(stepObservationText ?? "");
}

export function describeAction(action: BrowserAction): string {
  switch (action.type) {
    case "goto":
      return `Navigate to ${action.url}`;
    case "click":
      return action.reason ?? `Click element ${action.target.elementId}`;
    case "fill":
      return action.reason ?? `Fill element ${action.target.elementId} with "${action.value}"`;
    case "assert":
      return action.assertion.type === "textVisible" ? `Verify "${action.assertion.text}" is visible` : `Verify URL contains "${action.assertion.value}"`;
    case "finish":
      return `Finish: ${action.reason}`;
    case "blocked":
      return `Blocked: ${action.reason}`;
    default:
      return action.reason ?? `Execute ${action.type}`;
  }
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

async function writeTrace(artifactsPath: string, result: TaskResult): Promise<TaskResult> {
  await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
  return result;
}

async function dryRunTask(options: TaskRunnerOptions, startedAt: number, artifactsPath: string): Promise<TaskResult> {
  const observationStarted = Date.now();
  const observation = await observe(options.page);
  const observationMs = Date.now() - observationStarted;
  const inferenceStarted = Date.now();
  const actions = options.planner.plan
    ? await options.planner.plan({ task: options.task, observation, defaultUrl: options.defaultUrl })
    : [await options.planner.next({ task: options.task, observation, history: [], remainingSteps: options.limits.maxSteps, defaultUrl: options.defaultUrl })];
  const inferenceMs = Date.now() - inferenceStarted;

  const steps = actions.map<Step>((action, index) => ({
    index: index + 1,
    observation,
    action,
    result: { status: "success", output: "dry-run: not executed" },
    timestamp: Date.now(),
    telemetry: {
      observationMs: index === 0 ? observationMs : 0,
      inferenceMs: index === 0 ? inferenceMs : 0,
      executionMs: 0,
      inputTokens: index === 0 ? estimateTokens({ task: options.task, observation }) : 0,
      outputTokens: estimateTokens(action),
    },
  }));

  const result: TaskResult = {
    status: "passed",
    steps,
    evidence: [{ type: "dryRun", assertion: "No actions executed", result: "passed" }],
    artifactsPath,
    durationMs: Date.now() - startedAt,
    dryRun: true,
  };
  return writeTrace(artifactsPath, result);
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

  if (options.runOptions?.dryRun) {
    return dryRunTask(options, startedAt, artifactsPath);
  }

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
    const proposed = await planner.next(plannerInput);
    const inferenceMs = Date.now() - inferenceStarted;
    const telemetry: StepTelemetry = {
      observationMs,
      inferenceMs,
      executionMs: 0,
      inputTokens: estimateTokens(plannerInput),
      outputTokens: estimateTokens(proposed),
    };

    let action: BrowserAction;
    try {
      action = validateAction(proposed, observation, policy);
    } catch (error) {
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      return writeTrace(artifactsPath, {
        status: "blocked",
        steps,
        evidence,
        error: { reason: error instanceof Error ? error.message : String(error) },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      });
    }

    if (action.type === "blocked") {
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
        await capture(page, artifactsPath, screenshotIndex++, "failure");
        return writeTrace(artifactsPath, {
          status: "blocked",
          steps,
          evidence,
          error: { reason: "Planner requested finish before any successful observable verification." },
          artifactsPath,
          durationMs: Date.now() - startedAt,
        });
      }
      evidence.push({ type: "limit", assertion: "Task completed within step budget", result: "passed" });
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
      result: { status: executed.status, error: executed.error, output: executed.output },
      timestamp: Date.now(),
      telemetry,
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

    void describeAction(action);
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
