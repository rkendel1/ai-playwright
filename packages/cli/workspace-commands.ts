import fs from "node:fs";
import path from "node:path";
import {
  resolveConfig,
  createDefaultConfig,
  discoverTests,
  createTestFile,
  runTests,
  runTest,
  listRuns,
  getLatestRun,
} from "../workspace/index.js";
import { startUIServer } from "../workspace/ui-server.js";
import type { TestDefinition } from "../workspace/index.js";

/**
 * Workspace CLI commands
 * These use the shared runner for test execution
 */

export async function initWorkspace(workspaceDir: string): Promise<void> {
  // Create directories
  const testsDir = path.join(workspaceDir, "tests");
  const artifactsDir = path.join(workspaceDir, "artifacts");

  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
  }
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // Create config file
  const configPath = path.join(workspaceDir, "ai-playwright.config.ts");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, createDefaultConfig(workspaceDir), "utf-8");
  }

  console.log("✓ AI Playwright workspace initialized");
  console.log(`  Config: ${configPath}`);
  console.log(`  Tests: ${testsDir}`);
  console.log(`  Artifacts: ${artifactsDir}`);
}

export async function runTestCommand(
  testName?: string,
  options?: { url?: string; workspaceDir?: string }
): Promise<void> {
  const workspaceDir = options?.workspaceDir || process.cwd();
  const config = await resolveConfig(workspaceDir, {
    url: options?.url,
  });

  console.log("\nAI Playwright");
  console.log(`Workspace: ${workspaceDir}`);
  console.log(`Config: ${config.url || "default"}\n`);

  // Discover tests
  const tests = await discoverTests(config.tests);

  if (tests.length === 0) {
    console.error("No tests found");
    process.exit(1);
  }

  // Filter tests if name specified
  let testsToRun = tests;
  if (testName) {
    const test = tests.find((t) => t.id === testName || t.name === testName);
    if (!test) {
      console.error(`Test not found: ${testName}`);
      console.log(`Available tests: ${tests.map((t) => t.id).join(", ")}`);
      process.exit(1);
    }
    testsToRun = [test];
  }

  // Run tests
  console.log(`Running ${testsToRun.length} test(s)...\n`);

  const results = await runTests(testsToRun, config);

  // Report results
  console.log("\nResults:");
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const blocked = results.filter((r) => r.status === "blocked").length;

  for (const test of testsToRun) {
    const result = results.find((r) => r.testId === test.id);
    if (result) {
      const emoji = result.status === "passed" ? "✓" : result.status === "failed" ? "✗" : "⊘";
      console.log(`  ${emoji} ${test.name}`);
    }
  }

  if (passed + failed + blocked > 0) {
    console.log(
      `\n${passed} passed, ${failed} failed, ${blocked} blocked (${Math.round(results.reduce((s, r) => s + r.durationMs, 0) / 1000)}s)`
    );
  }

  console.log(`\nEvidence: ${config.artifacts}`);

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

export async function listTestsCommand(workspaceDir?: string): Promise<void> {
  const dir = workspaceDir || process.cwd();
  const config = await resolveConfig(dir);
  const tests = await discoverTests(config.tests);

  if (tests.length === 0) {
    console.log("No tests found");
    return;
  }

  console.log("\nTests:");
  for (const test of tests) {
    const latest = getLatestRun(config.artifacts, test.id);
    const status = latest
      ? latest.status === "passed"
        ? "✓"
        : latest.status === "failed"
          ? "✗"
          : "⊘"
      : "-";
    console.log(`  ${status} ${test.name}`);
  }
}

export async function startUICommand(workspaceDir?: string, port: number = 3001): Promise<void> {
  const dir = workspaceDir || process.cwd();
  await startUIServer(dir, port);
}
