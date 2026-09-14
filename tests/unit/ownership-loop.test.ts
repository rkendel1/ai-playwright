import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptHealCandidate,
  createHealCandidate,
  createRun,
  createTest,
  getTest,
  loadRun,
  updateRun,
} from "../../packages/workspace/index.js";

const workspaceDir = path.resolve(".ownership-loop-test-workspace");
const testsDir = path.join(workspaceDir, "tests");
const artifactsDir = path.join(workspaceDir, "artifacts");

const failedStep = {
  index: 4,
  observation: {
    id: "obs-4",
    generation: 4,
    url: "http://127.0.0.1:3000/checkout",
    title: "Checkout",
    elements: [
      {
        id: "place-order",
        role: "button",
        name: "Place order",
        state: { visible: true, enabled: true },
      },
    ],
    text: "Checkout Place order",
  },
  action: {
    type: "click",
    target: { observationId: "obs-4", elementId: "place-order" },
    reason: "Place the order",
    risk: "write",
  },
  validation: { status: "success" },
  result: {
    status: "failure",
    error: 'locator.click: element intercepts pointer events from <div class="toast">',
  },
  timestamp: Date.now(),
};

async function seedFailedRun() {
  createTest(testsDir, {
    name: "Checkout",
    task: "Complete checkout",
    url: "http://127.0.0.1:3000/checkout",
  });
  const { runId } = createRun(
    artifactsDir,
    "checkout",
    "Checkout",
    "http://127.0.0.1:3000/checkout",
    "obscura",
    "deterministic"
  );
  updateRun(artifactsDir, runId, {
    status: "failed",
    result: {
      status: "failed",
      steps: [failedStep],
      evidence: [{ type: "assertion", assertion: "order confirmation is visible", result: "failed" }],
      error: { reason: failedStep.result.error },
      artifactsPath: path.join(artifactsDir, runId, "task-001"),
      durationMs: 1000,
    },
  });
  return runId;
}

describe("ownership loop", () => {
  beforeEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.mkdir(testsDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("creates a verified heal candidate without mutating the canonical test", async () => {
    const originalRunId = await seedFailedRun();
    const before = getTest(testsDir, "checkout");

    const attempt = createHealCandidate(artifactsDir, testsDir, originalRunId, {
      strategy: "actionability-wait",
    });

    expect(attempt.status).toBe("verified");
    expect(attempt.originalRunId).toBe(originalRunId);
    expect(attempt.candidateRunId).not.toBe(originalRunId);
    expect(attempt.original.step.result.status).toBe("failure");
    expect(getTest(testsDir, "checkout")).toEqual(before);

    const candidateRun = loadRun(artifactsDir, attempt.candidateRunId);
    expect(candidateRun.status).toBe("passed");
    expect(candidateRun.ownership).toMatchObject({
      kind: "heal-candidate",
      originalRunId,
      mutatesCanonicalTest: false,
    });
  });

  it("mutates the canonical test only after explicit acceptance and records verification lineage", async () => {
    const originalRunId = await seedFailedRun();
    const attempt = createHealCandidate(artifactsDir, testsDir, originalRunId);
    const before = getTest(testsDir, "checkout");

    const accepted = await acceptHealCandidate(artifactsDir, testsDir, attempt.id, {
      acceptedBy: "test-user",
      verify: async (test) => {
        const { runId } = createRun(artifactsDir, test.id, test.name, test.url ?? "", "obscura", "deterministic");
        updateRun(artifactsDir, runId, { status: "passed", result: { status: "passed", steps: [], evidence: [], artifactsPath: path.join(artifactsDir, runId), durationMs: 1 } });
        return {
          runId,
          testId: test.id,
          testName: test.name,
          status: "passed",
          durationMs: 1,
          planner: "deterministic",
          browser: "obscura",
        };
      },
    });

    const after = getTest(testsDir, "checkout");
    expect(before?.task).toBe("Complete checkout");
    expect(after?.task).toContain("Accepted heal:");
    expect(accepted.status).toBe("accepted");
    expect(accepted.acceptedBy).toBe("test-user");
    expect(accepted.acceptance).toMatchObject({
      changedFields: ["task"],
      verificationStatus: "passed",
    });
    expect(accepted.verificationRunId).toBeDefined();

    const candidateRun = loadRun(artifactsDir, attempt.candidateRunId);
    expect(candidateRun.ownership).toMatchObject({
      accepted: true,
      mutatesCanonicalTest: true,
      verificationRunId: accepted.verificationRunId,
    });
    const verificationRun = loadRun(artifactsDir, accepted.verificationRunId!);
    expect(verificationRun.ownership).toMatchObject({
      kind: "accepted-heal-verification",
      originalRunId,
      candidateRunId: attempt.candidateRunId,
    });
  });
});
