import {
  CreateMLCEngine,
  hasModelInCache,
  prebuiltAppConfig,
  type InitProgressReport,
  type MLCEngineInterface,
  type ModelRecord,
} from "@mlc-ai/web-llm";

const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
let enginePromise: Promise<MLCEngineInterface> | undefined;
let sharedCacheReady = false;

const runoraAppConfig = {
  ...prebuiltAppConfig,
  cacheBackend: "cache" as const,
  model_list: prebuiltAppConfig.model_list.map((record: ModelRecord) => record.model_id === DEFAULT_MODEL
    ? { ...record, model: `${location.origin}/api/webllm/model`, model_lib: `${location.origin}/api/webllm/model-lib` }
    : record),
};

function report(message: string, ready = false) {
  window.dispatchEvent(new CustomEvent("runora:model-status", { detail: { message, ready } }));
}

function engine(): Promise<MLCEngineInterface> {
  enginePromise ??= (async () => {
    await navigator.storage?.persist?.().catch(() => false);
    const cached = await hasModelInCache(DEFAULT_MODEL, runoraAppConfig).catch(() => false);
    sharedCacheReady = await fetch("/api/webllm/cache-status").then((response) => response.json()).then((status) => Boolean(status.ready)).catch(() => false);
    report(cached || sharedCacheReady ? "Restoring intelligent planner from persistent Runora cache…" : "Downloading intelligent planner once…");
    return CreateMLCEngine(DEFAULT_MODEL, {
      appConfig: runoraAppConfig,
      initProgressCallback(progress: InitProgressReport) {
        report(sharedCacheReady ? `Restoring cached planner: ${Math.round(progress.progress * 100)}%` : (progress.text || `Loading model: ${Math.round(progress.progress * 100)}%`));
      },
    });
  })().then((loaded: MLCEngineInterface) => {
    void fetch("/api/webllm/cache-ready", { method: "POST" });
    report("Intelligent planner ready (cached in this browser)", true);
    return loaded;
  }).catch((error: unknown) => {
    enginePromise = undefined;
    report(`Model unavailable: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  });
  return enginePromise!;
}

const SYSTEM_PROMPT = [
  "You are the Runora browser test planner.",
  "Return exactly one JSON BrowserAction object and no markdown or prose.",
  "Follow the user's task. Select only elements from the current observation.",
  "Icon-only controls are represented by their accessible name, aria-label, title, or nested SVG title. Use those semantic names.",
  "When a control opens a dialog or reveals another control, click it first, then inspect the next observation before continuing.",
  "Use target.observationId and target.elementId exactly as supplied.",
  "If the browser is on about:blank and defaultUrl exists, return goto defaultUrl. Do not finish on about:blank.",
  "Never return finish until a prior action or assertion succeeded and the current observation proves the task is complete.",
  "If history contains a rejected finish, return an assert action that visibly verifies the task instead of finish.",
  "Allowed action types: goto, click, fill, press, select, assert, finish, blocked.",
  "Every action needs reason, confidence from 0 to 1, and risk (read or write).",
  'Example when complete: {"type":"finish","result":"success","reason":"The requested result is visible","confidence":0.95,"risk":"read"}',
  'Example click: {"type":"click","target":{"observationId":"obs-1","elementId":"e2"},"reason":"Continue the task","confidence":0.9,"risk":"write"}',
].join("\n");

function parseAction(content: string): unknown {
  const normalized = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = normalized.indexOf("{");
  if (start < 0) throw new Error("response contained no JSON object");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return JSON.parse(normalized.slice(start, index + 1));
  }
  throw new Error("response contained incomplete JSON");
}

async function answer(request: { id: string; input: unknown }) {
  try {
    const plannerInput = request.input as { observation?: { url?: string }; defaultUrl?: string };
    if (plannerInput.observation?.url === "about:blank" && plannerInput.defaultUrl) {
      await fetch("/api/planner/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, action: { type: "goto", url: plannerInput.defaultUrl, reason: "Navigate to the application before evaluating the task", confidence: 1, risk: "read" } }),
      });
      return;
    }
    const model = await engine();
    const fullInput = request.input as { history?: Array<Record<string, unknown>> };
    const compactInput = {
      ...fullInput,
      history: (fullInput.history || []).slice(-8).map((step) => ({
        index: step.index,
        action: step.action,
        validation: step.validation,
        result: step.result,
      })),
    };
    const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(compactInput) },
      ] as Array<{ role: "system" | "user" | "assistant"; content: string }>;
    let action: unknown;
    let lastContent = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const completion = await model.chat.completions.create({ messages, temperature: 0, max_tokens: 500 });
      lastContent = completion.choices[0]?.message.content || "";
      try {
        action = parseAction(lastContent);
        break;
      } catch (error) {
        if (attempt === 1) {
          const preview = lastContent.trim().slice(0, 240) || "(empty response)";
          throw new Error(`WebLLM did not return a valid JSON action after retrying. Model response: ${preview}`);
        }
        messages.push({ role: "user", content: `Do not repeat the task or observation. The previous response was invalid (${error instanceof Error ? error.message : String(error)}). Return only one complete JSON BrowserAction object now, beginning with {\"type\":.` });
      }
    }
    await fetch("/api/planner/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: request.id, action }),
    });
  } catch (error) {
    await fetch("/api/planner/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : String(error) }),
    });
  }
}

const plannerEvents = new EventSource("/api/events");
let claimingRequest = false;

async function claimPlannerRequest() {
  if (claimingRequest) return;
  claimingRequest = true;
  try {
    const response = await fetch("/api/planner/request");
    if (response.ok && response.status !== 204) await answer(await response.json());
  } catch {
    // EventSource reconnects automatically when the local UI server restarts.
  } finally {
    claimingRequest = false;
  }
}

plannerEvents.addEventListener("planner-request", () => void claimPlannerRequest());

Object.assign(window, {
  runoraEnsureModel: async () => {
    report("Downloading intelligent planner…");
    await engine();
  },
});
void hasModelInCache(DEFAULT_MODEL, runoraAppConfig)
  .then((cached: boolean) => report(cached
    ? "Intelligent planner cached; it will load without downloading."
    : "Intelligent planner downloads once in this browser on first run."))
  .catch(() => report("Intelligent planner downloads once in this browser on first run."));
