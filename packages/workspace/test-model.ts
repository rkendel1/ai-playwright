/**
 * Test model: minimal durable representation
 * A test is NOT execution logic - just the definition
 */

export type TestDefinition = {
  id: string;
  name: string;
  task: string;
  url?: string; // Optional override
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
  testId: string;
  testName: string;
  url: string;
  browser: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "passed" | "failed" | "blocked";
  durationMs?: number;
  error?: string;
};
