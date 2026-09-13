import { actionSchema, type BrowserAction } from "../core/actions.js";
import type { ElementObservation } from "../core/observer.js";
import type { Planner, PlannerInput } from "../core/planner.js";
import { parseProjectName } from "../core/planner.js";

export type WebLLMInference = (prompt: string, input: PlannerInput) => Promise<unknown>;

function includesText(haystack: string | undefined, needle: string): boolean {
  return (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
}

function targetFor(observationId: string, element: ElementObservation) {
  return { observationId, elementId: element.id };
}

function bestCreateButton(elements: PlannerInput["observation"]["elements"]) {
  return elements.find((element) => {
    if (element.role !== "button") return false;
    const name = (element.name ?? "").toLowerCase();
    return (
      (name.includes("project") && (name.includes("new") || name.includes("create") || name.includes("add"))) ||
      name === "new project" ||
      name === "create project"
    );
  });
}

function submitButton(elements: PlannerInput["observation"]["elements"]) {
  const exact = elements.find((element) => {
    if (element.role !== "button") return false;
    const name = (element.name ?? "").toLowerCase();
    return name === "create" || name === "submit";
  });
  if (exact) return exact;

  return elements.find((element) => {
    if (element.role !== "button") return false;
    const name = (element.name ?? "").toLowerCase();
    return name.includes("create") && !name.includes("new");
  });
}

function ruleBackedInference(_prompt: string, input: PlannerInput): Promise<unknown> {
  const { observation, history, defaultUrl } = input;
  const projectName = parseProjectName(input.task);
  const lastAction = history.at(-1)?.action as BrowserAction | undefined;

  if ((observation.url === "about:blank" || observation.url === "") && defaultUrl) {
    return Promise.resolve({ type: "goto", url: defaultUrl, reason: "Start by opening the target application.", confidence: 0.92, risk: "write" });
  }

  if (lastAction?.type === "assert" && history.at(-1)?.result.status === "success") {
    return Promise.resolve({
      type: "finish",
      result: "success",
      reason: `Verified that '${projectName}' is visible.`,
      confidence: 0.95,
      risk: "read",
    });
  }

  if (includesText(observation.text, projectName)) {
    return Promise.resolve({
      type: "assert",
      assertion: { type: "textVisible", text: projectName },
      reason: `Project '${projectName}' appears in visible page text.`,
      confidence: 0.9,
      risk: "read",
    });
  }

  const textboxes = observation.elements.filter((e) => e.role === "textbox");
  const projectTextbox = textboxes.find((e) => includesText(e.name, "project") || includesText(e.name, "name") || includesText(e.name, "title"));

  if (projectTextbox && projectTextbox.value !== projectName) {
    return Promise.resolve({
      type: "fill",
      target: targetFor(observation.id, projectTextbox),
      value: projectName,
      reason: "Enter the requested project name.",
      confidence: 0.89,
      risk: "write",
    });
  }

  if (projectTextbox && projectTextbox.value === projectName) {
    const create = submitButton(observation.elements);
    if (create) {
      return Promise.resolve({
        type: "click",
        target: targetFor(observation.id, create),
        reason: "Submit the create project form.",
        confidence: 0.86,
        risk: "write",
      });
    }
  }

  const createButton = bestCreateButton(observation.elements);
  if (createButton) {
    return Promise.resolve({
      type: "click",
      target: targetFor(observation.id, createButton),
      reason: `Use '${createButton.name}' to continue project creation.`,
      confidence: 0.84,
      risk: "write",
    });
  }

  return Promise.resolve({
    type: "blocked",
    reason: 'I could not find a control that safely performs the requested "create project" action.',
    confidence: 0.72,
    risk: "read",
  });
}

function buildPrompt(input: PlannerInput): string {
  return JSON.stringify({
    instruction: "Return exactly one structured BrowserAction as JSON. Reason over observations, never Playwright locators.",
    task: input.task,
    observation: input.observation,
    history: input.history.map((step) => ({ action: step.action, result: step.result })),
    remainingSteps: input.remainingSteps,
    defaultUrl: input.defaultUrl,
  });
}

export class WebLLMPlanner implements Planner {
  readonly provider = "webllm";
  readonly model: string;

  constructor(model = "local-rule-mvp", private readonly infer: WebLLMInference = ruleBackedInference) {
    this.model = model;
  }

  async next(input: PlannerInput): Promise<BrowserAction> {
    const prompt = buildPrompt(input);
    const generated = await this.infer(prompt, input);
    return actionSchema.parse(generated) as BrowserAction;
  }

  async plan(input: Omit<PlannerInput, "history" | "remainingSteps">): Promise<BrowserAction[]> {
    const projectName = parseProjectName(input.task);
    return [
      ...(input.defaultUrl ? [{ type: "goto" as const, url: input.defaultUrl, reason: "Open the target application.", confidence: 0.9, risk: "write" as const }] : []),
      { type: "click" as const, target: { observationId: input.observation.id, elementId: "planned-new-project" }, reason: 'Click "New Project".', confidence: 0.8, risk: "write" as const },
      { type: "fill" as const, target: { observationId: input.observation.id, elementId: "planned-project-name" }, value: projectName, reason: `Fill the project name with "${projectName}".`, confidence: 0.8, risk: "write" as const },
      { type: "click" as const, target: { observationId: input.observation.id, elementId: "planned-create" }, reason: 'Click "Create".', confidence: 0.8, risk: "write" as const },
      { type: "assert" as const, assertion: { type: "textVisible" as const, text: projectName }, reason: `Verify "${projectName}" is visible.`, confidence: 0.8, risk: "read" as const },
    ];
  }
}
