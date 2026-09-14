/**
 * AI Playwright Workspace
 * Single execution path for CLI and UI
 */

export { type WorkspaceConfig, type ResolvedConfig, type PlannerMode, type ModelConfig, resolveConfig, createDefaultConfig } from "./config.js";
export {
  type TestDefinition,
  type TestRun,
  type RunMetadata,
  type SuiteRun,
  type SuiteRunEntry,
  type SuiteRunFinalStatus,
  type SuiteRunStatus,
} from "./test-model.js";
export { discoverTests, createTestFile } from "./test-discovery.js";
export { createTest, updateTest, deleteTest, getTest } from "./test-management.js";
export { generateRunId, createRun, updateRun, loadRun, listRuns, getLatestRun } from "./run-storage.js";
export {
  generateSuiteRunId,
  getSuiteRunPath,
  getSuiteRunEvidencePath,
  aggregateSuiteStatus,
  createSuiteRun,
  updateSuiteRun,
  loadSuiteRun,
  listSuiteRuns,
} from "./suite-storage.js";
export { runTest, runTests, runSuite, type RunResult } from "./runner.js";
export {
  createHealCandidate,
  acceptHealCandidate,
  loadHealAttempt,
  type HealAttempt,
  type HealAttemptStatus,
  type HealStrategy,
} from "./ownership-loop.js";
export {
  type FailureDiagnosis,
  type FailurePhase,
  type FailureCategory,
  diagnoseFailure,
} from "./failure-model.js";
