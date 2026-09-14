import { actionSchema, type BrowserAction } from "../core/actions.js";
import type { Planner, PlannerInput } from "../core/planner.js";

export type ExternalProvider = "ollama" | "openai" | "anthropic";

export type ProviderSettings = {
  provider: ExternalProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

const SYSTEM_PROMPT = [
  "You are the Runora browser test planner.",
  "Return exactly one JSON BrowserAction object and no markdown or prose.",
  "Follow the user's task and use only elements from the current observation.",
  "Icon-only controls are represented by their accessible name, aria-label, title, or nested SVG title. Use those semantic names.",
  "When a control opens a dialog or reveals another control, click it first, then inspect the next observation before continuing.",
  "Copy target.observationId and target.elementId exactly.",
  "If the browser is on about:blank and defaultUrl exists, the next action must be goto defaultUrl.",
  "Never return finish until at least one prior action or assertion succeeded and the current observation proves the task is complete.",
  "If history contains a rejected finish, return an assert action that visibly verifies the task instead of finish.",
  "Allowed actions: goto, click, fill, press, select, hover, scroll, wait, extract, assert, finish, blocked.",
  "Every action needs reason, confidence from 0 to 1, and risk (read, write, or destructive).",
].join("\n");

function parseAction(content: string, input: PlannerInput): BrowserAction {
  const normalized = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The provider did not return a JSON browser action.");
  const parsed = JSON.parse(normalized.slice(start, end + 1));
  const envelope = parsed && typeof parsed === "object" && parsed.action && typeof parsed.action === "object"
    ? parsed.action
    : parsed;
  const candidate = envelope && typeof envelope === "object" ? { ...envelope } : envelope;
  if (candidate && typeof candidate === "object" && !candidate.type && typeof parsed.action === "string") {
    candidate.type = parsed.action;
  }
  if (candidate?.type === "navigate") candidate.type = "goto";
  if (["done", "complete", "success"].includes(candidate?.type)) {
    candidate.type = "finish";
    candidate.result ??= "success";
  }
  const targetedTypes = ["click", "fill", "press", "select", "hover", "extract"];
  if (candidate && typeof candidate === "object" && targetedTypes.includes(candidate.type)) {
    const rawTarget = candidate.target;
    const rawElement = typeof rawTarget === "object" && rawTarget
      ? rawTarget.elementId ?? rawTarget.element_id ?? rawTarget.id ?? rawTarget.name
      : rawTarget ?? candidate.elementId ?? candidate.element_id ?? candidate.targetId ?? candidate.target_id ?? candidate.element;
    const requested = typeof rawElement === "string" ? rawElement.trim() : "";
    const direct = input.observation.elements.find((element) => element.id === requested);
    const byName = requested
      ? input.observation.elements.find((element) => element.name?.toLowerCase() === requested.toLowerCase())
        ?? input.observation.elements.find((element) => element.name?.toLowerCase().includes(requested.toLowerCase()))
      : undefined;
    const element = direct ?? byName;
    if (element) candidate.target = { observationId: input.observation.id, elementId: element.id };
    else if (rawTarget && typeof rawTarget === "object" && requested) {
      candidate.target = { observationId: rawTarget.observationId ?? rawTarget.observation_id ?? input.observation.id, elementId: requested };
    }
    if (candidate.type === "fill" && candidate.value === undefined && typeof candidate.text === "string") candidate.value = candidate.text;
  }
  return actionSchema.parse(candidate) as BrowserAction;
}

function initialNavigation(input: PlannerInput): BrowserAction | undefined {
  if (input.observation.url === "about:blank" && input.defaultUrl) {
    return { type: "goto", url: input.defaultUrl, reason: "Navigate to the application before evaluating the task", confidence: 1, risk: "read" };
  }
  return undefined;
}

async function responseError(response: Response): Promise<Error> {
  const detail = await response.text().catch(() => "");
  return new Error(`Provider request failed (${response.status}): ${detail || response.statusText}`);
}

export class ProviderPlanner implements Planner {
  readonly provider: string;

  constructor(private readonly settings: ProviderSettings) {
    this.provider = settings.provider;
  }

  async next(input: PlannerInput): Promise<BrowserAction> {
    const navigation = initialNavigation(input);
    if (navigation) return navigation;
    const compactInput = {
      ...input,
      history: input.history.slice(-8).map((step) => ({ index: step.index, action: step.action, validation: step.validation, result: step.result })),
    };
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(compactInput) },
    ];
    const { provider, model, apiKey } = this.settings;
    if (!model.trim()) throw new Error(`Select a model for ${provider}.`);

    const requestContent = async (): Promise<string> => {
    if (provider === "ollama") {
      const baseUrl = (this.settings.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false, format: "json" }),
      });
      if (!response.ok) throw await responseError(response);
      const body = await response.json() as { message?: { content?: string } };
      return body.message?.content || "";
    }

    if (!apiKey) throw new Error(`Enter an API key for ${provider}.`);

    if (provider === "openai") {
      const baseUrl = (this.settings.baseUrl || "https://api.openai.com").replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: messages }),
      });
      if (!response.ok) throw await responseError(response);
      const body = await response.json() as {
        output_text?: string;
        output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      };
      return body.output_text || body.output?.flatMap((entry) => entry.content || []).find((entry) => entry.type === "output_text")?.text || "";
    }

    const baseUrl = (this.settings.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, system: SYSTEM_PROMPT, messages: [messages[1]], max_tokens: 500, temperature: 0 }),
    });
    if (!response.ok) throw await responseError(response);
    const body = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    return body.content?.find((entry) => entry.type === "text")?.text || "";
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const content = await requestContent();
      try {
        return parseAction(content, input);
      } catch (error) {
        lastError = error;
        messages.push({ role: "user", content: `Your response did not match the BrowserAction schema: ${error instanceof Error ? error.message : String(error)}. For click/fill/select actions, target must be {"observationId":"${input.observation.id}","elementId":"one exact element id from the observation"}. Return only one corrected JSON action.` });
      }
    }
    throw new Error(`The ${provider} model did not return a valid browser action after retrying: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}
