import fs from "node:fs";
import path from "node:path";
import type { SuiteRun, SuiteRunEntry, SuiteRunFinalStatus } from "./test-model.js";
import { queueRecord } from "./workspace-store.js";

export function generateSuiteRunId(): string {
  return `suite-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function getSuiteRunPath(artifactsDir: string, suiteRunId: string): string {
  return path.join(artifactsDir, `${suiteRunId}.json`);
}

export function getSuiteRunEvidencePath(artifactsDir: string, suiteRunId: string): string {
  return path.join(artifactsDir, suiteRunId);
}

export function aggregateSuiteStatus(tests: Array<{ status: SuiteRunEntry["status"] }>): SuiteRunFinalStatus {
  if (tests.some((test) => test.status === "failed")) return "failed";
  if (tests.some((test) => test.status === "blocked")) return "blocked";
  return "passed";
}

export function createSuiteRun(artifactsDir: string): SuiteRun {
  const id = generateSuiteRunId();
  const evidence = getSuiteRunEvidencePath(artifactsDir, id);
  const suiteRun: SuiteRun = {
    id,
    startedAt: Date.now(),
    status: "running",
    tests: [],
    evidence,
  };

  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(getSuiteRunPath(artifactsDir, id), JSON.stringify(suiteRun, null, 2), "utf-8");
  queueRecord(artifactsDir, "suite_runs", suiteRun);

  return suiteRun;
}

export function updateSuiteRun(
  artifactsDir: string,
  suiteRunId: string,
  update: Partial<Omit<SuiteRun, "id" | "startedAt">>
): SuiteRun {
  const current = loadSuiteRun(artifactsDir, suiteRunId);
  const updated: SuiteRun = {
    ...current,
    ...update,
  };

  if (update.status && update.status !== "running" && !updated.finishedAt) {
    updated.finishedAt = Date.now();
    updated.durationMs = updated.finishedAt - updated.startedAt;
  }

  fs.writeFileSync(getSuiteRunPath(artifactsDir, suiteRunId), JSON.stringify(updated, null, 2), "utf-8");
  queueRecord(artifactsDir, "suite_runs", updated);
  return updated;
}

export function loadSuiteRun(artifactsDir: string, suiteRunId: string): SuiteRun {
  return JSON.parse(fs.readFileSync(getSuiteRunPath(artifactsDir, suiteRunId), "utf-8"));
}

export function listSuiteRuns(artifactsDir: string): SuiteRun[] {
  if (!fs.existsSync(artifactsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(artifactsDir)
    .filter((file) => file.startsWith("suite-") && file.endsWith(".json"))
    .sort()
    .reverse();

  return files.map((file) => loadSuiteRun(artifactsDir, file.replace(".json", "")));
}
