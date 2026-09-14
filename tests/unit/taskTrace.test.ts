import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserExecutor } from "../../packages/core/executor.js";
import type { Planner, PlannerInput, PlannerTrace } from "../../packages/core/planner.js";
import { runTask } from "../../packages/core/task.js";

const artifactsRoot = path.resolve(".artifacts-task-trace-test");

describe("task trace planner evidence", () => {
  afterEach(async () => {
    await fs.rm(artifactsRoot, { recursive: true, force: true });
  });

  it("records observation, model output, parsed action, validation, and execution", async () => {
    let lastTrace: PlannerTrace | undefined;
    const rawOutput = JSON.stringify({
      type: "assert",
      assertion: { type: "textVisible", text: "Ready" },
      reason: "The observed page already contains Ready.",
      confidence: 0.9,
      risk: "read",
    });

    const planner: Planner = {
      provider: "webllm",
      model: "test-model",
      async next(input: PlannerInput) {
        const action = JSON.parse(rawOutput);
        lastTrace = {
          provider: "webllm",
          model: "test-model",
          input: { task: input.task, observation: input.observation },
          rawOutput,
          parsedAction: action,
          inference: { durationMs: 3, inputTokens: 10, outputTokens: 6 },
        };
        return action;
      },
      consumeTrace() {
        const trace = lastTrace;
        lastTrace = undefined;
        return trace;
      },
    };

    const executor: BrowserExecutor = {
      async execute() {
        return { status: "success", output: "Ready" };
      },
    };

    const page = {
      async screenshot() {},
      async evaluate() {
        return {
          id: "obs-1",
          generation: 1,
          url: "http://localhost:3000/",
          title: "Trace fixture",
          text: "Ready",
          elements: [],
        };
      },
    };

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Verify Ready is visible",
      limits: { maxSteps: 1, maxTimeMs: 1000 },
      artifactsRoot,
      taskId: "task-001",
    });

    expect(result.status).toBe("blocked");
    const trace = JSON.parse(await fs.readFile(path.join(result.artifactsPath, "trace.json"), "utf-8"));
    expect(trace.steps[0]).toMatchObject({
      observation: { id: "obs-1", text: "Ready" },
      action: { type: "assert", assertion: { type: "textVisible", text: "Ready" } },
      planner: {
        provider: "webllm",
        model: "test-model",
        rawOutput,
        parsedAction: { type: "assert", assertion: { type: "textVisible", text: "Ready" } },
        inference: { durationMs: 3, inputTokens: 10, outputTokens: 6 },
      },
      validation: { status: "success" },
      result: { status: "success", output: "Ready" },
    });
  });

  it("feeds a premature finish back to the planner and recovers with verification", async () => {
    let call = 0;
    const planner: Planner = {
      provider: "browser-webllm",
      async next() {
        call += 1;
        if (call === 1) return { type: "finish", result: "success", reason: "Done" };
        if (call === 2) return { type: "assert", assertion: { type: "textVisible", text: "Ready" } };
        return { type: "finish", result: "success", reason: "Verified" };
      },
    };
    const executor: BrowserExecutor = { async execute() { return { status: "success" }; } };
    const page = {
      async screenshot() {},
      async evaluate() {
        return { id: `obs-${call}`, generation: call, url: "http://localhost:3000/", title: "App", text: "Ready", elements: [] };
      },
    };

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Verify Ready",
      limits: { maxSteps: 3, maxTimeMs: 1000 },
      artifactsRoot,
      taskId: "task-recovery",
    });

    expect(result.status).toBe("passed");
    expect(result.steps.map((step) => (step.action as { type?: string } | undefined)?.type)).toEqual(["finish", "assert", "finish"]);
    expect(result.steps[0].validation.status).toBe("failure");
  });
});
