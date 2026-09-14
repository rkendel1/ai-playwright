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
  signal?: AbortSignal;
  secrets?: Record<string, string>;
};

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("Test stopped by user."));
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      signal.removeEventListener("abort", stop);
      reject(new Error("Test stopped by user."));
    };
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", stop); resolve(value); },
      (error) => { signal.removeEventListener("abort", stop); reject(error); },
    );
  });
}

async function capture(page: Page, dir: string, index: number, label: string) {
  const filename = `${String(index).padStart(3, "0")}-${label}.png`;
  // Form values may be vault-backed. Mask editable controls so screenshots can
  // remain useful evidence without becoming a credential disclosure channel.
  const editableMask = typeof (page as unknown as { locator?: unknown }).locator === "function"
    ? [page.locator("input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']), textarea")]
    : [];
  await page.screenshot({
    path: path.join(dir, filename),
    fullPage: true,
    mask: editableMask,
  });
}

function shouldCaptureBefore(action: BrowserAction, stepObservationText: string | undefined) {
  return action.type === "click" && /delete|remove/i.test(stepObservationText ?? "");
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function groundedClick(task: string, observation: Awaited<ReturnType<typeof observe>>, steps: Step[]): BrowserAction | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/\d+\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedTask = normalize(task);
  const usedTargets = new Set(steps.flatMap((step) => {
    const action = step.action as { type?: string; target?: { elementId?: string } } | undefined;
    const priorObservation = step.observation as { elements?: Array<{ id: string; name?: string }> } | undefined;
    if (action?.type !== "click" || step.result.status !== "success") return [];
    const name = priorObservation?.elements?.find((element) => element.id === action.target?.elementId)?.name;
    return name ? [`${action.target?.elementId}:${normalize(name)}`] : [];
  }));
  const candidates = observation.elements
    .filter((element) => ["button", "link", "checkbox", "radio"].includes(element.role || "") && element.state.enabled && !element.state.checked)
    .map((element) => {
      const name = normalize(element.name || "");
      if (!name || usedTargets.has(`${element.id}:${name}`)) return { element, score: -1 };
      const phraseIndex = normalizedTask.indexOf(name);
      const tokens = name.split(" ").filter((token) => token.length > 1);
      const overlap = tokens.filter((token) => normalizedTask.includes(token)).length;
      const singleAction = tokens.length === 1 && /^(save|submit|create|continue|next|search|add|confirm)$/i.test(tokens[0]) && normalizedTask.includes(tokens[0]);
      const score = phraseIndex >= 0 ? 1000 - phraseIndex : singleAction ? 700 : overlap * 10 - Math.max(0, tokens.length - overlap);
      return { element, score };
    })
    .filter((candidate) => candidate.score >= 10)
    .sort((left, right) => right.score - left.score);
  const best = candidates[0]?.element;
  if (!best) return undefined;
  return {
    type: "click",
    target: { observationId: observation.id, elementId: best.id },
    reason: `Grounded premature finish to the visible control matching the task: ${best.name || best.id}`,
    confidence: 0.8,
    risk: "write",
  };
}

