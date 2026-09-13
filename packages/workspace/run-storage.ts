import fs from "node:fs";
import path from "node:path";
import type { RunMetadata } from "./test-model.js";

/**
 * Simple run storage in artifacts directory
 * Each run is a JSON file with metadata and result
 */

export type StoredRun = RunMetadata & {
  result?: unknown; // TaskResult
  evidence?: string; // Path to evidence directory
};

export function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function getRunPath(artifactsDir: string, runId: string): string {
  return path.join(artifactsDir, `${runId}.json`);
}

export function getRunEvidencePath(artifactsDir: string, runId: string): string {
  return path.join(artifactsDir, runId);
}

export function createRun(
  artifactsDir: string,
  testId: string,
  testName: string,
  url: string,
  browser: string
): { runId: string; metadata: RunMetadata } {
  const runId = generateRunId();
  const now = Date.now();

  const metadata: RunMetadata = {
    testId,
    testName,
    url,
    browser,
    startedAt: now,
    status: "running",
  };

  // Ensure artifacts directory exists
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // Create evidence directory
  const evidencePath = getRunEvidencePath(artifactsDir, runId);
  fs.mkdirSync(evidencePath, { recursive: true });

  // Write initial metadata
  const runPath = getRunPath(artifactsDir, runId);
  fs.writeFileSync(
    runPath,
    JSON.stringify(
      {
        ...metadata,
        evidence: evidencePath,
      },
      null,
      2
    ),
    "utf-8"
  );

  return { runId, metadata };
}

export function updateRun(
  artifactsDir: string,
  runId: string,
  update: Partial<StoredRun>
): void {
  const runPath = getRunPath(artifactsDir, runId);
  const current = JSON.parse(fs.readFileSync(runPath, "utf-8"));
  const updated = {
    ...current,
    ...update,
    finishedAt: update.finishedAt || update.status !== "running" ? Date.now() : current.finishedAt,
  };

  if (!update.finishedAt && update.status !== "running") {
    updated.finishedAt = Date.now();
    if (current.startedAt) {
      updated.durationMs = updated.finishedAt - current.startedAt;
    }
  }

  fs.writeFileSync(runPath, JSON.stringify(updated, null, 2), "utf-8");
}

export function loadRun(artifactsDir: string, runId: string): StoredRun {
  const runPath = getRunPath(artifactsDir, runId);
  return JSON.parse(fs.readFileSync(runPath, "utf-8"));
}

export function listRuns(artifactsDir: string): StoredRun[] {
  if (!fs.existsSync(artifactsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(artifactsDir)
    .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
    .sort()
    .reverse(); // Newest first

  return files.map((f) => {
    const runId = f.replace(".json", "");
    return loadRun(artifactsDir, runId);
  });
}

export function getLatestRun(artifactsDir: string, testId: string): StoredRun | null {
  const runs = listRuns(artifactsDir);
  return runs.find((r) => r.testId === testId) || null;
}
