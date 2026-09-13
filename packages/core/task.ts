import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserAction } from "./actions.js";
import { validateAction } from "./actions.js";
import type { BrowserExecutor } from "./executor.js";
import type { TaskResult, Evidence, Step } from "./evidence.js";
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
};

async function capture(page: Page, dir: string, index: number, label: string) {
  const filename = `${String(index).padStart(3, "0")}-${label}.png`;
  await page.screenshot({ path: path.join(dir, filename), fullPage: true });
}

function shouldCaptureBefore(action: BrowserAction, stepObservationText: string) {
  return action.type === "click" && /delete|remove/i.test(stepObservationText);
}

function stepToConsole(action: BrowserAction): string {
  switch (action.type) {
    case "goto":
      return `Opened ${action.url}`;
    case "click":
      return "Clicked element";
    case "fill":
      return `Filled value '${action.value}'`;
    case "assert":
      return "Assertion executed";
    case "finish":
      return `Finished: ${action.reason}`;
    case "blocked":
      return `Blocked: ${action.reason}`;
    default:
      return `Executed ${action.type}`;
  }
}

export async function runTask(options: TaskRunnerOptions): Promise<TaskResult> {
  const { planner, executor, page, task, limits, defaultUrl, artifactsRoot, taskId } = options;
  const startedAt = Date.now();
  const artifactsPath = path.join(artifactsRoot, taskId);
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
      const result: TaskResult = {
        status: "blocked",
        steps,
        evidence,
        error: { reason: "Maximum task time exceeded." },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      };
      await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
      return result;
    }

    const observation = await observe(page);
    const proposed = await planner.next({
      task,
      observation,
      history: steps,
      remainingSteps: limits.maxSteps - index,
      defaultUrl,
    });

    let action: BrowserAction;
    try {
      action = validateAction(proposed, observation);
    } catch (error) {
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      const result: TaskResult = {
        status: "blocked",
        steps,
        evidence,
        error: { reason: error instanceof Error ? error.message : String(error) },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      };
      await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
      return result;
    }

    if (action.type === "blocked") {
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      const result: TaskResult = {
        status: "blocked",
        steps,
        evidence,
        error: { reason: action.reason },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      };
      await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
      return result;
    }

    if (action.type === "finish") {
      if (!hasVerifiedSuccess) {
        await capture(page, artifactsPath, screenshotIndex++, "failure");
        const result: TaskResult = {
          status: "blocked",
          steps,
          evidence,
          error: { reason: "Planner requested finish before any successful observable verification." },
          artifactsPath,
          durationMs: Date.now() - startedAt,
        };
        await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
        return result;
      }
      evidence.push({ type: "limit", assertion: "Task completed within step budget", result: "passed" });
      await capture(page, artifactsPath, screenshotIndex++, "final");
      const result: TaskResult = {
        status: "passed",
        steps,
        evidence,
        artifactsPath,
        durationMs: Date.now() - startedAt,
      };
      await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
      return result;
    }

    if (shouldCaptureBefore(action, observation.text)) {
      await capture(page, artifactsPath, screenshotIndex++, "before-destructive");
    }

    const executed = await executor.execute(page, action, observation);

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
    };
    steps.push(step);

    if (action.type === "assert" && executed.status === "failure") {
      await capture(page, artifactsPath, screenshotIndex++, `step-${String(index).padStart(3, "0")}`);
      continue;
    }

    if (executed.status === "failure") {
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      const result: TaskResult = {
        status: "failed",
        steps,
        evidence,
        error: { reason: executed.error ?? "Action execution failed." },
        artifactsPath,
        durationMs: Date.now() - startedAt,
      };
      await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
      return result;
    }

    await capture(page, artifactsPath, screenshotIndex++, `step-${String(index).padStart(3, "0")}`);

    void stepToConsole(action);
  }

  evidence.push({ type: "limit", assertion: "Task completed within step budget", result: "failed" });
  await capture(page, artifactsPath, 999, "failure");
  const result: TaskResult = {
    status: "blocked",
    steps,
    evidence,
    error: { reason: "Maximum step count exceeded." },
    artifactsPath,
    durationMs: Date.now() - startedAt,
  };
  await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(result, null, 2));
  return result;
}
