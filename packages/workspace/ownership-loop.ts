import fs from "node:fs";
import path from "node:path";
import type { BrowserAction } from "../core/actions.js";
import { validateAction } from "../core/actions.js";
import type { Step, TaskResult } from "../core/evidence.js";
import type { TestDefinition } from "./test-model.js";
import { createRun, loadRun, updateRun } from "./run-storage.js";
import { getTest, updateTest } from "./test-management.js";
import type { RunResult } from "./runner.js";

export type HealStrategy = "force-click" | "actionability-wait";
export type HealAttemptStatus = "verified" | "accepted" | "rejected";

export type HealAttempt = {
  id: string;
  originalRunId: string;
  candidateRunId: string;
  verificationRunId?: string;
  testId: string;
  testName: string;
  stepIndex: number;
  status: HealAttemptStatus;
  createdAt: number;
  acceptedAt?: number;
  acceptedBy?: string;
  candidate: {
    strategy: HealStrategy;
    summary: string;
    action: unknown;
    proposedTask: string;
  };
  original: {
    runId: string;
    status: string;
    evidence?: string;
    step: Step;
  };
  result: {
    candidateRunId: string;
    status: "passed" | "failed" | "blocked";
    evidence?: string;
  };
  acceptance?: {
    before: TestDefinition;
    after: TestDefinition;
    changedFields: string[];
    verificationRunId?: string;
    verificationStatus?: string;
  };
};

type CreateHealCandidateOptions = {
  strategy?: HealStrategy;
  proposedTask?: string;
};

type AcceptHealCandidateOptions = {
  acceptedBy?: string;
  verify?: (test: TestDefinition) => Promise<RunResult>;
};

function attemptPath(artifactsDir: string, attemptId: string): string {
  return path.join(artifactsDir, `${attemptId}.json`);
}