function requestedFieldValue(task: string, field: { name?: string; inputType?: string; autocomplete?: string; options?: Array<{ label: string; value: string }> }, secrets: Record<string, string> = {}): string | undefined {
  const label = (field.name || "").toLowerCase();
  const hint = `${label} ${(field.inputType || "").toLowerCase()} ${(field.autocomplete || "").toLowerCase()}`;
  if (/password|current-password|new-password/.test(hint) && secrets.password) return secrets.password;
  if (/user.?name|login|account/.test(hint) && secrets.username) return secrets.username;
  if (/email/.test(hint) && (secrets.email || secrets.username)) return secrets.email || secrets.username;
  const namedSecret = Object.entries(secrets).find(([name]) => label.includes(name.toLowerCase().replace(/[_-]+/g, " ")));
  if (namedSecret) return namedSecret[1];
  if (/search/.test(label)) {
    return task.match(/\bsearch(?:\s+(?:google|the web))?(?:\s+for)?\s+["']?(.+?)["']?(?:[.!?\n]|$)/i)?.[1]?.trim();
  }
  if (/name|key/.test(label)) {
    const named = task.match(/\b(?:named|called)\s+["']?([a-z0-9_.:@/-]+)/i)?.[1];
    if (named) return named;
  }
  if (/email/.test(label)) return task.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
  if (/url|endpoint|website/.test(label)) return task.match(/https?:\/\/[^\s"']+/i)?.[0];
  const normalizedTask = task.toLowerCase();
  const option = field.options?.find((entry) => normalizedTask.includes(entry.label.toLowerCase()) || normalizedTask.includes(entry.value.toLowerCase()));
  return option?.value;
}

function groundedFormAction(task: string, observation: Awaited<ReturnType<typeof observe>>, steps: Step[], secrets: Record<string, string> = {}): BrowserAction | undefined {
  const editable = observation.elements.filter((element) => ["textbox", "searchbox", "combobox"].includes(element.role || "") && element.state.enabled);
  const completedFields = new Set(steps.flatMap((step) => {
    const action = step.action as { type?: string; target?: { elementId?: string } } | undefined;
    return action?.type === "fill" && action.target?.elementId && step.result.status === "success" ? [action.target.elementId] : [];
  }));
  for (const field of editable) {
    const desired = requestedFieldValue(task, field, secrets);
    const populatedPassword = field.inputType === "password"
      && (field.hasValue === true || (field.hasValue === undefined && completedFields.has(field.id)));
    if (!desired || populatedPassword || (field.value || "").trim() === desired) continue;
    if (field.role === "combobox" && field.options?.length) {
      return { type: "select", target: { observationId: observation.id, elementId: field.id }, value: desired, reason: `Select the requested value for ${field.name || "field"}`, confidence: 0.95, risk: "write" };
    }
    return { type: "fill", target: { observationId: observation.id, elementId: field.id }, value: desired, reason: `Enter the requested value in ${field.name || "field"}`, confidence: 0.95, risk: "write" };
  }
  const normalizedTask = task.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const requestedChoice = observation.elements.find((element) => {
    if (!(["checkbox", "radio"].includes(element.role || "")) || element.state.checked || !element.state.enabled) return false;
    const name = (element.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return name.length > 1 && normalizedTask.includes(name);
  });
  if (requestedChoice) {
    return { type: "click", target: { observationId: observation.id, elementId: requestedChoice.id }, reason: `Choose the requested option: ${requestedChoice.name}`, confidence: 0.95, risk: "write" };
  }
  const filledValues = steps.flatMap((step) => {
    const action = step.action as { type?: string; value?: string } | undefined;
    return action?.type === "fill" && step.result.status === "success" && action.value ? [action.value] : [];
  });
  const submittedAfterFill = filledValues.length > 0 && steps.some((step) => {
    const action = step.action as { type?: string } | undefined;
    return action?.type === "click" && step.result.status === "success";
  });
  const visibleValue = submittedAfterFill && filledValues.find((value) => observation.text?.includes(value));
  if (visibleValue) return { type: "assert", assertion: { type: "textVisible", text: visibleValue }, reason: "Verify the submitted value is visible", confidence: 1, risk: "read" };
  return undefined;
}

function groundedCommonAction(
  task: string,
  observation: Awaited<ReturnType<typeof observe>>,
  steps: Step[],
  hasVerifiedSuccess: boolean,
): BrowserAction | undefined {
  const search = task.match(/\bsearch(?:\s+(?:google|the web))?(?:\s+for)?\s+["']?(.+?)["']?(?:[.!?\n]|$)/i);
  const query = search?.[1]?.trim();
  if (!query) return undefined;
  if (hasVerifiedSuccess) {
    return { type: "finish", result: "success", reason: `Verified search for ${query}`, confidence: 1, risk: "read" };
  }
  const field = observation.elements.find((element) =>
    ["textbox", "searchbox", "combobox"].includes(element.role || "") && /search/i.test(element.name || ""),
  );
  if (field) {
    if ((field.value || "").trim() !== query) {
      return { type: "fill", target: { observationId: observation.id, elementId: field.id }, value: query, reason: `Enter the requested search: ${query}`, confidence: 1, risk: "write" };
    }
    const pressed = steps.some((step) => (step.action as { type?: string; key?: string } | undefined)?.type === "press" && step.result.status === "success");
    if (!pressed) {
      return { type: "press", target: { observationId: observation.id, elementId: field.id }, key: "Enter", reason: "Submit the requested search", confidence: 1, risk: "write" };
    }
  }
  const submitted = steps.some((step) => (step.action as { type?: string; key?: string } | undefined)?.type === "press" && step.result.status === "success");
  if (submitted && /\/search(?:[/?#]|$)/i.test(new URL(observation.url).pathname)) {
    return { type: "assert", assertion: { type: "urlIncludes", value: "search" }, reason: "Verify that search results loaded", confidence: 1, risk: "read" };
  }
  return undefined;
}

function redactSecrets<T>(value: T, sensitiveValues: string[]): T {
  if (!sensitiveValues.length) return value;
  const serialized = JSON.stringify(value);
  const redacted = sensitiveValues.reduce((text, secret) => secret ? text.split(secret).join("[REDACTED]") : text, serialized);
  return JSON.parse(redacted) as T;
}

async function writeTrace(artifactsPath: string, result: TaskResult, sensitiveValues: string[] = []): Promise<TaskResult> {
  const redacted = redactSecrets(result, sensitiveValues);
  await fs.writeFile(path.join(artifactsPath, "trace.json"), JSON.stringify(redacted, null, 2));
  return redacted;
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
  const { planner, executor, page, task, limits, defaultUrl, artifactsRoot, taskId, signal } = options;
  const secrets = options.secrets ?? {};
  const sensitiveValues = Object.values(secrets).filter(Boolean);
  const finish = (result: TaskResult) => writeTrace(path.join(artifactsRoot, taskId), result, sensitiveValues);
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
    if (signal?.aborted) {
      await capture(page, artifactsPath, screenshotIndex++, "stopped").catch(() => undefined);
      return finish({ status: "blocked", steps, evidence, error: { reason: "Test stopped by user." }, artifactsPath, durationMs: Date.now() - startedAt });
    }
    if (Date.now() - startedAt > limits.maxTimeMs) {
      evidence.push({ type: "limit", assertion: "Task completed within time budget", result: "failed" });
      await capture(page, artifactsPath, screenshotIndex++, "failure");
      return finish({
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
    const plannerInput = redactSecrets({
      task,
      observation,
      history: steps,
      remainingSteps: limits.maxSteps - index,
      defaultUrl,
    }, sensitiveValues);
    const inferenceStarted = Date.now();
    let proposed: unknown;
    let stepPlannerTrace: StepPlannerTrace | undefined;
    try {
      proposed = (hasVerifiedSuccess
        ? { type: "finish", result: "success", reason: "The requested behavior was observably verified", confidence: 1, risk: "read" } satisfies BrowserAction
        : groundedCommonAction(task, observation, steps, false)
          ?? groundedFormAction(task, observation, steps, secrets)
          ?? groundedClick(task, observation, steps))
        ?? await abortable(planner.next(plannerInput), signal);
      if ((proposed as { type?: string } | undefined)?.type === "finish" && !hasVerifiedSuccess) {
        proposed = groundedClick(task, observation, steps) ?? proposed;
      }
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
      return finish({
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
      return finish({
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
      return finish({
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
        await capture(page, artifactsPath, screenshotIndex++, `step-${String(index).padStart(3, "0")}-rejected-finish`);
        continue;
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
      return finish({
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
      return finish({
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
  return finish({
    status: "blocked",
    steps,
    evidence,
    error: { reason: "Maximum step count exceeded." },
    artifactsPath,
    durationMs: Date.now() - startedAt,
  });
}
