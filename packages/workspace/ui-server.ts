import http from "node:http";
import url from "node:url";
import { resolveConfig, discoverTests, runTest, listRuns, loadRun } from "./index.js";
import type { ResolvedConfig, TestDefinition } from "./index.js";

/**
 * Interactive UI server for AI Playwright Workspace
 * Uses built-in Node http (no Express dependency)
 * Both CLI and UI use the shared runner
 */

let currentConfig: ResolvedConfig;
let currentTests: TestDefinition[] = [];

export async function startUIServer(workspaceDir: string, port: number = 3001): Promise<void> {
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
          };
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(testsWithStatus));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
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

  server.listen(port, () => {
    console.log(`\n📊 AI Playwright UI`);
    console.log(`   Open: http://127.0.0.1:${port}`);
    console.log(`   Workspace: ${workspaceDir}`);
  });
}

function getUIHTML(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Playwright</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { padding: 20px 0; border-bottom: 1px solid #e0e0e0; margin-bottom: 20px; }
    .header h1 { font-size: 24px; color: #333; }
    .content { display: grid; grid-template-columns: 300px 1fr; gap: 20px; }
    .tests-panel { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .test-item { padding: 12px; margin: 8px 0; border-radius: 4px; cursor: pointer; border-left: 3px solid #ddd; transition: all 0.2s; }
    .test-item:hover { background: #f9f9f9; }
    .test-item.active { background: #e3f2fd; border-left-color: #2196F3; }
    .test-item.pass { border-left-color: #4CAF50; }
    .test-item.fail { border-left-color: #f44336; }
    .test-item.blocked { border-left-color: #ff9800; }
    .test-name { font-weight: 500; color: #333; }
    .test-status { font-size: 12px; color: #999; margin-top: 4px; }
    .result-panel { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #e0e0e0; }
    .status-badge { font-size: 32px; font-weight: bold; }
    .status-badge.pass { color: #4CAF50; }
    .status-badge.fail { color: #f44336; }
    .status-badge.blocked { color: #ff9800; }
    .run-button { background: #2196F3; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .run-button:hover { background: #1976D2; }
    .run-button:disabled { background: #ccc; cursor: not-allowed; }
    .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
    .info-label { color: #666; font-weight: 500; }
    .info-value { color: #333; }
    .info-value.error { color: #d32f2f; font-family: monospace; font-size: 12px; word-break: break-word; }
    .section { margin-top: 30px; }
    .section-title { font-size: 16px; font-weight: 600; color: #333; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #2196F3; }
    .empty { color: #999; text-align: center; padding: 40px 20px; }
    .loading { color: #2196F3; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 AI Playwright</h1>
    </div>

    <div class="content">
      <div class="tests-panel">
        <div class="section-title">Tests</div>
        <div id="tests-list" class="empty loading">Loading...</div>
      </div>

      <div class="result-panel">
        <div id="result-content" class="empty">Select a test to view details</div>
      </div>
    </div>
  </div>

  <script>
    let tests = [];
    let selectedTest = null;
    let isRunning = false;

    async function loadTests() {
      try {
        const response = await fetch('/api/tests');
        tests = await response.json();
        renderTests();
      } catch (error) {
        document.getElementById('tests-list').innerHTML = '<div class="empty">Error loading tests</div>';
      }
    }

    function renderTests() {
      const list = document.getElementById('tests-list');
      if (tests.length === 0) {
        list.innerHTML = '<div class="empty">No tests found</div>';
        return;
      }

      list.innerHTML = tests.map(test => \`
        <div class="test-item \${selectedTest?.id === test.id ? 'active' : ''} \${test.status}" onclick="selectTest('\${test.id}')">
          <div class="test-name">\${test.name}</div>
          <div class="test-status">\${test.status === 'new' ? 'Never run' : test.status.toUpperCase()}</div>
        </div>
      \`).join('');
    }

    function selectTest(testId) {
      selectedTest = tests.find(t => t.id === testId);
      renderTests();
      renderResult();
    }

    function renderResult() {
      if (!selectedTest) {
        document.getElementById('result-content').innerHTML = '<div class="empty">Select a test to view details</div>';
        return;
      }

      const statusEmoji = { pass: '✅', fail: '❌', blocked: '⊘', new: '⏳' }[selectedTest.status] || '◯';
      const durationSec = selectedTest.durationMs ? (selectedTest.durationMs / 1000).toFixed(1) : '?';

      let failureHtml = '';
      if (selectedTest.failure) {
        const f = selectedTest.failure;
        failureHtml = \`
          <div class="section">
            <div class="section-title">Failure Details</div>
            <div class="info-row">
              <span class="info-label">Phase</span>
              <span class="info-value">\${f.phase}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Category</span>
              <span class="info-value">\${f.category}</span>
            </div>
            \${f.step !== undefined ? \`
            <div class="info-row">
              <span class="info-label">Step</span>
              <span class="info-value">\${f.step}</span>
            </div>
            \` : ''}
            \${f.action ? \`
            <div class="info-row">
              <span class="info-label">Action</span>
              <span class="info-value">\${f.action.description || f.action.type}</span>
            </div>
            \` : ''}
            \${f.observation?.url ? \`
            <div class="info-row">
              <span class="info-label">URL</span>
              <span class="info-value">\${f.observation.url}</span>
            </div>
            \` : ''}
            \${f.observation?.elementCount !== undefined ? \`
            <div class="info-row">
              <span class="info-label">Elements</span>
              <span class="info-value">\${f.observation.elementCount} visible</span>
            </div>
            \` : ''}
            <div class="info-row">
              <span class="info-label">Error</span>
              <span class="info-value error">\${f.message}</span>
            </div>
          </div>
        \`;
      }

      document.getElementById('result-content').innerHTML = \`
        <div class="result-header">
          <div>
            <div class="test-name">\${selectedTest.name}</div>
            <div class="test-status">Task: \${selectedTest.task}</div>
          </div>
          <button class="run-button" \${isRunning ? 'disabled' : ''} onclick="runTest()">
            \${isRunning ? 'Running...' : 'Run Test'}
          </button>
        </div>

        <div class="section">
          <div class="section-title">Test Info</div>
          <div class="info-row">
            <span class="info-label">Status</span>
            <span class="info-value">\${statusEmoji} \${selectedTest.status.toUpperCase()}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Duration</span>
            <span class="info-value">\${durationSec}s</span>
          </div>
          <div class="info-row">
            <span class="info-label">Last Run</span>
            <span class="info-value">\${selectedTest.lastRun ? new Date(selectedTest.lastRun).toLocaleString() : 'Never'}</span>
          </div>
        </div>

        \${failureHtml}
      \`;
    }

    async function runTest() {
      if (!selectedTest || isRunning) return;

      isRunning = true;
      document.querySelector('.run-button').disabled = true;

      try {
        const response = await fetch(\`/api/tests/\${selectedTest.id}/run\`, { method: 'POST' });
        const result = await response.json();

        // Update test status
        selectedTest.status = result.status;
        selectedTest.lastRun = Date.now();

        loadTests();
        renderResult();
      } catch (error) {
        alert('Error running test: ' + error);
      } finally {
        isRunning = false;
      }
    }

    // Load tests on page load
    loadTests();
    setInterval(loadTests, 5000); // Refresh every 5s
  </script>
</body>
</html>
  `;
}
