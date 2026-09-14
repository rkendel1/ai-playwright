import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startUIServer } from "../../packages/workspace/ui-server.js";
import {
  createRun,
  createSuiteRun,
  createTestFile,
  updateRun,
  updateSuiteRun,
} from "../../packages/workspace/index.js";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m2WQAAAABJRU5ErkJggg==",
  "base64"
);

async function closeServer(server: http.Server | undefined) {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function serverBaseUrl(server: http.Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve UI server address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function createWorkspace(): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipw-workspace-ui-"));
  await fs.mkdir(path.join(workspaceDir, "tests"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, "ai-playwright.config.ts"),
    `export default {
  url: "http://127.0.0.1:3000",
  planner: "deterministic",
  browser: "obscura",
  artifacts: "./artifacts",
  tests: "./tests",
};
`,
    "utf-8"
  );
  return workspaceDir;
}

function artifactsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "artifacts");
}

async function seedSuiteRun(
  workspaceDir: string,
  status: "passed" | "failed" | "blocked",
  testName: string,
  offsetMs: number
) {
  const suiteRun = createSuiteRun(artifactsDir(workspaceDir));
  updateSuiteRun(artifactsDir(workspaceDir), suiteRun.id, {
    status,
    tests: [
      {
        testId: testName.toLowerCase().replace(/\s+/g, "-"),
        testName,
        runId: `run-${testName.toLowerCase().replace(/\s+/g, "-")}`,
        status,
        durationMs: 900 + offsetMs,
        planner: "deterministic",
        browser: "obscura",
      },
    ],
  });
  const suitePath = path.join(artifactsDir(workspaceDir), `${suiteRun.id}.json`);
  const raw = JSON.parse(await fs.readFile(suitePath, "utf-8"));
  raw.startedAt -= offsetMs;
  raw.finishedAt -= offsetMs;
  await fs.writeFile(suitePath, JSON.stringify(raw, null, 2), "utf-8");
}

async function seedRunWithArtifacts(options: {
  workspaceDir: string;
  testId: string;
  testName: string;
  status: "passed" | "failed";
  screenshot?: boolean;
  screenshotPath?: string;
  step: any;
  evidence?: any[];
}) {
  const {
    workspaceDir,
    testId,
    testName,
    status,
    screenshot = false,
    screenshotPath = "003-failure.png",
    step,
    evidence = [],
  } = options;
  const { runId } = createRun(
    artifactsDir(workspaceDir),
    testId,
    testName,
    "http://127.0.0.1:3000/checkout",
    "obscura",
    "deterministic"
  );
  const taskDir = path.join(artifactsDir(workspaceDir), runId, "task-001");
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, "trace.json"), JSON.stringify({ steps: [step] }, null, 2), "utf-8");
  if (screenshot) {
    const screenshotFile = path.join(taskDir, screenshotPath);
    await fs.mkdir(path.dirname(screenshotFile), { recursive: true });
    await fs.writeFile(screenshotFile, tinyPng);
  }
  updateRun(artifactsDir(workspaceDir), runId, {
    status,
    result: {
      status,
      steps: [step],
      evidence,
      error: status === "failed" ? { reason: step.result.error } : undefined,
      artifactsPath: taskDir,
      durationMs: 1234,
    },
    durationMs: 1234,
  });
  return runId;
}

function testCard(page: Page, name: string) {
  return page.locator(".test-card").filter({ hasText: name }).first();
}

