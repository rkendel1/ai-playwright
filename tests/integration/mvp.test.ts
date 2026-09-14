import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { aiPlaywright } from "../../packages/core/index.js";
import { ObscuraRuntime } from "../../packages/obscura/runtime.js";
import { startDemoApp } from "../fixtures/demoApp.js";

async function runTaskWithDemo(options?: {
  buttonLabel?: string;
  includeCreateButton?: boolean;
  runtime?: ObscuraRuntime;
}) {
  const demo = await startDemoApp(options);
  const artifactsDir = path.resolve(".artifacts-tests");
  const browser = await aiPlaywright({
    browser: "obscura",
    planner: "mock",
    url: demo.url,
    headless: true,
    artifactsDir,
    limits: { maxSteps: 30, maxTimeMs: 60_000 },
    runtime: options?.runtime,
  });

  try {
    const result = await browser.task(`
      Open the demo application.
      Create a project named "Demo".
      Verify that "Demo" appears in the project list.
    `);
    return result;
  } finally {
    await browser.close();
    await demo.close();
  }
}

describe("Runora MVP", () => {
  it("passes the canonical create project task", async () => {
    const result = await runTaskWithDemo();

    expect(result.status).toBe("passed");
    expect(result.evidence.some((entry) => entry.type === "assertion" && entry.result === "passed")).toBe(true);

    const tracePath = path.join(result.artifactsPath, "trace.json");
    const traceRaw = await fs.readFile(tracePath, "utf-8");
    const trace = JSON.parse(traceRaw) as { status: string; steps: Array<{ validation?: { status: string }; telemetry?: { inferenceMs: number } }> };
    expect(trace.status).toBe("passed");
    expect(trace.steps.every((step) => step.validation?.status === "success")).toBe(true);
    expect(trace.steps.some((step) => typeof step.telemetry?.inferenceMs === "number")).toBe(true);
  });

  it("recovers from renamed creation button", async () => {
    const result = await runTaskWithDemo({ buttonLabel: "Create Project" });
    expect(result.status).toBe("passed");
  });

  it("returns blocked when create control is missing", async () => {
    const result = await runTaskWithDemo({ includeCreateButton: false });
    expect(result.status).toBe("blocked");
    expect(result.error?.reason).toContain("safely performs the requested");
  });

  it("falls back to Playwright Chromium when Obscura command is unavailable", async () => {
    const connectSpy = vi.spyOn(chromium, "connectOverCDP");
    const launchSpy = vi.spyOn(chromium, "launch");
    const runtime = new ObscuraRuntime(true, {
      obscuraCommand: "obscura-not-installed",
      fallbackToPlaywrightChromium: true,
    });

    try {
      const result = await runTaskWithDemo({ runtime });
      expect(result.status).toBe("passed");
      expect(connectSpy).not.toHaveBeenCalled();
      expect(launchSpy).toHaveBeenCalled();
      expect(runtime.launchInfo()).toMatchObject({
        browser: "playwright-chromium",
        cdpConnected: false,
        fallbackUsed: true,
      });
    } finally {
      connectSpy.mockRestore();
      launchSpy.mockRestore();
    }
  });

  it("surfaces Obscura launch error when fallback is disabled", async () => {
    await expect(
      aiPlaywright({
        browser: "obscura",
        runtime: new ObscuraRuntime(true, {
          obscuraCommand: "obscura-not-installed",
          fallbackToPlaywrightChromium: false,
        }),
      }),
    ).rejects.toThrow("Failed to launch Obscura");
  });
});
