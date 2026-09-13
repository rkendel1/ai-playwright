import { aiPlaywright } from "../core/index.js";
import { CliPlannerAdapter } from "../cli/adapters/CliPlannerAdapter.js";
import type { TestDefinition } from "./test-model.js";
import type { ResolvedConfig } from "./config.js";
import { createRun, updateRun, getRunEvidencePath } from "./run-storage.js";

/**
 * Test runner: thin wrapper around existing execution path
 * Uses same runner for CLI and UI
 *
 * CLI → runner → CliPlannerAdapter → kernel → Playwright/Obscura
 */

export type RunResult = {
  runId: string;
  testId: string;
  status: "passed" | "failed" | "blocked";
  durationMs: number;
  taskResult?: unknown;
};

export async function runTest(
  test: TestDefinition,
  config: ResolvedConfig
): Promise<RunResult> {
  const url = test.url || config.url;
  const evidencePath = getRunEvidencePath(config.artifacts, "current");

  // Create run record
  const { runId } = createRun(config.artifacts, test.id, test.name, url, config.browser);

  const startedAt = Date.now();

  try {
    // Use existing execution path
    const browser = await aiPlaywright({
      browser: config.browser,
      headless: true,
      planner: new CliPlannerAdapter(),
      url,
      artifactsDir: getRunEvidencePath(config.artifacts, runId),
      limits: {
        maxSteps: 50,
        maxTimeMs: 300_000,
      },
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
      status: taskResult.status,
      durationMs,
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
      status: "failed",
      durationMs,
    };
  }
}

export async function runTests(
  tests: TestDefinition[],
  config: ResolvedConfig
): Promise<RunResult[]> {
  const results: RunResult[] = [];

  for (const test of tests) {
    const result = await runTest(test, config);
    results.push(result);
  }

  return results;
}