describe("workspace UI", () => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let uiServer: http.Server | undefined;
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await createWorkspace();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  });

  afterEach(async () => {
    await page?.close();
    await browser?.close();
    await closeServer(uiServer);
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("renders suite empty state, history, and flakiness summary", async () => {
    createTestFile(path.join(workspaceDir, "tests"), "Checkout", "Verify checkout");
    uiServer = await startUIServer(workspaceDir, 0);
    await page!.goto(serverBaseUrl(uiServer));

    await page!.getByText("No suite runs yet").waitFor();
    await page!.getByRole("button", { name: "Run Full Suite" }).waitFor();

    await seedSuiteRun(workspaceDir, "passed", "Checkout", 50_000);
    await seedSuiteRun(workspaceDir, "failed", "Checkout", 40_000);
    await seedSuiteRun(workspaceDir, "passed", "Checkout", 30_000);
    await seedSuiteRun(workspaceDir, "failed", "Checkout", 20_000);
    await seedSuiteRun(workspaceDir, "passed", "Checkout", 10_000);

    await page!.reload();

    await page!.getByText("Failed 2 of last 5 runs").waitFor();
    await page!.locator(".suite-run-card").first().waitFor();
    await page!.getByText(/1 passed · 0 failed · 0 blocked|0 passed · 1 failed · 0 blocked/).first().waitFor();
  });

  it("renders failure screenshots, observation details, and actionable suggestions", async () => {
    createTestFile(path.join(workspaceDir, "tests"), "Invalid Payment", "Verify invalid payment failure");
    await seedRunWithArtifacts({
      workspaceDir,
      testId: "invalid-payment",
      testName: "Invalid Payment",
      status: "failed",
      screenshot: true,
      screenshotPath: "captures/003-failure.png",
      step: {
        index: 4,
        observation: {
          id: "obs-4",
          url: "http://127.0.0.1:3000/checkout",
          title: "Checkout",
          viewport: {
            width: 1280,
            height: 720,
            scrollX: 0,
            scrollY: 0,
            pageWidth: 1280,
            pageHeight: 720,
          },
          elements: [
            {
              id: "submit-payment",
              role: "button",
              name: "Submit payment",
              bounds: { x: 220, y: 320, width: 180, height: 52 },
              state: { visible: true, enabled: true },
            },
            {
              id: "promo-banner",
              role: "button",
              name: "Limited offer banner",
              bounds: { x: 180, y: 300, width: 260, height: 80 },
              state: { visible: true, enabled: true },
            },
          ],
        },
        action: {
          type: "click",
          target: { observationId: "obs-4", elementId: "submit-payment" },
        },
        validation: { status: "success" },
        result: {
          status: "failure",
          error: 'locator.click: element intercepts pointer events from <div class="promo-banner">',
        },
        timestamp: Date.now(),
      },
      evidence: [
        {
          type: "assertion",
          assertion: "payment error message is visible",
          result: "failed",
          detail: "Error message never appeared",
        },
      ],
    });

    uiServer = await startUIServer(workspaceDir, 0);
    await page!.goto(serverBaseUrl(uiServer));

    await testCard(page!, "Invalid Payment").click();
    await page!.locator(".run-history-card").first().waitFor();
    await page!.locator(".run-history-card").first().click();

    await page!.getByText("Suggested Next Steps").waitFor();
    await page!.getByText('Element "Submit payment" was blocked by another page element').first().waitFor();
    await page!.getByRole("img", { name: /Failure evidence/ }).waitFor();
    expect(await page!.locator(".evidence-highlight").count()).toBe(1);
    await page!.locator("#step-observation-details summary").click();
    await page!.getByText("button · Submit payment").waitFor();
    await page!.getByText("Inspect overlapping element").waitFor();
    await page!.getByText("Candidates preserve evidence and do not change the canonical test until accepted").waitFor();
    await page!.getByText("Heal: force click candidate").waitFor();
    await page!.getByText("Heal: actionability wait candidate").click();
    await page!.getByRole("heading", { name: "Heal Candidate", exact: true }).waitFor();
    await page!.getByText("Canonical test").waitFor();
    await page!.getByText("Unchanged").waitFor();
    await page!.getByRole("button", { name: "Accept Fix" }).waitFor();

    const testResponse = await page!.evaluate(async () => {
      const response = await fetch("/api/tests/invalid-payment");
      return response.json();
    });
    expect(testResponse.task).toBe("Verify invalid payment failure");

    await page!.getByRole("button", { name: "View original failure" }).click();
    await page!.getByText("Suggested Next Steps").waitFor();
    await page!.getByText("View full evidence").click();
    await page!.getByRole("link", { name: "captures/003-failure.png" }).waitFor();
    await page!.getByRole("link", { name: "trace.json" }).waitFor();
  });

  it("renders screenshot fallback and keeps pass evidence readable", async () => {
    createTestFile(path.join(workspaceDir, "tests"), "Failure Without Screenshot", "Verify missing screenshot state");
    createTestFile(path.join(workspaceDir, "tests"), "Passing Run", "Verify passing evidence");

    await seedRunWithArtifacts({
      workspaceDir,
      testId: "failure-without-screenshot",
      testName: "Failure Without Screenshot",
      status: "failed",
      step: {
        index: 2,
        observation: {
          id: "obs-2",
          url: "http://127.0.0.1:3000/checkout",
          title: "Checkout",
          elements: [],
        },
        action: { type: "assert", assertion: { type: "textVisible", text: "Payment failed" } },
        validation: { status: "success" },
        result: { status: "failure", error: "Text not found" },
        timestamp: Date.now(),
      },
    });

    await seedRunWithArtifacts({
      workspaceDir,
      testId: "passing-run",
      testName: "Passing Run",
      status: "passed",
      step: {
        index: 1,
        observation: {
          id: "obs-1",
          url: "http://127.0.0.1:3000/home",
          title: "Home",
          elements: [{ id: "ready", role: "button", name: "Ready", state: { visible: true, enabled: true } }],
        },
        action: { type: "assert", assertion: { type: "textVisible", text: "Ready" } },
        validation: { status: "success" },
        result: { status: "success", output: "Ready" },
        timestamp: Date.now(),
      },
      evidence: [
        {
          type: "assertion",
          assertion: "text 'Ready' is visible",
          result: "passed",
          detail: "Ready",
        },
      ],
    });

    uiServer = await startUIServer(workspaceDir, 0);
    await page!.goto(serverBaseUrl(uiServer));

    await testCard(page!, "Failure Without Screenshot").click();
    await page!.locator(".run-history-card").first().click();
    await page!.getByText("No screenshot captured").waitFor();
    await page!.getByText("A screenshot was not available for this failure.").waitFor();

    await testCard(page!, "Passing Run").click();
    await page!.locator(".run-history-card").first().click();
    await page!.getByText("text 'Ready' is visible").waitFor();
    await page!.getByText("None").first().waitFor();
    expect(await page!.getByText("Suggested Next Steps").count()).toBe(0);
  });
});
