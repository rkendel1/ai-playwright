import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startUIServer } from "../../packages/workspace/ui-server.js";
import { discoverTests, resolveConfig, runSuite } from "../../packages/workspace/index.js";
import { startCXApp } from "../fixtures/cxApp.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshotDir = path.join(repoRoot, "docs/images/cx");
const updateScreenshots = process.env.AIPW_UPDATE_CX_SCREENSHOTS === "1";
const runCXWorkspace = process.env.AIPW_RUN_CX_WORKSPACE === "1" || updateScreenshots;
const cxWorkspaceTimeoutMs = updateScreenshots ? 300000 : 180000;
const cxWorkspaceTest = runCXWorkspace ? it : it.skip;
const cliEntry = path.join(repoRoot, "packages/cli/index.ts");
const tempRoots: string[] = [];

async function tempDir(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(repoRoot, `.${name}-`));
  tempRoots.push(dir);
  return dir;
}

async function runCLI(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", cliEntry, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function closeServer(server: http.Server | undefined) {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function maybeScreenshot(page: Page, filename: string) {
  if (!updateScreenshots) return;
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
}

function testCard(page: Page, name: string) {
  return page.locator(".test-card").filter({ hasText: name }).first();
}

function detailStatus(page: Page, label: string) {
  return page.locator("#result-content .status-pill").filter({ hasText: label }).first();
}

async function loadSuiteRunsWithRetry(baseUrl: string): Promise<Array<{ id: string }>> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/suite-runs`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        return (await response.json()) as Array<{ id: string }>;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Restarted UI did not expose suite history in time.");
}

function serverBaseUrl(server: http.Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve UI server address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("CX workspace acceptance", () => {
  let browser: Browser | undefined;
  let uiServer: http.Server | undefined;
  let workspaceDir = "";
  let app: Awaited<ReturnType<typeof startCXApp>> | undefined;

  afterEach(async () => {
    await browser?.close();
    browser = undefined;
    await closeServer(uiServer);
    uiServer = undefined;
    await app?.close();
    app = undefined;
    await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  cxWorkspaceTest("proves the canonical workspace journey from init through persistent suite history", async () => {
    workspaceDir = await tempDir("cx-workspace");

    app = await startCXApp({ port: updateScreenshots ? 3000 : undefined });
    const initResult = await runCLI(["init"], workspaceDir);
    expect(initResult.code).toBe(0);
    expect(initResult.stdout).toContain("AI Playwright workspace initialized");

    await fs.writeFile(
      path.join(workspaceDir, "ai-playwright.config.ts"),
      `export default {
  url: "${app.routes.checkout}",
  planner: "deterministic",
  browser: "obscura",
  artifacts: "./artifacts",
  tests: "./tests",
};
`,
      "utf-8"
    );

    uiServer = await startUIServer(workspaceDir, updateScreenshots ? 3001 : 0);
    const uiUrl = serverBaseUrl(uiServer);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });

    await page.goto(uiUrl);
    await page.getByText("No tests yet").waitFor();
    await maybeScreenshot(page, "01-empty-workspace.png");

    await page.getByRole("button", { name: "+ New Test" }).click();
    await page.getByLabel("Name").fill("Checkout");
    await page.getByLabel("URL").fill(app.routes.checkout);
    await page.getByLabel("Task").fill("Test the checkout flow");
    await maybeScreenshot(page, "02-new-test.png");
    await page.getByRole("button", { name: "Create" }).click();
    await testCard(page, "Checkout").waitFor();

    await page.getByRole("button", { name: "+ New Test" }).click();
    await page.getByLabel("Name").fill("Invalid Payment");
    await page.getByLabel("URL").fill(app.routes.invalidPayment);
    await page.getByLabel("Task").fill("Run the invalid payment path");
    await page.getByRole("button", { name: "Create" }).click();
    await testCard(page, "Invalid Payment").waitFor();

    await page.getByRole("button", { name: "+ New Test" }).click();
    await page.getByLabel("Name").fill("Home");
    await page.getByLabel("URL").fill(app.routes.home);
    await page.getByLabel("Task").fill("Verify the home page smoke check");
    await page.getByRole("button", { name: "Create" }).click();
    await testCard(page, "Home").waitFor();
    await maybeScreenshot(page, "03-test-workspace.png");

    await testCard(page, "Checkout").click();
    await page.getByRole("button", { name: "Run Test" }).click();
    await page.getByText("AI Playwright is actively planning and executing this test.").waitFor();
    await maybeScreenshot(page, "04-running.png");
    await detailStatus(page, "PASS").waitFor();
    await maybeScreenshot(page, "05-pass.png");

    await testCard(page, "Invalid Payment").click();
    await page.getByRole("button", { name: "Run Test" }).click();
    await page.getByText("AI Playwright is actively planning and executing this test.").waitFor();
    await detailStatus(page, "FAIL").waitFor({ timeout: 40000 });
    await maybeScreenshot(page, "06-failure.png");
    await page.getByRole("button", { name: /Step 4/ }).click();
    await page.getByText("Step Evidence").waitFor();
    await page.getByText("View details (collapsed)").click();
    await page.getByText("View full evidence (collapsed)").click();
    await maybeScreenshot(page, "07-failure-evidence.png");

    await testCard(page, "Home").click();
    await page.getByRole("button", { name: "Run Test" }).click();
    await detailStatus(page, "PASS").waitFor({ timeout: 15000 });

    const config = await resolveConfig(workspaceDir);
    const tests = await discoverTests(config.tests);
    const passingTests = tests.filter((test) => test.name !== "Invalid Payment");
    const seededPassSuite = await runSuite(passingTests, config);
    expect(seededPassSuite.status).toBe("passed");

    await page.getByRole("button", { name: "Run All Tests" }).click();
    await page.getByText("Suite Execution").waitFor();
    await page.getByText(/^Running…$/).waitFor();
    await maybeScreenshot(page, "08-suite-running.png");
    await detailStatus(page, "FAIL").waitFor({ timeout: 50000 });
    await maybeScreenshot(page, "09-suite-result.png");

    await closeServer(uiServer);
    uiServer = await startUIServer(workspaceDir, updateScreenshots ? 3001 : 0);
    const suiteRuns = await loadSuiteRunsWithRetry(serverBaseUrl(uiServer));
    expect(suiteRuns.length).toBeGreaterThanOrEqual(2);
    await page.goto(serverBaseUrl(uiServer));
    await page.getByText("Failed 1 of last 2 runs").waitFor();
    await page.locator(".suite-run-card").first().click();
    await page.getByText("Suite Result").waitFor();
    if (updateScreenshots) {
      await page.waitForTimeout(500);
      await maybeScreenshot(page, "10-suite-history.png");
    }
  }, cxWorkspaceTimeoutMs);
});
