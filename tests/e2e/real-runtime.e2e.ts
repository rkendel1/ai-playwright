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
    const browser = await aiPlaywright({
      browser: "obscura",
      planner: "webllm",
      model: { provider: "webllm", model: process.env.AIPW_WEBLLM_MODEL ?? "Llama-3.2-1B-Instruct-q4f16_1-MLC" },
      url: demo.url,
      headless: true,
      artifactsDir,
      limits: { maxSteps: 30, maxTimeMs: 180_000 },
      runtime: new ObscuraRuntime(true, { fallbackToPlaywrightChromium: false }),
    });

    try {
      const result = await browser.task("Create a project named Demo and verify that it appears in the project list.");
      expect(result.status).toBe("passed");
      expect(result.steps.length).toBeGreaterThan(1);
      expect(result.steps.every((step) => step.validation.status === "success")).toBe(true);
      expect(result.evidence.some((entry) => entry.type === "assertion" && entry.result === "passed")).toBe(true);

      const trace = JSON.parse(await fs.readFile(path.join(result.artifactsPath, "trace.json"), "utf-8")) as typeof result;
      expect(trace.steps.map((step) => (step.action as { type?: string } | undefined)?.type)).toContain("click");
      expect(trace.steps.map((step) => (step.action as { type?: string } | undefined)?.type)).toContain("fill");
    } finally {
      await browser.close();
      await demo.close();
    }
  });
});
