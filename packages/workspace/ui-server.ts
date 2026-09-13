import fs from "node:fs";
import http from "node:http";
import url from "node:url";
import {
  resolveConfig,
  discoverTests,
  runTest,
  runSuite,
  listRuns,
  loadRun,
  listSuiteRuns,
  loadSuiteRun,
  createTest,
  updateTest,
  deleteTest,
  getTest,
} from "./index.js";
import type { ResolvedConfig, TestDefinition } from "./index.js";

/**
 * Interactive UI server for AI Playwright Workspace
 * Uses built-in Node http (no Express dependency)
 * Both CLI and UI use the shared runner
 */

let currentConfig: ResolvedConfig;
let currentTests: TestDefinition[] = [];

async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export async function startUIServer(workspaceDir: string, port: number = 3001): Promise<http.Server> {
  currentConfig = await resolveConfig(workspaceDir);

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url || "/", true);
    const pathname = parsedUrl.pathname;

    // Serve UI HTML
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getUIHTML());
      return;
    }

    // API: Get tests
    if (pathname === "/api/tests" && req.method === "GET") {
      try {
        const tests = await discoverTests(currentConfig.tests);
        currentTests = tests;

        const testsWithStatus = tests.map((test) => {
          const latestRun = listRuns(currentConfig.artifacts).find((r) => r.testId === test.id);
          return {
            ...test,
            status: latestRun?.status || "new",
            lastRun: latestRun?.finishedAt,
            failure: latestRun?.failure,
            durationMs: latestRun?.durationMs,
            planner: latestRun?.planner || currentConfig.planner,
            model: latestRun?.model || (typeof currentConfig.model === "object" ? currentConfig.model.model : undefined),
            browser: latestRun?.browser || currentConfig.browser,
          };
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(testsWithStatus));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unable to load suite runs" }));
      }
      return;
    }

    // API: Create test
    if (pathname === "/api/tests" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const newTest = createTest(currentConfig.tests, {
          name: body.name || "Untitled",
          task: body.task || "Test task",
          url: body.url,
        });

        // Refresh test list
        currentTests = await discoverTests(currentConfig.tests);

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(newTest));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // API: Get single test
    if (pathname && pathname.startsWith("/api/tests/") && !pathname.includes("/run") && !pathname.includes("/runs") && req.method === "GET") {
      try {
        const testId = pathname.split("/")[3];
        const test = getTest(currentConfig.tests, testId);
        if (!test) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Test not found" }));
          return;
        }

        const latestRun = listRuns(currentConfig.artifacts).find((r) => r.testId === test.id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ...test,
          status: latestRun?.status || "new",
          lastRun: latestRun?.finishedAt,
          failure: latestRun?.failure,
          durationMs: latestRun?.durationMs,
          planner: latestRun?.planner || currentConfig.planner,
          model: latestRun?.model || (typeof currentConfig.model === "object" ? currentConfig.model.model : undefined),
          browser: latestRun?.browser || currentConfig.browser,
        }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unable to load suite runs" }));
      }
      return;
    }

    // API: Update test
    if (pathname && pathname.startsWith("/api/tests/") && !pathname.includes("/run") && !pathname.includes("/runs") && req.method === "PUT") {
      try {
        const testId = pathname.split("/")[3];
        const body = await parseJsonBody(req);
        const updated = updateTest(currentConfig.tests, testId, body);

        // Refresh test list
        currentTests = await discoverTests(currentConfig.tests);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(updated));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // API: Delete test
    if (pathname && pathname.startsWith("/api/tests/") && !pathname.includes("/run") && !pathname.includes("/runs") && req.method === "DELETE") {
      try {
        const testId = pathname.split("/")[3];
        deleteTest(currentConfig.tests, testId);

        // Refresh test list
        currentTests = await discoverTests(currentConfig.tests);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // API: Get run history for test
    if (pathname && pathname.startsWith("/api/tests/") && pathname.endsWith("/runs") && req.method === "GET") {
      try {
        const testId = pathname.split("/")[3];
        const runs = listRuns(currentConfig.artifacts)
          .filter((r) => r.testId === testId)
          .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(runs));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unable to load suite runs" }));
      }
      return;
    }

    // API: Get single run
    if (pathname && pathname.startsWith("/api/runs/") && req.method === "GET") {
      try {
        const runId = pathname.split("/")[3];
        const run = loadRun(currentConfig.artifacts, runId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Run not found" }));
      }
      return;
    }

    // API: Get suite run history
    if (pathname === "/api/suite-runs" && req.method === "GET") {
      try {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(listSuiteRuns(currentConfig.artifacts)));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unable to run suite" }));
      }
      return;
    }

    // API: Get single suite run
    if (pathname && pathname.startsWith("/api/suite-runs/") && req.method === "GET") {
      try {
        const suiteRunId = pathname.split("/")[3];
        const suiteRun = loadSuiteRun(currentConfig.artifacts, suiteRunId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(suiteRun));
      } catch (error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Suite run not found" }));
      }
      return;
    }

    // API: Run full suite
    if (pathname === "/api/suite/run" && req.method === "POST") {
      try {
        currentTests = await discoverTests(currentConfig.tests);
        if (currentTests.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No tests found" }));
          return;
        }

        const suiteRun = await runSuite(currentTests, currentConfig);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(suiteRun));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unable to run suite" }));
      }
      return;
    }

    // API: Run test
    if (pathname && pathname.startsWith("/api/tests/") && pathname.endsWith("/run") && req.method === "POST") {
      try {
        const testId = pathname.split("/")[3];
        const test = currentTests.find((t) => t.id === testId);
        if (!test) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Test not found" }));
          return;
        }

        const result = await runTest(test, currentConfig);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`\n📊 AI Playwright UI`);
      console.log(`   Open: http://127.0.0.1:${port}`);
      console.log(`   Workspace: ${workspaceDir}`);
      resolve();
    });
  });

  return server;
}

function getUIHTML(): string {
  return fs.readFileSync(new URL("./ui.html", import.meta.url), "utf-8");
}
