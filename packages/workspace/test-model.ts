/**
 * Test model: minimal durable representation
 * A test is NOT execution logic - just the definition
 */

export type TestDefinition = {
  id: string;
  name: string;
  task: string;
  url?: string; // Optional override
  secretProfileId?: string; // DEPRECATED: Use secretProfileIds instead
  secretProfileIds?: string[]; // Multiple credentials (values remain in the local vault)
};

export type TestRun = {
  id: string;
  testId: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "passed" | "failed" | "blocked";
  taskResult?: unknown; // TaskResult from kernel
};

export type RunMetadata = {
  id: string;
  testId: string;
  testName: string;
  url: string;
  browser: string;
  planner?: string;
  model?: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "passed" | "failed" | "blocked";
  durationMs?: number;
  error?: string;
};

export type SuiteRunFinalStatus = "passed" | "failed" | "blocked";

export type SuiteRunStatus = SuiteRunFinalStatus | "running";

export type SuiteRunEntry = {
  testId: string;
  testName: string;
  runId: string;
  status: SuiteRunFinalStatus;
  durationMs: number;
  planner?: string;
  model?: string;
  browser: string;
};

export type SuiteRun = {
  id: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: SuiteRunStatus;
  tests: SuiteRunEntry[];
  evidence: string;
};
