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
            planner: latestRun?.planner || currentConfig.planner,
            model: latestRun?.model || (typeof currentConfig.model === "object" ? currentConfig.model.model : undefined),
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
    .suite-run { padding: 8px 0; border-bottom: 1px solid #e0e0e0; cursor: pointer; font-size: 13px; }
    .suite-run:hover { background: #f9f9f9; }
    .suite-test { padding: 10px 0; border-bottom: 1px solid #e0e0e0; cursor: pointer; }
    .suite-test:hover { background: #f9f9f9; }
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
        <div class="section-title">Test Suite</div>
        <button class="run-button" id="run-all-button" style="width: 100%; margin-bottom: 12px;" onclick="runSuite()">
          Run All Tests
        </button>
        <div id="tests-list" class="empty loading">Loading...</div>
        <div class="section">
          <div class="section-title">Suite Runs</div>
          <div id="suite-runs-list" class="empty loading">Loading...</div>
        </div>
      </div>

      <div class="result-panel">
        <div id="result-content" class="empty">Select a test to view details</div>
      </div>
    </div>
  </div>

  <script>
    let tests = [];
    let suiteRuns = [];
    let selectedTest = null;
    let isRunning = false;
    let currentView = 'test'; // 'test', 'run', or 'suite'
    let selectedRun = null;
    let selectedSuiteRun = null;

    async function loadTests() {
      try {
        const response = await fetch('/api/tests');
        tests = await response.json();
        renderTests();
        await loadSuiteRuns();
      } catch (error) {
        document.getElementById('tests-list').innerHTML = '<div class="empty">Error loading tests</div>';
      }
    }

    async function loadSuiteRuns() {
      try {
        const response = await fetch('/api/suite-runs');
        suiteRuns = await response.json();
        renderSuiteRuns();
      } catch (error) {
        document.getElementById('suite-runs-list').innerHTML = '<div class="empty">Error loading suite runs</div>';
      }
    }

    function renderTests() {
      const list = document.getElementById('tests-list');
      if (tests.length === 0) {
        list.innerHTML = '<div class="empty">No tests found</div>';
        return;
      }

      list.innerHTML = \`<div class="test-status">\${tests.length} tests</div>\` +
        '<button class="run-button" style="width: 100%; margin: 12px 0;" onclick="showNewTestForm()">+ New Test</button>' +
        tests.map(test => \`
        <div class="test-item \${selectedTest?.id === test.id ? 'active' : ''} \${test.status}" onclick="selectTest('\${test.id}')">
          <div class="test-name">\${test.name}</div>
          <div class="test-status">\${test.status === 'new' ? 'Never run' : test.status.toUpperCase()}</div>
        </div>
      \`).join('');
    }

    function renderSuiteRuns() {
      const list = document.getElementById('suite-runs-list');
      if (!list) return;
      if (suiteRuns.length === 0) {
        list.innerHTML = '<div class="empty">No suite runs yet</div>';
        return;
      }

      list.innerHTML = suiteRuns.slice(0, 10).map(run => \`
        <div class="suite-run" onclick="selectSuiteRun('\${run.id}')">
          <strong>\${run.status.toUpperCase()}</strong>
          <span style="float: right;">\${run.durationMs ? (run.durationMs / 1000).toFixed(1) + 's' : '?'}</span>
          <div class="test-status">\${run.finishedAt ? new Date(run.finishedAt).toLocaleString() : 'Running'}</div>
        </div>
      \`).join('');
    }

    function selectTest(testId) {
      selectedTest = tests.find(t => t.id === testId);
      currentView = 'test';
      selectedRun = null;
      selectedSuiteRun = null;
      renderTests();
      renderResult();
    }

    function selectSuiteRun(suiteRunId) {
      selectedSuiteRun = suiteRuns.find(run => run.id === suiteRunId);
      selectedTest = null;
      selectedRun = null;
      currentView = 'suite';
      renderTests();
      renderResult();
    }

    function showNewTestForm() {
      const name = prompt('Test name:', '');
      if (!name) return;
      const task = prompt('Test task:', '');
      if (!task === '') return;
      const url = prompt('Test URL (optional):', '');

      createNewTest(name, task, url || undefined);
    }

    async function createNewTest(name, task, url) {
      try {
        const response = await fetch('/api/tests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, task, url }),
        });
        const newTest = await response.json();
        if (response.ok) {
          loadTests();
          selectTest(newTest.id);
        } else {
          alert('Error creating test: ' + newTest.error);
        }
      } catch (error) {
        alert('Error creating test: ' + error);
      }
    }

    async function editTest() {
      if (!selectedTest) return;
      const name = prompt('Test name:', selectedTest.name);
      if (name === null) return;
      const task = prompt('Test task:', selectedTest.task);
      if (task === null) return;
      const url = prompt('Test URL (optional):', selectedTest.url || '');

      try {
        const response = await fetch(\`/api/tests/\${selectedTest.id}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, task, url: url || undefined }),
        });
        if (response.ok) {
          loadTests();
          selectTest(selectedTest.id);
        } else {
          const error = await response.json();
          alert('Error updating test: ' + error.error);
        }
      } catch (error) {
        alert('Error updating test: ' + error);
      }
    }

    async function deleteTestConfirm() {
      if (!selectedTest) return;
      if (!confirm(\`Delete test "\${selectedTest.name}"? This cannot be undone.\`)) return;

      try {
        const response = await fetch(\`/api/tests/\${selectedTest.id}\`, { method: 'DELETE' });
        if (response.ok) {
          selectedTest = null;
          loadTests();
          renderResult();
        } else {
          const error = await response.json();
          alert('Error deleting test: ' + error.error);
        }
      } catch (error) {
        alert('Error deleting test: ' + error);
      }
    }

    async function loadRunHistory() {
      if (!selectedTest) return;
      try {
        const response = await fetch(\`/api/tests/\${selectedTest.id}/runs\`);
        return await response.json();
      } catch (error) {
        return [];
      }
    }

    function renderResult() {
      if (currentView === 'suite' && selectedSuiteRun) {
        renderSuiteDetail();
        return;
      }

      if (!selectedTest) {
        document.getElementById('result-content').innerHTML = '<div class="empty">Select a test to view details</div>';
        return;
      }

      if (currentView === 'run' && selectedRun) {
        renderRunDetail();
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
          <div style="display: flex; gap: 8px;">
            <button class="run-button" \${isRunning ? 'disabled' : ''} onclick="runTest()">
              \${isRunning ? 'Running...' : 'Run'}
            </button>
            <button class="run-button" style="background: #666;" onclick="editTest()">Edit</button>
            <button class="run-button" style="background: #d32f2f;" onclick="deleteTestConfirm()">Delete</button>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Test Info</div>
          <div class="info-row">
            <span class="info-label">ID</span>
            <span class="info-value">\${selectedTest.id}</span>
          </div>
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
          <div class="info-row">
            <span class="info-label">URL</span>
            <span class="info-value">\${selectedTest.url || '(default)'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Planner</span>
            <span class="info-value">\${selectedTest.planner === 'webllm' ? 'WebLLM' : 'Deterministic'}</span>
          </div>
          \${selectedTest.planner === 'webllm' ? \`
          <div class="info-row">
            <span class="info-label">Model</span>
            <span class="info-value">\${selectedTest.model || '(default)'}</span>
          </div>
          \` : ''}
        </div>

        \${failureHtml}

        <div class="section" id="run-history-section"></div>
      \`;

      loadRunHistory().then(runs => {
        const section = document.getElementById('run-history-section');
        if (runs.length === 0) {
          section.innerHTML = '';
          return;
        }
        section.innerHTML = \`
          <div class="section-title">Run History</div>
          \${runs.slice(0, 5).map((run, i) => \`
            <div class="info-row" style="cursor: pointer;" onclick="viewRun('\${run.id}')">
              <span class="info-label">\${i === 0 ? 'Latest' : 'Run ' + (i + 1)}</span>
              <span class="info-value">\${run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : '⊘'} \${new Date(run.finishedAt).toLocaleString()}</span>
            </div>
          \`).join('')}
        \`;
      });
    }

    function statusIcon(status) {
      return status === 'passed' ? '✓' : status === 'failed' ? '✗' : '⊘';
    }

    function plannerLabel(planner) {
      return planner === 'webllm' ? 'WebLLM' : 'Deterministic';
    }

    function renderSuiteDetail() {
      const passed = selectedSuiteRun.tests.filter(test => test.status === 'passed').length;
      const failed = selectedSuiteRun.tests.filter(test => test.status === 'failed').length;
      const blocked = selectedSuiteRun.tests.filter(test => test.status === 'blocked').length;

      document.getElementById('result-content').innerHTML = \`
        <div class="result-header">
          <div>
            <div class="test-name">Test Suite</div>
            <div class="test-status">\${selectedSuiteRun.tests.length} tests · \${selectedSuiteRun.id}</div>
          </div>
          <div class="status-badge \${selectedSuiteRun.status === 'passed' ? 'pass' : selectedSuiteRun.status === 'failed' ? 'fail' : 'blocked'}">
            \${selectedSuiteRun.status.toUpperCase()}
          </div>
        </div>

        <div class="section">
          \${selectedSuiteRun.tests.map(test => \`
            <div class="suite-test" onclick="viewRunById('\${test.runId}')">
              <div class="test-name">\${statusIcon(test.status)} \${test.testName}</div>
              <div class="test-status">
                \${test.status.toUpperCase()} · Planner: \${plannerLabel(test.planner)} · Browser: \${test.browser === 'obscura' ? 'Obscura' : test.browser}
              </div>
            </div>
          \`).join('')}
        </div>

        <div class="section">
          <div class="section-title">Summary</div>
          <div class="info-row"><span class="info-label">Passed</span><span class="info-value">\${passed}</span></div>
          <div class="info-row"><span class="info-label">Failed</span><span class="info-value">\${failed}</span></div>
          <div class="info-row"><span class="info-label">Blocked</span><span class="info-value">\${blocked}</span></div>
          <div class="info-row"><span class="info-label">Result</span><span class="info-value">\${selectedSuiteRun.status.toUpperCase()}</span></div>
        </div>
      \`;
    }

    function renderRunDetail() {
      if (!selectedRun) return;

      const statusEmoji = { passed: '✅', failed: '❌', blocked: '⊘', running: '⏳' }[selectedRun.status] || '◯';
      const durationSec = selectedRun.durationMs ? (selectedRun.durationMs / 1000).toFixed(1) : '?';
      const f = selectedRun.failure;
      const failureHtml = f ? \`
        <div class="section">
          <div class="section-title">Failure Details</div>
          <div class="info-row"><span class="info-label">Phase</span><span class="info-value">\${f.phase}</span></div>
          <div class="info-row"><span class="info-label">Category</span><span class="info-value">\${f.category}</span></div>
          \${f.step !== undefined ? \`<div class="info-row"><span class="info-label">Step</span><span class="info-value">\${f.step}</span></div>\` : ''}
          \${f.action ? \`<div class="info-row"><span class="info-label">Action</span><span class="info-value">\${f.action.description || f.action.type}</span></div>\` : ''}
          <div class="info-row"><span class="info-label">Error</span><span class="info-value error">\${f.message}</span></div>
        </div>
      \` : '';

      document.getElementById('result-content').innerHTML = \`
        <div class="result-header">
          <div>
            <div class="test-name">\${selectedRun.testName}</div>
            <div class="test-status">Run: \${selectedRun.id}</div>
          </div>
          <button class="run-button" style="background: #666;" onclick="selectTest('\${selectedRun.testId}')">Back to Test</button>
        </div>
        <div class="section">
          <div class="section-title">Run Details</div>
          <div class="info-row"><span class="info-label">Status</span><span class="info-value">\${statusEmoji} \${selectedRun.status.toUpperCase()}</span></div>
          <div class="info-row"><span class="info-label">Duration</span><span class="info-value">\${durationSec}s</span></div>
          <div class="info-row"><span class="info-label">Planner</span><span class="info-value">\${plannerLabel(selectedRun.planner)}</span></div>
          <div class="info-row"><span class="info-label">Browser</span><span class="info-value">\${selectedRun.browser === 'obscura' ? 'Obscura' : selectedRun.browser}</span></div>
          <div class="info-row"><span class="info-label">Evidence</span><span class="info-value">\${selectedRun.evidence || '(none)'}</span></div>
        </div>
        \${failureHtml}
      \`;
    }

    async function viewRunById(runId) {
      try {
        const response = await fetch(\`/api/runs/\${runId}\`);
        selectedRun = await response.json();
        if (!response.ok) {
          alert('Error loading run: ' + selectedRun.error);
          return;
        }
        selectedTest = tests.find(test => test.id === selectedRun.testId) || null;
        selectedSuiteRun = null;
        currentView = 'run';
        renderTests();
        renderResult();
      } catch (error) {
        alert('Error loading run: ' + error);
      }
    }

    function viewRun(runId) {
      viewRunById(runId);
    }

    async function runTest() {
      if (!selectedTest || isRunning) return;

      isRunning = true;
      document.querySelectorAll('.run-button').forEach(btn => btn.disabled = true);

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
        document.querySelectorAll('.run-button').forEach(btn => btn.disabled = false);
      }

      async function runSuite() {
        if (isRunning) return;

        isRunning = true;
        document.querySelectorAll('.run-button').forEach(btn => btn.disabled = true);

        try {
          const response = await fetch('/api/suite/run', { method: 'POST' });
          const result = await response.json();
          if (!response.ok) {
            alert('Error running suite: ' + result.error);
            return;
          }

          selectedSuiteRun = result;
          currentView = 'suite';
          selectedTest = null;
          await loadTests();
          await loadSuiteRuns();
          renderResult();
        } catch (error) {
          alert('Error running suite: ' + error);
        } finally {
          isRunning = false;
          document.querySelectorAll('.run-button').forEach(btn => btn.disabled = false);
        }
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