function generateAttemptId(): string {
  return `heal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function taskResult(value: unknown): TaskResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TaskResult>;
  if (!Array.isArray(candidate.steps) || !Array.isArray(candidate.evidence)) return null;
  if (candidate.status !== "passed" && candidate.status !== "failed" && candidate.status !== "blocked") return null;
  if (typeof candidate.artifactsPath !== "string" || typeof candidate.durationMs !== "number") return null;
  return candidate as TaskResult;
}

function failedStep(result: TaskResult): Step | null {
  return result.steps.find((step) => step.result?.status === "failure" || step.validation?.status === "failure") ?? null;
}

function candidateSummary(strategy: HealStrategy): string {
  if (strategy === "force-click") return "Retry the failed click with explicit human review before force is used.";
  return "Add an explicit actionability wait before retrying the failed action.";
}

function candidateTask(currentTask: string, strategy: HealStrategy): string {
  const note =
    strategy === "force-click"
      ? "Accepted heal: verify the target is safe, then retry the blocked click with force only if the overlap is intentional."
      : "Accepted heal: wait for the target element to become visible, enabled, and actionable before retrying the failed step.";
  return `${currentTask}\n\n${note}`;
}

function candidateAction(originalAction: unknown, strategy: HealStrategy): unknown {
  if (!originalAction || typeof originalAction !== "object") return originalAction;
  return {
    ...(originalAction as Record<string, unknown>),
    reason: candidateSummary(strategy),
  };
}

function writeAttempt(artifactsDir: string, attempt: HealAttempt): HealAttempt {
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(attemptPath(artifactsDir, attempt.id), JSON.stringify(attempt, null, 2), "utf-8");
  return attempt;
}

export function loadHealAttempt(artifactsDir: string, attemptId: string): HealAttempt {
  return JSON.parse(fs.readFileSync(attemptPath(artifactsDir, attemptId), "utf-8")) as HealAttempt;
}

export function createHealCandidate(
  artifactsDir: string,
  testsDir: string,
  originalRunId: string,
  options: CreateHealCandidateOptions = {}
): HealAttempt {
  const originalRun = loadRun(artifactsDir, originalRunId);
  const originalResult = taskResult(originalRun.result);
  if (!originalResult) throw new Error("Original run does not contain Runtime Truth.");
  const step = failedStep(originalResult);
  if (!step) throw new Error("Original run does not contain a failed step.");
  const test = getTest(testsDir, originalRun.testId);
  if (!test) throw new Error(`Test "${originalRun.testId}" not found.`);

  const strategy = options.strategy ?? "actionability-wait";
  const action = candidateAction(step.action, strategy);
  const startedAt = Date.now();
  const validationStarted = Date.now();
  let validation: Step["validation"] = { status: "success" };
  let status: TaskResult["status"] = "passed";
  try {
    validateAction(action, step.observation as never, { approval: "never" });
  } catch (error) {
    validation = { status: "failure", error: error instanceof Error ? error.message : String(error) };
    status = "blocked";
  }

  const candidateStep: Step = {
    index: step.index,
    observation: step.observation,
    action,
    validation,
    result:
      validation.status === "success"
        ? { status: "success", output: "Heal candidate validated against preserved failure observation." }
        : { status: "failure", error: validation.error },
    timestamp: Date.now(),
    telemetry: {
      observationMs: 0,
      inferenceMs: 0,
      validationMs: Date.now() - validationStarted,
      executionMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    planner: {
      provider: "heal-candidate",
      parsedAction: action,
    },
  };

  const { runId: candidateRunId } = createRun(
    artifactsDir,
    originalRun.testId,
    `${originalRun.testName} — Heal candidate`,
    originalRun.url,
    originalRun.browser,
    originalRun.planner,
    originalRun.model
  );
  const candidateResult: TaskResult = {
    status,
    steps: [candidateStep],
    evidence: [
      {
        type: "assertion",
        assertion: "heal candidate preserves original failure and requires explicit acceptance",
        result: validation.status === "success" ? "passed" : "failed",
        detail: validation.error,
      },
    ],
    error: validation.status === "failure" ? { reason: validation.error ?? "Candidate validation failed." } : undefined,
    artifactsPath: path.join(artifactsDir, candidateRunId),
    durationMs: Date.now() - startedAt,
  };
  const attemptId = generateAttemptId();
  updateRun(artifactsDir, candidateRunId, {
    status,
    result: candidateResult,
    durationMs: candidateResult.durationMs,
    ownership: {
      kind: "heal-candidate",
      attemptId,
      originalRunId,
      stepIndex: step.index,
      strategy,
      mutatesCanonicalTest: false,
    },
  });

  const attempt: HealAttempt = {
    id: attemptId,
    originalRunId,
    candidateRunId,
    testId: originalRun.testId,
    testName: originalRun.testName,
    stepIndex: step.index,
    status: validation.status === "success" ? "verified" : "rejected",
    createdAt: startedAt,
    candidate: {
      strategy,
      summary: candidateSummary(strategy),
      action,
      proposedTask: options.proposedTask ?? candidateTask(test.task, strategy),
    },
    original: {
      runId: originalRunId,
      status: originalRun.status,
      evidence: originalRun.evidence,
      step,
    },
    result: {
      candidateRunId,
      status,
      evidence: path.join(artifactsDir, candidateRunId),
    },
  };
  return writeAttempt(artifactsDir, attempt);
}

export async function acceptHealCandidate(
  artifactsDir: string,
  testsDir: string,
  attemptId: string,
  options: AcceptHealCandidateOptions = {}
): Promise<HealAttempt> {
  const attempt = loadHealAttempt(artifactsDir, attemptId);
  if (attempt.status === "accepted") return attempt;
  if (attempt.result.status !== "passed") {
    throw new Error("Only a verified passing heal candidate can be accepted.");
  }
  const before = getTest(testsDir, attempt.testId);
  if (!before) throw new Error(`Test "${attempt.testId}" not found.`);

  const after = updateTest(testsDir, attempt.testId, { task: attempt.candidate.proposedTask });
  const verification = options.verify ? await options.verify(after) : undefined;
  const accepted: HealAttempt = {
    ...attempt,
    status: "accepted",
    acceptedAt: Date.now(),
    acceptedBy: options.acceptedBy ?? "workspace-ui",
    verificationRunId: verification?.runId,
    acceptance: {
      before,
      after,
      changedFields: before.task === after.task ? [] : ["task"],
      verificationRunId: verification?.runId,
      verificationStatus: verification?.status,
    },
  };
  updateRun(artifactsDir, accepted.candidateRunId, {
    ownership: {
      kind: "heal-candidate",
      attemptId: accepted.id,
      originalRunId: accepted.originalRunId,
      stepIndex: accepted.stepIndex,
      strategy: accepted.candidate.strategy,
      accepted: true,
      acceptedBy: accepted.acceptedBy,
      acceptedAt: accepted.acceptedAt,
      verificationRunId: accepted.verificationRunId,
      mutatesCanonicalTest: true,
    },
  });
  if (accepted.verificationRunId) {
    updateRun(artifactsDir, accepted.verificationRunId, {
      ownership: {
        kind: "accepted-heal-verification",
        attemptId: accepted.id,
        originalRunId: accepted.originalRunId,
        candidateRunId: accepted.candidateRunId,
        acceptedBy: accepted.acceptedBy,
      },
    });
  }
  return writeAttempt(artifactsDir, accepted);
}
