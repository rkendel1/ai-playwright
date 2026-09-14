import { CreateMLCEngine, type MLCEngineInterface } from "@mlc-ai/web-llm";
import { actionSchema, type BrowserAction } from "../core/actions.js";
import type { Planner, PlannerInput, PlannerTrace } from "../core/planner.js";

export type WebLLMPlannerOptions = {
  model?: string;
  engine?: MLCEngineInterface;
  engineFactory?: (model: string) => Promise<MLCEngineInterface>;
};

const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

function systemPrompt(): string {
  return [
    "You are the Runora planner.",
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
  const browserNavigator = globalThis.navigator as Navigator & { gpu?: unknown };
  if (typeof window === "undefined" || !browserNavigator?.gpu) {
    throw new Error(
      "WebLLM requires the browser workspace. Run `npx runora init`, open its UI, and choose Intelligent (WebLLM).",
    );
  }
  ensureWebLLMRuntimeGlobals();
  return CreateMLCEngine(model);
}

function plannerContractInput(input: PlannerInput): unknown {
  return {
    task: input.task,
    observation: {
      id: input.observation.id,
      url: input.observation.url,
      title: input.observation.title,
      elements: input.observation.elements,
      text: input.observation.text,
    },
  };
}

function userPrompt(input: PlannerInput): string {
  return JSON.stringify(plannerContractInput(input));
}

function parseModelJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`WebLLM returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WebLLMPlannerAdapter implements Planner {
  readonly provider = "webllm";
  readonly model: string;
  private enginePromise?: Promise<MLCEngineInterface>;
  private lastTrace?: PlannerTrace;

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
      throw new Error(`Failed to initialize WebLLM model '${this.model}': ${errorMessage(error)}`);
    });
    return this.enginePromise;
  }

  consumeTrace(): PlannerTrace | undefined {
    const trace = this.lastTrace;
    this.lastTrace = undefined;
    return trace;
  }

  async next(input: PlannerInput): Promise<BrowserAction> {
    const contractInput = plannerContractInput(input);
    this.lastTrace = {
      provider: this.provider,
      model: this.model,
      input: contractInput,
    };

    let engine: MLCEngineInterface;
    try {
      engine = await this.getEngine();
    } catch (error) {
      this.lastTrace = {
        ...this.lastTrace,
        error: errorMessage(error),
      };
      throw error;
    }
    const startedAt = Date.now();
    let completion: Awaited<ReturnType<MLCEngineInterface["chat"]["completions"]["create"]>>;
    try {
      completion = await engine.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: JSON.stringify(contractInput) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 500,
        extra_body: { enable_latency_breakdown: true },
      });
    } catch (error) {
      const message = `WebLLM inference failed: ${errorMessage(error)}`;
      this.lastTrace = {
        ...this.lastTrace,
        inference: { durationMs: Date.now() - startedAt },
        error: message,
      };
      throw new Error(message);
    }

    const content = completion.choices[0]?.message.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      this.lastTrace = {
        ...this.lastTrace,
        rawOutput: content,
        inference: { id: completion.id, durationMs: Date.now() - startedAt },
        error: "WebLLM returned an empty BrowserAction response.",
      };
      throw new Error("WebLLM returned an empty BrowserAction response.");
    }
    try {
      const parsedAction = actionSchema.parse(parseModelJson(content)) as BrowserAction;
      const usage = completion.usage;
      this.lastTrace = {
        ...this.lastTrace,
        rawOutput: content,
        parsedAction,
        inference: {
          id: completion.id,
          durationMs: Date.now() - startedAt,
          inputTokens: usage?.prompt_tokens,
          outputTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
        },
      };
      return parsedAction;
    } catch (error) {
      const message = errorMessage(error);
      this.lastTrace = {
        ...this.lastTrace,
        rawOutput: content,
        inference: { id: completion.id, durationMs: Date.now() - startedAt },
        error: message,
      };
      throw error;
    }
  }
}

export class WebLLMPlanner extends WebLLMPlannerAdapter {}
