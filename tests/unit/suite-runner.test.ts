import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateSuiteStatus,
  createRun,
  createTestFile,
  discoverTests,
  getLatestRun,
  listSuiteRuns,
  loadSuiteRun,
  runSuite,
  runTests,
  updateRun,
  type ResolvedConfig,
  type RunResult,
  type TestDefinition,
} from "../../packages/workspace/index.js";

const tempRoots: string[] = [];

function tempDir(name: string): string {
  const dir = path.resolve(`./.suite-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tempRoots.push(dir);
  return dir;
}

function config(workspaceDir: string, planner: ResolvedConfig["planner"] = "deterministic"): ResolvedConfig {
  return {
    url: "http://127.0.0.1:3000",
    browser: "obscura",
    artifacts: path.join(workspaceDir, "artifacts"),
    tests: path.join(workspaceDir, "tests"),
    planner,
    headless: true,
    model: planner === "webllm" ? { provider: "webllm", model: "test-model" } : undefined,
  };
}

function fakeRun(statuses: Array<RunResult["status"]>) {
  let index = 0;
  return async (test: TestDefinition, resolved: ResolvedConfig): Promise<RunResult> => {
    const status = statuses[index++] ?? "passed";
    return {
      runId: `run-${test.id}`,
      testId: test.id,
      testName: test.name,
      status,
      durationMs: index * 100,
      planner: resolved.planner,
      model: typeof resolved.model === "object" ? resolved.model.model : undefined,
      browser: resolved.browser,
    };
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("suite runs", () => {
  it("discovers every test and preserves individual run IDs", async () => {
    const workspaceDir = tempDir("discovery");
    const resolved = config(workspaceDir);
    await fs.mkdir(resolved.tests, { recursive: true });
    createTestFile(resolved.tests, "Checkout", "Complete checkout");
    createTestFile(resolved.tests, "Invalid Payment", "Reject invalid card");
    createTestFile(resolved.tests, "Account Settings", "Open account settings");

    const tests = await discoverTests(resolved.tests);
    const suiteRun = await runSuite(tests, resolved, { runOne: fakeRun(["passed", "failed", "blocked"]) });

    expect(suiteRun.tests).toHaveLength(3);
    expect(suiteRun.tests.map((test) => test.runId)).toEqual([
      "run-account-settings",
      "run-checkout",
      "run-invalid-payment",
    ]);
  });

  it("executes tests sequentially", async () => {
    const workspaceDir = tempDir("sequential");
    const resolved = config(workspaceDir);
    const tests: TestDefinition[] = [
      { id: "one", name: "One", task: "one" },
      { id: "two", name: "Two", task: "two" },
      { id: "three", name: "Three", task: "three" },
    ];
    const events: string[] = [];

    await runSuite(tests, resolved, {
      runOne: async (test, cfg) => {
        events.push(`start:${test.id}`);
        await Promise.resolve();
        events.push(`finish:${test.id}`);
        return fakeRun(["passed"])(test, cfg);
      },
    });

    expect(events).toEqual(["start:one", "finish:one", "start:two", "finish:two", "start:three", "finish:three"]);
  });

  it.each([
    [["passed", "passed"], "passed"],
    [["passed", "failed"], "failed"],
    [["passed", "blocked"], "blocked"],
    [["failed", "blocked"], "failed"],
  ] as const)("aggregates %j to %s", (statuses, expected) => {
    expect(aggregateSuiteStatus(statuses.map((status) => ({ status })))).toBe(expected);
  });

  it("persists suite run history across storage reloads", async () => {
    const workspaceDir = tempDir("persist");
    const resolved = config(workspaceDir);
    const tests: TestDefinition[] = [{ id: "checkout", name: "Checkout", task: "checkout" }];

    const suiteRun = await runSuite(tests, resolved, { runOne: fakeRun(["passed"]) });
    const loaded = loadSuiteRun(resolved.artifacts, suiteRun.id);
    const history = listSuiteRuns(resolved.artifacts);

    expect(loaded).toMatchObject({ id: suiteRun.id, status: "passed" });
    expect(history.map((run) => run.id)).toContain(suiteRun.id);
  });

  it("keeps single-test execution as a direct run list", async () => {
    const workspaceDir = tempDir("single");
    const resolved = config(workspaceDir);
    const tests: TestDefinition[] = [{ id: "checkout", name: "Checkout", task: "checkout" }];

    const results = await runTests(tests, resolved, fakeRun(["passed"]));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ testId: "checkout", runId: "run-checkout", status: "passed" });
    expect(listSuiteRuns(resolved.artifacts)).toEqual([]);
  });

  it("preserves failure diagnosis on failed individual runs", async () => {
    const workspaceDir = tempDir("diagnosis");
    const resolved = config(workspaceDir);
    const { runId } = createRun(resolved.artifacts, "payment", "Payment", resolved.url, resolved.browser, resolved.planner);

    updateRun(resolved.artifacts, runId, {
      status: "failed",
      result: {
        status: "failed",
        steps: [],
        evidence: [{ result: "failed", assertion: "Payment succeeds", detail: "Text not found" }],
      },
    });

    expect(getLatestRun(resolved.artifacts, "payment")?.failure).toMatchObject({
      category: "assertion_failed",
      phase: "assertion",
    });
  });

  it("preserves WebLLM planner metadata and deterministic planner metadata", async () => {
    const workspaceDir = tempDir("planner");
    const tests: TestDefinition[] = [{ id: "checkout", name: "Checkout", task: "checkout" }];

    const webllmRun = await runSuite(tests, config(workspaceDir, "webllm"), { runOne: fakeRun(["passed"]) });
    const deterministicRun = await runSuite(tests, config(workspaceDir, "deterministic"), { runOne: fakeRun(["passed"]) });

    expect(webllmRun.tests[0]).toMatchObject({ planner: "webllm", model: "test-model", browser: "obscura" });
    expect(deterministicRun.tests[0]).toMatchObject({ planner: "deterministic", browser: "obscura" });
  });

  it("does not silently fall back for an unsupported planner", async () => {
    const workspaceDir = tempDir("planner-fallback");
    const tests: TestDefinition[] = [{ id: "checkout", name: "Checkout", task: "checkout" }];
    const badConfig = { ...config(workspaceDir), planner: "unknown" as ResolvedConfig["planner"] };

    await expect(runSuite(tests, badConfig)).rejects.toThrow("Unsupported planner 'unknown'");
  });
});
