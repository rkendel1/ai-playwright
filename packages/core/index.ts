import path from "node:path";
import { PlaywrightExecutor } from "./executor.js";
import type { TaskResult } from "./evidence.js";
import { runTask } from "./task.js";
import type { Planner } from "./planner.js";
import { MockPlanner } from "./mockPlanner.js";
import { WebLLMPlannerAdapter } from "../webllm/planner.js";
import type { BrowserRuntime } from "./runtime.js";
import { ObscuraRuntime } from "../obscura/runtime.js";
import type { Page } from "playwright";

export type PlannerMode = "webllm" | "ollama" | "openai" | "anthropic" | "deterministic" | "mock";

export type AiPlaywrightOptions = {
  browser?: "obscura";
  model?: "webllm" | { provider: "webllm"; model: string };
  planner?: PlannerMode | Planner;
  url?: string;
  headless?: boolean;
  limits?: {
    maxSteps?: number;
    maxTimeMs?: number;
  };
  artifactsDir?: string;
  runtime?: BrowserRuntime;
  signal?: AbortSignal;
  secrets?: Record<string, string>;
};

export type AiPlaywrightBrowser = {
  task(instruction: string): Promise<TaskResult>;
  page(): Promise<Page>;
  close(): Promise<void>;
};

function modelName(modelOption: AiPlaywrightOptions["model"]): string | undefined {
  if (!modelOption || modelOption === "webllm") return undefined;
  return modelOption.model;
}

function createPlanner(options: AiPlaywrightOptions): Planner {
  if (typeof options.planner === "object") return options.planner;
  const mode = options.planner ?? "webllm";
  if (mode === "deterministic" || mode === "mock") return new MockPlanner();
  if (mode === "webllm") return new WebLLMPlannerAdapter({ model: modelName(options.model) });
  throw new Error(`Unsupported planner '${mode}'.`);
}

export async function aiPlaywright(options: AiPlaywrightOptions = {}): Promise<AiPlaywrightBrowser> {
  const runtime = options.runtime ?? (() => {
    const browser = options.browser ?? "obscura";
    if (browser === "obscura") {
      return new ObscuraRuntime(options.headless ?? true);
    }
    throw new Error(`Unsupported browser runtime '${browser}'.`);
  })();
  const planner = createPlanner(options);
  const executor = new PlaywrightExecutor();
  const launched = await runtime.launch();

  let taskCounter = 0;
  let taskQueue: Promise<unknown> = Promise.resolve();

  return {
    async task(instruction: string): Promise<TaskResult> {
      const run = async () => {
        taskCounter += 1;
        return runTask({
          planner,
          executor,
          page: launched.page,
          task: instruction,
          limits: {
            maxSteps: options.limits?.maxSteps ?? 30,
            maxTimeMs: options.limits?.maxTimeMs ?? 60_000,
          },
          defaultUrl: options.url,
          artifactsRoot: options.artifactsDir ?? path.resolve(".artifacts"),
          taskId: `task-${String(taskCounter).padStart(3, "0")}`,
          signal: options.signal,
          secrets: options.secrets,
        });
      };

      const resultPromise = taskQueue.then(run, run);
      taskQueue = resultPromise.then(() => undefined, () => undefined);
      return resultPromise;
    },
    async page(): Promise<Page> {
      return launched.page;
    },
    async close(): Promise<void> {
      await runtime.close();
    },
  };
}

export type { TaskResult } from "./evidence.js";
export type { BrowserAction } from "./actions.js";
export { MockPlanner } from "./mockPlanner.js";
export { WebLLMPlanner, WebLLMPlannerAdapter } from "../webllm/planner.js";
