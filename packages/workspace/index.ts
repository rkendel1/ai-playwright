/**
 * AI Playwright Workspace
 * Single execution path for CLI and UI
 */

export { type WorkspaceConfig, type ResolvedConfig, resolveConfig, createDefaultConfig } from "./config.js";
export { type TestDefinition, type TestRun, type RunMetadata } from "./test-model.js";
export { discoverTests, createTestFile } from "./test-discovery.js";
export { createTest, updateTest, deleteTest, getTest } from "./test-management.js";
export { generateRunId, createRun, updateRun, loadRun, listRuns, getLatestRun } from "./run-storage.js";
export { runTest, runTests, type RunResult } from "./runner.js";
export {
  type FailureDiagnosis,
  type FailurePhase,
  type FailureCategory,
  diagnoseFailure,
} from "./failure-model.js";
