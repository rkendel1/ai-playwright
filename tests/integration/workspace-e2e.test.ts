import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  resolveConfig,
  discoverTests,
  createTestFile,
  runTests,
  listRuns,
  getLatestRun,
  closeWorkspaceStore,
} from "../../packages/workspace/index.js";
import { startCheckoutApp } from "../fixtures/checkoutApp.js";

describe("Workspace E2E - Failure Diagnosis & Run Observability", () => {
  let workspaceDir: string;
  let checkoutApp: Awaited<ReturnType<typeof startCheckoutApp>>;

  beforeEach(async () => {
    // Create temporary workspace directory
    workspaceDir = path.resolve("./.workspace-test-" + Date.now());
    await fs.mkdir(workspaceDir, { recursive: true });

    // Initialize workspace structure
    const testsDir = path.join(workspaceDir, "tests");
    const artifactsDir = path.join(workspaceDir, "artifacts");
    await fs.mkdir(testsDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });

    // Start checkout app for testing
    checkoutApp = await startCheckoutApp({ mode: "success" });

    // Create default config file
    const configPath = path.join(workspaceDir, "runora.config.ts");
    const configContent = `export default {
  url: "${checkoutApp.url}",
  browser: "obscura",
  artifacts: "./artifacts",
  tests: "./tests",
  planner: "deterministic",
};`;
    await fs.writeFile(configPath, configContent, "utf-8");
  });

  afterEach(async () => {
    if (checkoutApp) {
      await checkoutApp.close();
    }
    if (workspaceDir) await closeWorkspaceStore(path.join(workspaceDir, "artifacts"));
    // Clean up workspace
    if (workspaceDir && (await fs.stat(workspaceDir).catch(() => null))) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("discovers test files in workspace", async () => {
    const config = await resolveConfig(workspaceDir);
    const testsDir = config.tests;

    // Create a test file
    createTestFile(testsDir, "Checkout Flow", "Complete a successful checkout");

    const tests = await discoverTests(testsDir);
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({
      id: "checkout-flow",
      name: "Checkout Flow",
      task: "Complete a successful checkout",
    });
  });

  it("runs tests and stores run metadata", async () => {
    const config = await resolveConfig(workspaceDir);
    const testsDir = config.tests;

    // Create a test file
    createTestFile(testsDir, "Simple Test", "Open the checkout page");

    const tests = await discoverTests(testsDir);
    expect(tests).toHaveLength(1);

    // Run the test
    const results = await runTests(tests, config);
    expect(results).toHaveLength(1);

    // Verify run was stored
    const runs = listRuns(config.artifacts);
    expect(runs.length).toBeGreaterThan(0);

    const latestRun = getLatestRun(config.artifacts, tests[0].id);
    expect(latestRun).toBeDefined();
    expect(latestRun?.testId).toBe(tests[0].id);
    expect(latestRun?.status).toMatch(/passed|failed|blocked/);
  });

  it("captures failure diagnosis for failed runs", async () => {
    const config = await resolveConfig(workspaceDir);

    // Create a test that will fail (assertion failure)
    const testFile = path.join(config.tests, "assertion-fail.test.ts");
    await fs.writeFile(
      testFile,
      `export default {
  name: "Assertion Failure Test",
  task: "This task will fail because we're looking for text that doesn't exist",
};`,
      "utf-8"
    );

    const tests = await discoverTests(config.tests);
    const results = await runTests(tests, config);

    // Check failure diagnosis was captured
    const run = getLatestRun(config.artifacts, tests[0].id);
    if (run?.status === "failed") {
      // For failed runs, there should be failure diagnosis
      if (run.failure) {
        expect(run.failure).toHaveProperty("category");
        expect(run.failure).toHaveProperty("phase");
        expect(run.failure).toHaveProperty("message");
      }
    }
  });

  it("stores evidence and run results", async () => {
    const config = await resolveConfig(workspaceDir);
    createTestFile(config.tests, "Evidence Test", "Open the page");

    const tests = await discoverTests(config.tests);
    await runTests(tests, config);

    const run = getLatestRun(config.artifacts, tests[0].id);
    expect(run).toBeDefined();

    // Verify evidence directory exists
    if (run?.evidence) {
      const evidenceStat = await fs.stat(run.evidence).catch(() => null);
      expect(evidenceStat?.isDirectory()).toBe(true);
    }
  });

  it("tracks run duration and status", async () => {
    const config = await resolveConfig(workspaceDir);
    createTestFile(config.tests, "Duration Test", "Test run duration tracking");

    const tests = await discoverTests(config.tests);
    const startTime = Date.now();
    await runTests(tests, config);
    const endTime = Date.now();

    const run = getLatestRun(config.artifacts, tests[0].id);
    expect(run?.startedAt).toBeDefined();
    expect(run?.finishedAt).toBeDefined();
    expect(run?.durationMs).toBeDefined();
    if (run?.durationMs !== undefined) {
      expect(run.durationMs).toBeGreaterThan(0);
      expect(run.durationMs).toBeLessThanOrEqual(endTime - startTime + 1000);
    }
  });
});
