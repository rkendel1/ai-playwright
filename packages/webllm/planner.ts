import type { BrowserAction } from "../core/actions.js";
import type { Planner, PlannerInput } from "../core/planner.js";
import { parseProjectName } from "../core/planner.js";

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function bestCreateButton(elements: PlannerInput["observation"]["elements"]) {
  return elements.find((element) => {
    if (element.role !== "button") return false;
    const name = element.name.toLowerCase();
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
    const name = element.name.toLowerCase();
    return name === "create" || name === "submit";
  });
  if (exact) return exact;

  return elements.find((element) => {
    if (element.role !== "button") return false;
    const name = element.name.toLowerCase();
    return name.includes("create") && !name.includes("new");
  });
}

export class WebLLMPlanner implements Planner {
  readonly provider = "webllm";
  readonly model: string;

  constructor(model = "local-rule-mvp") {
    this.model = model;
  }

  async next(input: PlannerInput): Promise<BrowserAction> {
    const { observation, history, defaultUrl } = input;
    const projectName = parseProjectName(input.task);
    const lastAction = history.at(-1)?.action as BrowserAction | undefined;

    if ((observation.url === "about:blank" || observation.url === "") && defaultUrl) {
      return { type: "goto", url: defaultUrl, reason: "Start by opening the target application." };
    }

    if (lastAction?.type === "assert" && history.at(-1)?.result.status === "success") {
      return {
        type: "finish",
        result: "success",
        reason: `Verified that '${projectName}' is visible.`,
      };
    }

    if (includesText(observation.text, projectName)) {
      return {
        type: "assert",
        assertion: { type: "textVisible", text: projectName },
        reason: `Project '${projectName}' appears in visible page text.`,
      };
    }

    const textboxes = observation.elements.filter((e) => e.role === "textbox");
    const projectTextbox = textboxes.find((e) => includesText(e.name, "project") || includesText(e.name, "name"));

    if (projectTextbox && projectTextbox.value !== projectName) {
      return {
        type: "fill",
        target: { id: projectTextbox.id },
        value: projectName,
        reason: "Enter the requested project name.",
      };
    }

    if (projectTextbox && projectTextbox.value === projectName) {
      const create = submitButton(observation.elements);
      if (create) {
        return {
          type: "click",
          target: { id: create.id },
          reason: "Submit the create project form.",
        };
      }
    }

    const createButton = bestCreateButton(observation.elements);
    if (createButton) {
      return {
        type: "click",
        target: { id: createButton.id },
        reason: `Use '${createButton.name}' to continue project creation.`,
      };
    }

    return {
      type: "blocked",
      reason: 'I could not find a control that safely performs the requested "create project" action.',
    };
  }
}
