import type { BrowserAction } from "../../core/actions.js";
import type { ElementObservation } from "../../core/observer.js";
import type { Planner, PlannerInput } from "../../core/planner.js";

/**
 * CliPlannerAdapter — Deterministic planner for PR #8 proof-of-concept
 *
 * Implements the Planner interface with deterministic logic.
 * This is NOT a real LLM; it's a minimal proof that the adapter pattern works.
 *
 * PR #9 will replace this with WebLLMPlanner without changing the CLI.
 */

function targetFor(observationId: string, element: ElementObservation) {
  return { observationId, elementId: element.id };
}

function findButton(elements: ElementObservation[], predicate: (name: string) => boolean) {
  return elements.find(
    (e) => e.role === "button" && e.state.visible && e.state.enabled && predicate((e.name ?? "").toLowerCase())
  );
}

function findInput(elements: ElementObservation[], predicate: (name: string) => boolean) {
  return elements.find(
    (e) => e.role === "textbox" && e.state.visible && e.state.enabled && predicate((e.name ?? "").toLowerCase())
  );
}

function pageContains(text: string | undefined, query: string): boolean {
  return (text ?? "").toLowerCase().includes(query.toLowerCase());
}

export class CliPlannerAdapter implements Planner {
  readonly provider = "cli-deterministic";

  async next(input: PlannerInput): Promise<BrowserAction> {
    const { observation, history, defaultUrl } = input;
    const lastAction = history.at(-1)?.action as BrowserAction | undefined;

    // Step 1: Navigate to target URL if not already there
    if ((observation.url === "about:blank" || observation.url === "") && defaultUrl) {
      return {
        type: "goto",
        url: defaultUrl,
        reason: "Navigate to target application",
        confidence: 0.95,
        risk: "write",
      };
    }

    // Step 2: If we just executed an assert that passed, finish successfully
    if (lastAction?.type === "assert" && history.at(-1)?.result.status === "success") {
      return {
        type: "finish",
        result: "success",
        reason: "Checkout verification complete",
        confidence: 0.95,
        risk: "read",
      };
    }

    // Step 3: If we see success/confirmation text, assert it
    if (
      pageContains(observation.text, "order confirmed") ||
      pageContains(observation.text, "success") ||
      pageContains(observation.text, "thank you")
    ) {
      return {
        type: "assert",
        assertion: { type: "textVisible", text: "Order confirmed" },
        reason: "Verify checkout completion",
        confidence: 0.9,
        risk: "read",
      };
    }

    // Step 4: Look for checkout button and click it
    const checkoutBtn = findButton(observation.elements, (name) =>
      name.includes("checkout") || name.includes("proceed") || name.includes("buy")
    );
    if (checkoutBtn) {
      return {
        type: "click",
        target: targetFor(observation.id, checkoutBtn),
        reason: "Click checkout button",
        confidence: 0.9,
        risk: "write",
      };
    }

    // Step 5: Look for email/name fields and fill them
    const emailInput = findInput(observation.elements, (name) => name.includes("email") || name.includes("address"));
    if (emailInput && !emailInput.value) {
      return {
        type: "fill",
        target: targetFor(observation.id, emailInput),
        value: "test@example.com",
        reason: "Enter email address",
        confidence: 0.85,
        risk: "write",
      };
    }

    const nameInput = findInput(observation.elements, (name) => name.includes("name") || name.includes("first"));
    if (nameInput && !nameInput.value) {
      return {
        type: "fill",
        target: targetFor(observation.id, nameInput),
        value: "Test User",
        reason: "Enter customer name",
        confidence: 0.85,
        risk: "write",
      };
    }

    // Step 6: Look for add/continue buttons
    const continueBtn = findButton(observation.elements, (name) =>
      name.includes("continue") || name.includes("next") || name.includes("add")
    );
    if (continueBtn) {
      return {
        type: "click",
        target: targetFor(observation.id, continueBtn),
        reason: "Continue to next step",
        confidence: 0.88,
        risk: "write",
      };
    }

    // Step 7: Look for submit button
    const submitBtn = findButton(observation.elements, (name) =>
      name.includes("submit") || name.includes("complete") || name.includes("confirm")
    );
    if (submitBtn) {
      return {
        type: "click",
        target: targetFor(observation.id, submitBtn),
        reason: "Submit checkout form",
        confidence: 0.88,
        risk: "write",
      };
    }

    // Default: blocked
    return {
      type: "blocked",
      reason: "Cannot identify next step in checkout flow",
      confidence: 0.5,
      risk: "read",
    };
  }
}
