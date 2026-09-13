import type { BrowserAction } from "./actions.js";
import type { ElementObservation } from "./observer.js";
import type { Planner, PlannerInput } from "./planner.js";
import { parseProjectName } from "./planner.js";

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

export class MockPlanner implements Planner {
  readonly provider = "mock";

  async next(input: PlannerInput): Promise<BrowserAction> {
    const { observation, history, defaultUrl } = input;
    const projectName = parseProjectName(input.task);
    const lastAction = history.at(-1)?.action as BrowserAction | undefined;

    if ((observation.url === "about:blank" || observation.url === "") && defaultUrl) {
      return { type: "goto", url: defaultUrl, reason: "Start by opening the target application.", confidence: 0.92, risk: "write" };
    }

    if (lastAction?.type === "assert" && history.at(-1)?.result.status === "success") {
      return {
        type: "finish",
        result: "success",
        reason: `Verified that '${projectName}' is visible.`,
        confidence: 0.95,
        risk: "read",
      };
    }

    if (includesText(observation.text, projectName)) {
      return {
        type: "assert",
        assertion: { type: "textVisible", text: projectName },
        reason: `Project '${projectName}' appears in visible page text.`,
        confidence: 0.9,
        risk: "read",
      };
    }

    const textboxes = observation.elements.filter((e) => e.role === "textbox");
    const projectTextbox = textboxes.find((e) => includesText(e.name, "project") || includesText(e.name, "name") || includesText(e.name, "title"));

    if (projectTextbox && projectTextbox.value !== projectName) {
      return {
        type: "fill",
        target: targetFor(observation.id, projectTextbox),
        value: projectName,
        reason: "Enter the requested project name.",
        confidence: 0.89,
        risk: "write",
      };
    }

    if (projectTextbox && projectTextbox.value === projectName) {
      const create = submitButton(observation.elements);
      if (create) {
        return {
          type: "click",
          target: targetFor(observation.id, create),
          reason: "Submit the create project form.",
          confidence: 0.86,
          risk: "write",
        };
      }
    }

    const createButton = bestCreateButton(observation.elements);
    if (createButton) {
      return {
        type: "click",
        target: targetFor(observation.id, createButton),
        reason: `Use '${createButton.name}' to continue project creation.`,
        confidence: 0.84,
        risk: "write",
      };
    }

    return {
      type: "blocked",
      reason: 'I could not find a control that safely performs the requested "create project" action.',
      confidence: 0.72,
      risk: "read",
    };
  }
}
