import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
  createHealCandidate,
  acceptHealCandidate,
  listStoredRecords,
  getStoredRecord,
  acquireRunArtifact,
  listRunArtifacts,
  saveSecretProfile,
  listSecretProfiles,
  revealSecretProfile,
  deleteSecretProfile,
  closeWorkspaceStore,
  subscribeWorkspaceChanges,
} from "./index.js";
import type { ResolvedConfig, TestDefinition } from "./index.js";
import type { BrowserAction } from "../core/actions.js";
import type { Planner, PlannerInput } from "../core/planner.js";
import { ProviderPlanner, type ProviderSettings } from "./provider-planner.js";
import { createVisionService, type RecordedAction } from "./vision-service.js";

/**
 * Interactive UI server for Runora Workspace
 * Uses built-in Node http (no Express dependency)
 * Both CLI and UI use the shared runner
 */

let currentConfig: ResolvedConfig;
let currentTests: TestDefinition[] = [];
const WEBLLM_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

// Recording session management
interface RecordingSession {
  id: string;
  url: string;
  startTime: number;
  actions: RecordedAction[];
  visionService?: any;
}

const recordingSessions = new Map<string, RecordingSession>();
const WEBLLM_MODEL_SOURCE = `https://huggingface.co/mlc-ai/${WEBLLM_MODEL}/resolve/main`;
const WEBLLM_LIB_SOURCE = "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm";

function runoraCacheDir(): string {
  if (process.env.RUNORA_CACHE_DIR) return path.join(process.env.RUNORA_CACHE_DIR, "webllm", WEBLLM_MODEL);
  const platformRoot = process.platform === "win32"
    ? process.env.LOCALAPPDATA
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches")
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(platformRoot || os.tmpdir(), "runora", "webllm", WEBLLM_MODEL);
}

