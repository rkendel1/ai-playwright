import type { BrowserAction } from "./actions.js";
import type { Planner, PlannerInput } from "./planner.js";
import { WebLLMPlanner } from "../webllm/planner.js";

export class MockPlanner implements Planner {
  readonly provider = "mock";
  private readonly delegate = new WebLLMPlanner("mock-rule-mvp");

  async next(input: PlannerInput): Promise<BrowserAction> {
    return this.delegate.next(input);
  }

  async plan(input: Omit<PlannerInput, "history" | "remainingSteps">): Promise<BrowserAction[]> {
    return this.delegate.plan?.(input) ?? [];
  }
}
