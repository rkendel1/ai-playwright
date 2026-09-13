import { CreateMLCEngine, type MLCEngineInterface } from "@mlc-ai/web-llm";
import { actionSchema, type BrowserAction } from "../core/actions.js";
import type { Planner, PlannerInput } from "../core/planner.js";

export type WebLLMPlannerOptions = {
  model?: string;
  engine?: MLCEngineInterface;
  engineFactory?: (model: string) => Promise<MLCEngineInterface>;
};

const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

function systemPrompt(): string {
  return [
    "You are the AI Playwright planner.",
    "Return exactly one JSON object matching the BrowserAction protocol.",
    "Do not return markdown, prose, JavaScript, Playwright locators, or multiple actions.",
    "Reason only over the supplied Observation. Use target.observationId and target.elementId from the Observation elements.",
    "Allowed actions:",
    '{"type":"goto","url":"https://example.test","reason":"...","confidence":0.8,"risk":"write"}',
    '{"type":"click","target":{"observationId":"obs-1","elementId":"e1"},"reason":"...","confidence":0.8,"risk":"write"}',
    '{"type":"fill","target":{"observationId":"obs-1","elementId":"e2"},"value":"text","reason":"...","confidence":0.8,"risk":"write"}',
    '{"type":"press","target":{"observationId":"obs-1","elementId":"e2"},"key":"Enter","reason":"...","confidence":0.8,"risk":"write"}',
    '{"type":"select","target":{"observationId":"obs-1","elementId":"e3"},"value":"option","reason":"...","confidence":0.8,"risk":"write"}',
    '{"type":"assert","assertion":{"type":"textVisible","text":"Demo"},"reason":"...","confidence":0.8,"risk":"read"}',
    '{"type":"finish","result":"success","reason":"...","confidence":0.8,"risk":"read"}',
    '{"type":"blocked","reason":"...","confidence":0.8,"risk":"read"}',
  ].join("\n");
}

function ensureWebLLMRuntimeGlobals() {
  const globalObject = globalThis as typeof globalThis & {
    caches?: CacheStorage;
    location?: Location;
  };
  if (!globalObject.location) {
    globalObject.location = new URL("http://localhost") as unknown as Location;
  }
  if (!globalObject.caches) {
    const stores = new Map<string, Map<string, Response>>();
    globalObject.caches = {
      async open(name: string) {
        let store = stores.get(name);
        if (!store) {
          store = new Map<string, Response>();
          stores.set(name, store);
        }
        return {
          async match(request: RequestInfo | URL) {
            const response = store.get(new Request(request).url);
            return response?.clone();
          },
          async put(request: RequestInfo | URL, response: Response) {
            store.set(new Request(request).url, response.clone());
          },
          async add(request: RequestInfo | URL) {
            const normalized = new Request(request);
            const response = await fetch(normalized);
            store.set(normalized.url, response.clone());
          },
          async addAll(requests: RequestInfo[] | URL[]) {
            await Promise.all(requests.map((request) => this.add(request)));
          },
          async keys() {
            return Array.from(store.keys()).map((url) => new Request(url));
          },
          async matchAll(request?: RequestInfo | URL) {
            if (request) {
              const response = store.get(new Request(request).url);
              return response ? [response.clone()] : [];
            }
            return Array.from(store.values()).map((response) => response.clone());
          },
          async delete(request: RequestInfo | URL) {
            return store.delete(new Request(request).url);
          },
        } as Cache;
      },
    } as CacheStorage;
  }
}

async function createDefaultEngine(model: string): Promise<MLCEngineInterface> {
  ensureWebLLMRuntimeGlobals();
  return CreateMLCEngine(model);
}

function userPrompt(input: PlannerInput): string {
  return JSON.stringify({
    task: input.task,
    currentObservation: input.observation,
    history: input.history.map((step) => ({
      action: step.action,
      validation: step.validation,
      result: step.result,
    })),
    remainingSteps: input.remainingSteps,
    defaultUrl: input.defaultUrl,
  });
}

function parseModelJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`WebLLM returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export class WebLLMPlanner implements Planner {
  readonly provider = "webllm";
  readonly model: string;
  private enginePromise?: Promise<MLCEngineInterface>;

  constructor(options: WebLLMPlannerOptions | string = {}) {
    if (typeof options === "string") {
      this.model = options;
      this.engineFactory = createDefaultEngine;
      return;
    }
    this.model = options.model ?? process.env.AIPW_WEBLLM_MODEL ?? DEFAULT_MODEL;
    this.engine = options.engine;
    this.engineFactory = options.engineFactory ?? createDefaultEngine;
  }

  private readonly engine?: MLCEngineInterface;
  private readonly engineFactory: (model: string) => Promise<MLCEngineInterface>;

  private async getEngine(): Promise<MLCEngineInterface> {
    if (this.engine) return this.engine;
    this.enginePromise ??= this.engineFactory(this.model).catch((error) => {
      throw new Error(`Failed to initialize WebLLM model '${this.model}': ${error instanceof Error ? error.message : String(error)}`);
    });
    return this.enginePromise;
  }

  async next(input: PlannerInput): Promise<BrowserAction> {
    const engine = await this.getEngine();
    const completion = await engine.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: userPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 500,
      extra_body: { enable_latency_breakdown: true },
    });
    const content = completion.choices[0]?.message.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("WebLLM returned an empty BrowserAction response.");
    }
    return actionSchema.parse(parseModelJson(content)) as BrowserAction;
  }
}