async function serveCachedAsset(res: http.ServerResponse, cacheName: string, sourceUrl: string): Promise<void> {
  const cacheDir = runoraCacheDir();
  const target = path.join(cacheDir, cacheName);
  if (fs.existsSync(target)) {
    res.writeHead(200, { "Content-Type": cacheName.endsWith(".json") ? "application/json" : "application/octet-stream", "Content-Length": fs.statSync(target).size });
    fs.createReadStream(target).pipe(res);
    return;
  }
  const upstream = await fetch(sourceUrl);
  if (!upstream.ok) throw new Error(`Model download failed (${upstream.status})`);
  const bytes = Buffer.from(await upstream.arrayBuffer());
  fs.mkdirSync(cacheDir, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
  res.writeHead(200, { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream", "Content-Length": bytes.length });
  res.end(bytes);
}

export async function discoverOllamaModels(baseUrl = "http://127.0.0.1:11434"): Promise<string[]> {
  const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Ollama endpoint must use HTTP or HTTPS");
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const body = await response.json() as { models?: Array<{ name?: string; model?: string }> };
  return [...new Set((body.models || []).map((entry) => entry.name || entry.model).filter((name): name is string => Boolean(name)))];
}

export async function discoverCloudModels(
  provider: "openai" | "anthropic",
  apiKey: string,
  baseUrl?: string,
): Promise<string[]> {
  if (!apiKey) throw new Error(`An API key is required to discover ${provider} models`);
  const root = (baseUrl || (provider === "openai" ? "https://api.openai.com" : "https://api.anthropic.com")).replace(/\/$/, "");
  const headers: Record<string, string> = provider === "openai"
    ? { Authorization: `Bearer ${apiKey}` }
    : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  const response = await fetch(`${root}/v1/models`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${provider} returned ${response.status}`);
  const body = await response.json() as { data?: Array<{ id?: string }> };
  const ids = (body.data || []).map((entry) => entry.id).filter((id): id is string => Boolean(id));
  const usable = provider === "openai"
    ? ids.filter((id) => /^(gpt-|o\d)/i.test(id) && !/(audio|realtime|transcri|image|tts|search|moderation)/i.test(id))
    : ids.filter((id) => /^claude-/i.test(id));
  return [...new Set(usable)].sort((left, right) => right.localeCompare(left));
}

class BrowserPlannerBroker implements Planner {
  readonly provider = "browser-webllm";
  private sequence = 0;
  private requests: Array<{ id: string; input: PlannerInput }> = [];
  private pending = new Map<string, { resolve(action: BrowserAction): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  next(input: PlannerInput): Promise<BrowserAction> {
    const id = `planner-${Date.now()}-${++this.sequence}`;
    this.requests.push({ id, input });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Browser planner did not respond within 10 minutes."));
      }, 600_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  take() {
    return this.requests.shift();
  }

  respond(id: string, action?: BrowserAction, error?: string) {
    const pending = this.pending.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (error) pending.reject(new Error(`Browser WebLLM failed: ${error}`));
    else if (action) pending.resolve(action);
    else pending.reject(new Error("Browser WebLLM returned no action."));
    return true;
  }

  cancelAll(reason = "Test stopped by user.") {
    this.requests = [];
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

const browserPlanner = new BrowserPlannerBroker();
let providerSettings: ProviderSettings | undefined;
let activeRun: AbortController | undefined;

function plannerForRun(config: ResolvedConfig): Planner | undefined {
  if (config.planner === "webllm") return browserPlanner;
  if (["ollama", "openai", "anthropic"].includes(config.planner)) {
    if (!providerSettings || providerSettings.provider !== config.planner) {
      throw new Error(`Configure ${config.planner} in the Planner panel before running tests.`);
    }
    return new ProviderPlanner(providerSettings);
  }
  return undefined;
}

function configForRun(
  headed: string | string[] | undefined,
  planner: string | string[] | undefined,
): ResolvedConfig {
  const allowedPlanners = ["webllm", "ollama", "openai", "anthropic", "deterministic"];
  const selectedPlanner = typeof planner === "string" && allowedPlanners.includes(planner)
    ? planner as ResolvedConfig["planner"]
    : currentConfig.planner;
  return {
    ...currentConfig,
    planner: selectedPlanner,
    model: selectedPlanner === "webllm"
      ? currentConfig.model
      : providerSettings?.provider === selectedPlanner
        ? { provider: providerSettings.provider, model: providerSettings.model }
        : undefined,
    headless: headed === "true" ? false : headed === "false" ? true : currentConfig.headless,
  };
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".json") return "application/json";
  return "application/octet-stream";
}

function resolveEvidenceDirectory(run: any): string | null {
  const directPath = typeof run?.result?.artifactsPath === "string" ? run.result.artifactsPath : null;
  if (directPath && fs.existsSync(directPath)) {
    return directPath;
  }
  const fallback = typeof run?.evidence === "string" ? run.evidence : null;
  if (!fallback || !fs.existsSync(fallback)) {
    return null;
  }
  const entries = fs.readdirSync(fallback, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile())) {
    return fallback;
  }
  const taskDir = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("task-"));
  return taskDir ? path.join(fallback, taskDir.name) : fallback;
}

async function evidenceManifest(run: any, artifactsDir: string) {
  const directory = resolveEvidenceDirectory(run);
  if (!directory || !fs.existsSync(directory)) {
    const stored = await listRunArtifacts(artifactsDir, run.id);
    const screenshots = stored.filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry.relativePath)).map((entry) => ({
      name: entry.relativePath,
      url: `/api/runs/${run.id}/evidence/${encodeURIComponent(entry.relativePath)}`,
    }));
    const traceEntry = stored.find((entry) => entry.relativePath === "trace.json");
    return {
      directory: typeof run?.evidence === "string" ? run.evidence : null,
      screenshots,
      trace: traceEntry ? { name: traceEntry.relativePath, url: `/api/runs/${run.id}/evidence/${encodeURIComponent(traceEntry.relativePath)}` } : null,
    };
  }

  const files = listEvidenceFiles(directory).sort();

  const screenshots = files
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .map((file) => ({
      name: file,
      url: `/api/runs/${run.id}/evidence/${encodeURIComponent(file)}`,
    }));

  const traceFile = files.find((file) => file === "trace.json");

  return {
    directory,
    screenshots,
    trace: traceFile
      ? {
          name: traceFile,
          url: `/api/runs/${run.id}/evidence/${encodeURIComponent(traceFile)}`,
        }
      : null,
  };
}

function resolveEvidenceFile(run: any, fileName: string): string | null {
  const directory = resolveEvidenceDirectory(run);
  if (!directory) {
    return null;
  }
  const resolvedDir = path.resolve(directory);
  const resolvedFile = path.resolve(directory, fileName);
  const relativePath = path.relative(resolvedDir, resolvedFile);
  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    !fs.existsSync(resolvedFile)
  ) {
    return null;
  }
  return resolvedFile;
}

function listEvidenceFiles(directory: string, prefix: string = ""): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = prefix ? path.posix.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        return listEvidenceFiles(path.join(directory, entry.name), relativePath);
      }
      return [relativePath];
    });
}

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

export async function startUIServer(
  workspaceDir: string,
  port: number = 3001,
  options: { announce?: boolean } = {},
): Promise<http.Server> {
  currentConfig = await resolveConfig(workspaceDir);

  const eventClients = new Set<http.ServerResponse>();
  const publishWorkspaceChange = (collection: string) => {
    const message = `event: workspace-change\ndata: ${JSON.stringify({ collection })}\n\n`;
    for (const client of eventClients) client.write(message);
  };
  const unsubscribeWorkspace = subscribeWorkspaceChanges(currentConfig.artifacts, publishWorkspaceChange);

  const server = http.createServer(async (req, res) => {
    // The workspace owns local credentials. Reject cross-origin browser calls
    // so another website cannot operate the vault through localhost.
    const requestOrigin = req.headers.origin;
    if (requestOrigin) {
      let sameOrigin = false;
      try { sameOrigin = new URL(requestOrigin).host === req.headers.host; } catch { /* reject below */ }
      if (!sameOrigin) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cross-origin workspace access is not allowed" }));
        return;
      }
    }
    if (requestOrigin) res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url || "/", true);
    const pathname = parsedUrl.pathname;

    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      eventClients.add(res);
      req.once("close", () => eventClients.delete(res));
      return;
    }

    if (pathname?.startsWith("/api/webllm/model/")) {
      try {
        const requestedAsset = pathname.slice("/api/webllm/model/".length);
        const asset = requestedAsset.startsWith("resolve/main/") ? requestedAsset.slice("resolve/main/".length) : requestedAsset;
        if (!asset || !/^[a-zA-Z0-9._/-]+$/.test(asset) || asset.includes("..")) throw new Error("Invalid model asset path");
        await serveCachedAsset(res, asset.replaceAll("/", "__"), `${WEBLLM_MODEL_SOURCE}/${asset}`);
      } catch (error) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (pathname === "/api/webllm/model-lib") {
      try {
        await serveCachedAsset(res, "model-lib.wasm", WEBLLM_LIB_SOURCE);
      } catch (error) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (pathname === "/api/webllm/cache-status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ready: fs.existsSync(path.join(runoraCacheDir(), ".ready")) }));
      return;
    }

    if (pathname === "/api/webllm/cache-ready" && req.method === "POST") {
      fs.mkdirSync(runoraCacheDir(), { recursive: true });
      fs.writeFileSync(path.join(runoraCacheDir(), ".ready"), new Date().toISOString());
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve UI HTML
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getUIHTML());
      return;
    }

    if (pathname === "/browser-planner.js" && req.method === "GET") {
      const adjacentBundle = new URL("./browser-planner.js", import.meta.url);
      const developmentBundle = path.resolve("dist/packages/workspace/browser-planner.js");
      const bundlePath = fs.existsSync(adjacentBundle) ? adjacentBundle : developmentBundle;
      if (!fs.existsSync(bundlePath)) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Browser planner bundle is missing. Run `npm run build`.");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(fs.readFileSync(bundlePath, "utf-8"));
      return;
    }

    if (pathname === "/api/planner/request" && req.method === "GET") {
      const request = browserPlanner.take();
      res.writeHead(request ? 200 : 204, { "Content-Type": "application/json" });
      res.end(request ? JSON.stringify(request) : undefined);
      return;
    }

    if (pathname === "/api/planner/response" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const accepted = browserPlanner.respond(body.id, body.action, body.error);
        res.writeHead(accepted ? 204 : 404);
        res.end();
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    if (pathname === "/api/planner/settings" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        if (!["ollama", "openai", "anthropic"].includes(body.provider)) throw new Error("Unsupported provider");
        if (typeof body.model !== "string" || !body.model.trim()) throw new Error("Model is required");
        const environmentKey = body.provider === "openai"
          ? process.env.OPENAI_API_KEY
          : body.provider === "anthropic"
            ? process.env.ANTHROPIC_API_KEY
            : undefined;
        const saved = typeof body.secretProfileId === "string" && body.secretProfileId
          ? await revealSecretProfile(currentConfig.artifacts, body.secretProfileId)
          : null;
        if (saved && saved.summary.kind !== body.provider) throw new Error(`Selected vault entry is for ${saved.summary.kind}, not ${body.provider}`);
        providerSettings = {
          provider: body.provider,
          model: body.model.trim(),
          apiKey: saved?.values.apiKey || (typeof body.apiKey === "string" ? body.apiKey.trim() : "") || environmentKey,
          baseUrl: typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined,
        };
        if (body.provider !== "ollama" && !providerSettings.apiKey) {
          const variable = body.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
          throw new Error(`Enter an API key or set ${variable} before starting Runora`);
        }
        res.writeHead(204);
        res.end();
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (pathname === "/api/planner/models" && req.method === "GET") {
      try {
        const requested = typeof parsedUrl.query.baseUrl === "string" ? parsedUrl.query.baseUrl.trim() : "";
        const baseUrl = (requested || "http://127.0.0.1:11434").replace(/\/$/, "");
        const models = await discoverOllamaModels(baseUrl);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models }));
      } catch (error) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: `Could not discover Ollama models. Make sure Ollama is installed and running. ${error instanceof Error ? error.message : String(error)}`,
        }));
      }
      return;
    }

    if (pathname === "/api/planner/models" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        if (!["ollama", "openai", "anthropic"].includes(body.provider)) throw new Error("Unsupported provider");
        const environmentKey = body.provider === "openai" ? process.env.OPENAI_API_KEY : body.provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined;
        const saved = typeof body.secretProfileId === "string" && body.secretProfileId
          ? await revealSecretProfile(currentConfig.artifacts, body.secretProfileId)
          : null;
        if (saved && saved.summary.kind !== body.provider) throw new Error(`Selected vault entry is for ${saved.summary.kind}, not ${body.provider}`);
        const key = saved?.values.apiKey || (typeof body.apiKey === "string" ? body.apiKey.trim() : "") || environmentKey || "";
        const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
        const models = body.provider === "ollama"
          ? await discoverOllamaModels(baseUrl)
          : await discoverCloudModels(body.provider, key, baseUrl);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models }));
      } catch (error) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    // Vault metadata is safe to return; decrypted values never leave this process.
    if (pathname === "/api/secrets" && req.method === "GET") {
      try {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(await listSecretProfiles(currentConfig.artifacts)));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (pathname === "/api/secrets" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        if (!["credentials", "openai", "anthropic"].includes(body.kind)) throw new Error("Unsupported secret profile type");
        const profile = await saveSecretProfile(currentConfig.artifacts, {
          id: typeof body.id === "string" ? body.id : undefined,
          name: body.name,
          kind: body.kind,
          values: body.values && typeof body.values === "object" ? body.values : {},
        });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(profile));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (pathname?.startsWith("/api/secrets/") && req.method === "DELETE") {
      try {
        await deleteSecretProfile(currentConfig.artifacts, decodeURIComponent(pathname.split("/")[3]));
        res.writeHead(204);
        res.end();
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    // API: Get tests
    if (pathname === "/api/tests" && req.method === "GET") {
      try {
        const tests = await discoverTests(currentConfig.tests);
        currentTests = tests;

        const storedRuns = await listStoredRecords<any>(currentConfig.artifacts, "runs");
        const testsWithStatus = tests.map((test) => {
          const latestRun = storedRuns.find((r) => r.testId === test.id);
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
          secretProfileId: body.secretProfileId,
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

    // Recording API: Start a recording session
    if (pathname === "/api/recording/start" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const sessionId = "rec-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);

        const session: RecordingSession = {
          id: sessionId,
          url: body.url,
          startTime: Date.now(),
          actions: [],
        };

        recordingSessions.set(sessionId, session);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          sessionId,
          url: body.url,
          recordingStarted: true,
        }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Recording API: Record action with screenshot
    if (pathname && pathname.startsWith("/api/recording/") && pathname.includes("/record-action") && req.method === "POST") {
      try {
        const sessionId = pathname.split("/")[3];
        const session = recordingSessions.get(sessionId);
        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        const body = await parseJsonBody(req);
        const action: RecordedAction = {
          type: body.type,
          target: body.target,
          value: body.value,
          coordinates: body.coordinates,
          screenshot: body.screenshot, // base64 image data
          timestamp: Date.now(),
        };

        session.actions.push(action);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ recorded: true, actionCount: session.actions.length }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Recording API: Get recorded actions
    if (pathname && pathname.startsWith("/api/recording/") && pathname.includes("/actions") && req.method === "GET") {
      try {
        const sessionId = pathname.split("/")[3];
        const session = recordingSessions.get(sessionId);

        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        // Convert actions to display format
        const displayActions = session.actions.map((action) => {
          let description = "";
          if (action.type === "click") {
            description = `Clicked ${action.target || "element"}`;
          } else if (action.type === "fill") {
            description = `Entered "${action.value}" into ${action.target || "field"}`;
          } else if (action.type === "navigate") {
            description = `Navigated to ${action.value}`;
          } else if (action.type === "screenshot") {
            description = "Captured screenshot";
          } else if (action.type === "wait") {
            description = `Waited ${action.value || "for element"}`;
          } else if (action.type === "scroll") {
            description = `Scrolled ${action.value || "page"}`;
          }
          return { description };
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ actions: displayActions }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Recording API: Stop recording and generate description
    if (pathname && pathname.startsWith("/api/recording/") && pathname.includes("/stop") && req.method === "POST") {
      try {
        const sessionId = pathname.split("/")[3];
        const session = recordingSessions.get(sessionId);

        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        // Generate description using vision service
        let description = "Replay recorded actions";
        try {
          const visionService = createVisionService();
          await visionService.initialize();
          description = await visionService.generateRecordingDescription(session.actions);
          await visionService.close();
        } catch (error) {
          console.error("Vision analysis failed, using fallback:", error);
          // Fallback: use simple description
          const actionTypes = session.actions.map(a => a.type);
          if (actionTypes.includes("navigate")) description = "Navigate and perform recorded actions";
          else if (actionTypes.some(t => t === "click")) description = "Click elements and complete flow";
          else description = "Replay recorded user actions";
        }

        const result = {
          recordingStopped: true,
          actionCount: session.actions.length,
          description,
          duration: Date.now() - session.startTime,
        };

        // Clean up session
        recordingSessions.delete(sessionId);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
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

        const latestRun = (await listStoredRecords<any>(currentConfig.artifacts, "runs")).find((r) => r.testId === test.id);
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
        const runs = (await listStoredRecords<any>(currentConfig.artifacts, "runs"))
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

    // API: Get single run evidence file
    if (pathname && pathname.startsWith("/api/runs/") && req.method === "GET") {
      const evidenceMatch = pathname.match(/^\/api\/runs\/([^/]+)\/evidence\/(.+)$/);
      if (evidenceMatch) {
        try {
          const runId = evidenceMatch[1];
          const fileName = decodeURIComponent(evidenceMatch[2]);
          const run = await getStoredRecord<any>(currentConfig.artifacts, "runs", runId) ?? loadRun(currentConfig.artifacts, runId);
          const filePath = resolveEvidenceFile(run, fileName);
          if (!filePath) {
            const stored = await acquireRunArtifact(currentConfig.artifacts, runId, fileName);
            if (stored) {
              res.writeHead(200, { "Content-Type": stored.contentType, "Content-Length": stored.bytes.byteLength });
              res.end(Buffer.from(stored.bytes));
              return;
            }
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Evidence file not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
          fs.createReadStream(filePath).pipe(res);
        } catch {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Evidence file not found" }));
        }
        return;
      }

      // API: Get single run
      try {
        const runId = pathname.split("/")[3];
        const run = await getStoredRecord<any>(currentConfig.artifacts, "runs", runId) ?? loadRun(currentConfig.artifacts, runId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ...run,
          evidenceFiles: await evidenceManifest(run, currentConfig.artifacts),
        }));
      } catch (error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Run not found" }));
      }
      return;
    }

    // API: Create non-mutating heal candidate from a failed run
    if (pathname && pathname.match(/^\/api\/runs\/[^/]+\/heal$/) && req.method === "POST") {
      try {
        const runId = pathname.split("/")[3];
        const body = await parseJsonBody(req);
        const attempt = createHealCandidate(currentConfig.artifacts, currentConfig.tests, runId, {
          strategy: body.strategy,
          proposedTask: body.proposedTask,
        });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(attempt));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unable to create heal candidate" }));
      }
      return;
    }

    // API: Explicitly accept a verified heal candidate, then rerun deterministically
    if (pathname && pathname.match(/^\/api\/heals\/[^/]+\/accept$/) && req.method === "POST") {
      try {
        const attemptId = pathname.split("/")[3];
        const body = await parseJsonBody(req);
        const attempt = await acceptHealCandidate(currentConfig.artifacts, currentConfig.tests, attemptId, {
          acceptedBy: body.acceptedBy || "workspace-ui",
          verify: (test) => runTest(test, { ...currentConfig, planner: "deterministic", model: undefined }),
        });
        currentTests = await discoverTests(currentConfig.tests);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(attempt));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unable to accept heal candidate" }));
      }
      return;
    }

    // API: Get suite run history
    if (pathname === "/api/suite-runs" && req.method === "GET") {
      try {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify((await listStoredRecords<any>(currentConfig.artifacts, "suite_runs")).sort((a, b) => b.startedAt - a.startedAt)));
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
        const suiteRun = await getStoredRecord<any>(currentConfig.artifacts, "suite_runs", suiteRunId) ?? loadSuiteRun(currentConfig.artifacts, suiteRunId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(suiteRun));
      } catch (error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Suite run not found" }));
      }
      return;
    }

    if (pathname === "/api/runs/stop" && req.method === "POST") {
      const stopped = Boolean(activeRun);
      activeRun?.abort();
      browserPlanner.cancelAll();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ stopped }));
      return;
    }

    // API: Run full suite
    if (pathname === "/api/suite/run" && req.method === "POST") {
      let controller: AbortController | undefined;
      try {
        if (activeRun) throw new Error("A run is already active");
        controller = new AbortController();
        activeRun = controller;
        currentTests = await discoverTests(currentConfig.tests);
        if (currentTests.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No tests found" }));
          return;
        }

        const runConfig = configForRun(parsedUrl.query.headed, parsedUrl.query.planner);
        const suiteRun = await runSuite(currentTests, runConfig, {
          runOne: (test, config) => runTest(test, config, plannerForRun(config), controller?.signal),
          signal: controller.signal,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(suiteRun));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unable to run suite" }));
      } finally {
        if (activeRun === controller) activeRun = undefined;
      }
      return;
    }

    // API: Run test
    if (pathname && pathname.startsWith("/api/tests/") && pathname.endsWith("/run") && req.method === "POST") {
      let controller: AbortController | undefined;
      try {
        if (activeRun) throw new Error("A run is already active");
        controller = new AbortController();
        activeRun = controller;
        const testId = pathname.split("/")[3];
        const test = currentTests.find((t) => t.id === testId);
        if (!test) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Test not found" }));
          return;
        }

        const runConfig = configForRun(parsedUrl.query.headed, parsedUrl.query.planner);
        const result = await runTest(test, runConfig, plannerForRun(runConfig), controller.signal);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      } finally {
        if (activeRun === controller) activeRun = undefined;
      }
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      const actualPort = address && typeof address !== "string" ? address.port : port;
      if (options.announce !== false) {
        console.log(`\n📊 Runora UI`);
        console.log(`   Open: http://localhost:${actualPort}`);
        console.log(`   Workspace: ${workspaceDir}`);
      }
      resolve();
    });
  });

  server.once("close", () => {
    unsubscribeWorkspace();
    for (const client of eventClients) client.end();
    eventClients.clear();
    void closeWorkspaceStore(currentConfig.artifacts);
  });
  return server;
}

function getUIHTML(): string {
  return fs.readFileSync(new URL("./ui.html", import.meta.url), "utf-8");
}
