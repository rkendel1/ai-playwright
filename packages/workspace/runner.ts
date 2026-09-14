import { aiPlaywright } from "../core/index.js";
import { CliPlannerAdapter } from "../cli/adapters/CliPlannerAdapter.js";
import type { Planner } from "../core/planner.js";
import type { TestDefinition } from "./test-model.js";
import type { ModelConfig, ResolvedConfig } from "./config.js";
import { createRun, updateRun, getRunEvidencePath } from "./run-storage.js";
import { aggregateSuiteStatus, createSuiteRun, updateSuiteRun } from "./suite-storage.js";
import type { SuiteRun, SuiteRunEntry } from "./test-model.js";

/**
 * Test runner: thin wrapper around existing execution path
 * Uses same runner for CLI and UI
 *
 * CLI → runner → CliPlannerAdapter → kernel → Playwright/Obscura
 */

export type RunResult = {
  runId: string;
  testId: string;
  testName: string;
  status: "passed" | "failed" | "blocked";
  durationMs: number;
  planner: string;
  model?: string;
  browser: string;
  taskResult?: unknown;
};

function modelName(model: ModelConfig | undefined): string | undefined {
  if (!model || model === "webllm") return undefined;
  return model.model;
}

function createPlanner(config: ResolvedConfig): Planner {
  if (config.planner === "webllm") {
    throw new Error(
      "Intelligent planning runs in the Runora browser workspace. Start `npx runora init` and run the test from that UI.",
    );
  }
  if (config.planner === "deterministic" || config.planner === "mock") {
    return new CliPlannerAdapter();
  }
  throw new Error(`Unsupported planner '${config.planner}'.`);
}

export async function runTest(
  test: TestDefinition,
  config: ResolvedConfig,
  plannerOverride?: Planner,
  signal?: AbortSignal,
): Promise<RunResult> {
  const url = test.url || config.url;
  const evidencePath = getRunEvidencePath(config.artifacts, "current");
  const planner = plannerOverride ?? createPlanner(config);
  const model = config.planner === "webllm" ? modelName(config.model) : undefined;

  // Create run record
  const { runId } = createRun(config.artifacts, test.id, test.name, url, config.browser, config.planner, model);

  const startedAt = Date.now();

  try {
    // Use existing execution path
    const browser = await aiPlaywright({
      browser: config.browser,
      headless: config.headless,
      planner,
      url,
      artifactsDir: getRunEvidencePath(config.artifacts, runId),
      limits: {
        maxSteps: 50,
        maxTimeMs: 300_000,
      },
      signal,
    });

    const taskResult = await browser.task(test.task);
    await browser.close();

    const durationMs = Date.now() - startedAt;

    // Update run with result
    updateRun(config.artifacts, runId, {
      status: taskResult.status,
      result: taskResult,
      durationMs,
    });

    return {
      runId,
      testId: test.id,
      testName: test.name,
      status: taskResult.status,
      durationMs,
      planner: config.planner,
      model,
      browser: config.browser,
      taskResult,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMsg = error instanceof Error ? error.message : String(error);

    updateRun(config.artifacts, runId, {
      status: "failed",
      error: errorMsg,
      durationMs,
    });

    return {
      runId,
      testId: test.id,
      testName: test.name,
      status: "failed",
      durationMs,
      planner: config.planner,
      model,
      browser: config.browser,
    };
  }
}

export async function runTests(
  tests: TestDefinition[],
  config: ResolvedConfig,
  runOne: (test: TestDefinition, config: ResolvedConfig) => Promise<RunResult> = runTest
): Promise<RunResult[]> {
  const results: RunResult[] = [];

  for (const test of tests) {
    const result = await runOne(test, config);
    results.push(result);
  }

  return results;
}

export async function runSuite(
  tests: TestDefinition[],
  config: ResolvedConfig,
  options: { runOne?: (test: TestDefinition, config: ResolvedConfig) => Promise<RunResult>; signal?: AbortSignal } = {}
): Promise<SuiteRun> {
  const suiteRun = createSuiteRun(config.artifacts);
  const runOne = options.runOne ?? runTest;
  const entries: SuiteRunEntry[] = [];

  for (const test of tests) {
    if (options.signal?.aborted) break;
    const result = await runOne(test, config);
    entries.push({
      testId: result.testId,
      testName: result.testName,
      runId: result.runId,
      status: result.status,
      durationMs: result.durationMs,
      planner: result.planner,
      model: result.model,
      browser: result.browser,
    });

    updateSuiteRun(config.artifacts, suiteRun.id, {
      tests: entries,
    });
  }

  return updateSuiteRun(config.artifacts, suiteRun.id, {
    status: aggregateSuiteStatus(entries),
    tests: entries,
  });
}
