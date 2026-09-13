import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiPlaywright } from "../../packages/core/index.js";
import { ObscuraRuntime } from "../../packages/obscura/runtime.js";
import { startDemoApp } from "../fixtures/demoApp.js";

const runRealWebLLM = process.env.AIPW_REAL_WEBLLM === "1";
const realWebLLMTest = runRealWebLLM ? it : it.skip;

describe("real WebLLM runtime acceptance", () => {
  realWebLLMTest("plans and executes project creation through Obscura and Playwright", async () => {
    const demo = await startDemoApp();
    const artifactsDir = path.resolve(".artifacts-real-webllm");
    const model = process.env.AIPW_WEBLLM_MODEL ?? "Llama-3.2-1B-Instruct-q4f16_1-MLC";
    const runtime = new ObscuraRuntime(true, { fallbackToPlaywrightChromium: false });
    const browser = await aiPlaywright({
      browser: "obscura",
      planner: "webllm",
      model: { provider: "webllm", model },
      url: demo.url,
      headless: true,
      artifactsDir,
      limits: { maxSteps: 30, maxTimeMs: 180_000 },
      runtime,
    });

    try {
      const result = await browser.task("Create a project named Demo and verify that it appears in the project list.");
      expect(result.status).toBe("passed");
      expect(result.steps.length).toBeGreaterThan(1);
      expect(result.steps.every((step) => step.validation.status === "success")).toBe(true);
      expect(result.steps.every((step) => typeof step.telemetry?.inferenceMs === "number")).toBe(true);
      expect(result.steps.some((step) => (step.telemetry?.inferenceMs ?? 0) > 0)).toBe(true);
      expect(result.evidence.some((entry) => entry.type === "assertion" && entry.result === "passed")).toBe(true);

      const trace = JSON.parse(await fs.readFile(path.join(result.artifactsPath, "trace.json"), "utf-8")) as typeof result;
      expect(trace.steps.map((step) => (step.action as { type?: string } | undefined)?.type)).toContain("click");
      expect(trace.steps.map((step) => (step.action as { type?: string } | undefined)?.type)).toContain("fill");
      expect(trace.steps.every((step) => typeof step.telemetry?.inferenceMs === "number")).toBe(true);
      expect(trace.steps.some((step) => (step.telemetry?.inferenceMs ?? 0) > 0)).toBe(true);

      const launchInfo = runtime.launchInfo();
      expect(launchInfo).toMatchObject({
        browser: "obscura",
        cdpConnected: true,
        fallbackUsed: false,
      });
      const passedAssertion = result.evidence.find((entry) => entry.type === "assertion" && entry.result === "passed");
      expect(passedAssertion).toBeDefined();

      console.info([
        "REAL RUNTIME ACCEPTANCE",
        "Browser: Obscura",
        `CDP: connected (${launchInfo?.cdpEndpoint})`,
        "Planner: WebLLM",
        `Model: ${model}`,
        `Model loaded: ${model}`,
        `WebLLM inference: ${result.steps.length} model action(s) produced`,
        "Trace:",
        ...result.steps.map((step) => {
          const action = step.action as { type?: string };
          return `  ${String((step.observation as { id?: string }).id)} → model output ${action.type} → validated ${step.validation.status} → Playwright ${step.result.status}`;
        }),
        `Independent assertion: ${passedAssertion?.assertion} ${passedAssertion?.result}`,
      ].join("\n"));
    } finally {
      await browser.close();
      await demo.close();
    }
  });
});
