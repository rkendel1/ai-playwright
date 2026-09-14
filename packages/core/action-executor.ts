import type { Page } from "playwright";
import type {
  BrowserAction,
  ValidatedAction,
  ActionPolicy,
} from "./action-schema.js";
import {
  validateAction,
  validateNavigation,
  validateApproval,
  validateKey,
  actionRisk,
} from "./action-schema.js";
import type { Observation, ElementObservation } from "./observer.js";
import {
  findElementByLocator,
  validateLocator,
  type ElementMatch,
} from "./locator.js";

export type ExecutionResult = {
  status: "success" | "failure";
  error?: string;
  output?: string;
  executionTimeMs: number;
};

export class ActionExecutor {
  constructor(private page: Page) {}

  async execute(
    action: unknown,
    observation: Observation,
    policy: ActionPolicy = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const validated = validateAction(action);
      await this.executeValidated(validated, observation, policy);

      return {
        status: "success",
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: "failure",
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  private async executeValidated(
    action: ValidatedAction,
    observation: Observation,
    policy: ActionPolicy
  ): Promise<void> {
    switch (action.type) {
      case "goto":
        return this.executeGoto(action, policy);
      case "click":
        return this.executeClick(action, observation, policy);
      case "fill":
        return this.executeFill(action, observation, policy);
      case "press":
        return this.executePress(action, observation, policy);
      case "select":
        return this.executeSelect(action, observation, policy);
      case "hover":
        return this.executeHover(action, observation, policy);
      case "scroll":
        return this.executeScroll(action);
      case "wait":
        return this.executeWait(action);
      case "extract":
        return this.executeExtract(action, observation);
      case "assert":
        return this.executeAssert(action, observation);
      case "finish":
        return;
      case "blocked":
        throw new Error(`Task blocked: ${action.reason}`);
    }
  }

  private async executeGoto(
    action: Extract<BrowserAction, { type: "goto" }>,
    policy: ActionPolicy
  ): Promise<void> {
    validateNavigation(action.url, policy);
    await this.page.goto(action.url, { waitUntil: "domcontentloaded" });
  }

  private async executeClick(
    action: Extract<BrowserAction, { type: "click" }>,
    observation: Observation,
    policy: ActionPolicy
  ): Promise<void> {
    const element = await this.resolveElement(
      action.locator,
      action.fallbackLocators,
      observation
    );
    validateApproval(action, element.element, policy);
    await this.page.locator(`[data-aipw-id="${element.element.id}"]`).click();
  }

  private async executeFill(
    action: Extract<BrowserAction, { type: "fill" }>,
    observation: Observation,
    policy: ActionPolicy
  ): Promise<void> {
    const element = await this.resolveElement(
      action.locator,
      action.fallbackLocators,
      observation
    );
    validateApproval(action, element.element, policy);

    if (!["textbox", "searchbox", "combobox"].includes(element.element.role ?? "")) {
      throw new Error(
        `Fill action requires a textbox, searchbox, or combobox. Got ${element.element.role}`
      );
    }

    await this.page
      .locator(`[data-aipw-id="${element.element.id}"]`)
      .fill(action.value);
  }

  private async executePress(
    action: Extract<BrowserAction, { type: "press" }>,
    observation: Observation,
    policy: ActionPolicy
  ): Promise<void> {
    validateKey(action, policy);
    const element = await this.resolveElement(
      action.locator,
      action.fallbackLocators,
      observation
    );
    validateApproval(action, element.element, policy);
    await this.page
      .locator(`[data-aipw-id="${element.element.id}"]`)
      .press(action.key);
  }

  private async executeSelect(
    action: Extract<BrowserAction, { type: "select" }>,
    observation: Observation,
    policy: ActionPolicy
  ): Promise<void> {
    const element = await this.resolveElement(
      action.locator,
      action.fallbackLocators,
      observation
    );
    validateApproval(action, element.element, policy);

    if (element.element.role !== "combobox") {
      throw new Error(
        `Select action requires a combobox. Got ${element.element.role}`
      );
    }

    await this.page
      .locator(`[data-aipw-id="${element.element.id}"]`)
      .selectOption(action.value);
  }

  private async executeHover(
    action: Extract<BrowserAction, { type: "hover" }>,
    observation: Observation,
    policy: ActionPolicy
  ): Promise<void> {
    const element = await this.resolveElement(
      action.locator,
      action.fallbackLocators,
      observation
    );
    validateApproval(action, element.element, policy);
    await this.page
      .locator(`[data-aipw-id="${element.element.id}"]`)
      .hover();
  }

  private async executeScroll(
    action: Extract<BrowserAction, { type: "scroll" }>
  ): Promise<void> {
    const amount = action.amount ?? 100;
    const scrollAmount = action.direction === "up" ? -amount : amount;
    await this.page.evaluate((scroll) => {
      window.scrollBy(0, scroll);
    }, scrollAmount);
  }

  private async executeWait(
    action: Extract<BrowserAction, { type: "wait" }>
  ): Promise<void> {
    await this.page.waitForTimeout(action.ms);
  }

  private async executeExtract(
    action: Extract<BrowserAction, { type: "extract" }>,
    observation: Observation
  ): Promise<void> {
    const element = await this.resolveElement(
      action.locator,
      action.fallbackLocators,
      observation
    );
    console.log("Extracted element:", element.element);
  }

  private async executeAssert(
    action: Extract<BrowserAction, { type: "assert" }>,
    observation: Observation
  ): Promise<void> {
    const assertion = action.assertion;
    switch (assertion.type) {
      case "textVisible": {
        const visible = observation.elements.some((e) =>
          e.name?.includes(assertion.text)
        );
        if (!visible) {
          throw new Error(`Text "${assertion.text}" not found in observation`);
        }
        break;
      }
      case "urlIncludes": {
        if (!observation.url.includes(assertion.value)) {
          throw new Error(
            `URL "${observation.url}" does not include "${assertion.value}"`
          );
        }
        break;
      }
      case "elementVisible": {
        const element = observation.elements.find(
          (e) => e.id === assertion.elementId
        );
        if (!element || !element.state.visible) {
          throw new Error(`Element "${assertion.elementId}" is not visible`);
        }
        break;
      }
      case "elementEnabled": {
        const element = observation.elements.find(
          (e) => e.id === assertion.elementId
        );
        if (!element || !element.state.enabled) {
          throw new Error(`Element "${assertion.elementId}" is not enabled`);
        }
        break;
      }
    }
  }

  private async resolveElement(
    locator: any,
    fallbackLocators?: any[],
    observation?: Observation
  ): Promise<ElementMatch> {
    if (!observation) {
      throw new Error("Observation required to resolve element");
    }

    const validatedLocator = validateLocator(locator);
    const match = findElementByLocator(validatedLocator, observation);

    if (match) {
      return match;
    }

    if (fallbackLocators && fallbackLocators.length > 0) {
      for (const fallback of fallbackLocators) {
        const validatedFallback = validateLocator(fallback);
        const fallbackMatch = findElementByLocator(
          validatedFallback,
          observation
        );
        if (fallbackMatch) {
          return fallbackMatch;
        }
      }
    }

    throw new Error(
      `Unable to resolve element with locator: ${JSON.stringify(locator)}`
    );
  }
}
