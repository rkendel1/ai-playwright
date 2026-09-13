// Mock adapters for WASM kernel E2E testing
// No production dependencies - purely for proving kernel portability

import type {
  PlannerAdapter,
  PlannerRequest,
  PlannerResponse,
  BrowserAdapter,
  BrowserRequest,
  BrowserResponse,
} from "../src/index.js";
import type {
  Observation,
  BrowserAction,
  ElementState,
} from "../src/index.js";
import { elementId, observationId } from "../src/index.js";

// ============================================================================
// Mock Planner - deterministic scripted responses
// ============================================================================

export class MockPlanner implements PlannerAdapter {
  private actions: BrowserAction[];
  private actionIndex: number = 0;

  constructor(actions: BrowserAction[]) {
    this.actions = actions;
  }

  async plan(request: PlannerRequest): Promise<PlannerResponse> {
    if (this.actionIndex >= this.actions.length) {
      return {
        action: { type: "finish", result: "success", reason: "Task complete" },
      };
    }

    const action = this.actions[this.actionIndex];
    this.actionIndex += 1;

    return {
      action,
      model: {
        provider: "mock",
        model: "mock",
        inferenceMs: 10,
      },
    };
  }
}

// ============================================================================
// Mock Browser - deterministic state transitions
// ============================================================================

export type MockBrowserState = {
  url: string;
  title: string;
  text?: string;
  elements: Array<{
    id: string;
    role?: string;
    name?: string;
    value?: string;
    state: ElementState;
  }>;
};

export class MockBrowser implements BrowserAdapter {
  private states: Map<string, MockBrowserState> = new Map();
  private currentStateId: string;
  private observationCounter: number = 0;

  constructor(initialState: MockBrowserState, stateTransitions?: Map<string, MockBrowserState>) {
    this.currentStateId = "initial";
    this.states.set("initial", initialState);
    if (stateTransitions) {
      stateTransitions.forEach((state, key) => {
        this.states.set(key, state);
      });
    }
  }

  async observe(): Promise<Observation> {
    const state = this.states.get(this.currentStateId);
    if (!state) {
      throw new Error(`Unknown mock state: ${this.currentStateId}`);
    }

    this.observationCounter++;
    return {
      id: observationId(`obs-${this.observationCounter}`),
      timestamp: Date.now(),
      url: state.url,
      title: state.title,
      text: state.text,
      elements: state.elements.map((el) => ({
        id: elementId(el.id),
        role: el.role,
        name: el.name,
        value: el.value,
        state: el.state,
      })),
    };
  }

  async execute(request: BrowserRequest): Promise<BrowserResponse> {
    const action = request.action;

    // Mock click behavior
    if (action.type === "click") {
      const state = this.states.get(this.currentStateId);
      if (!state) throw new Error("Unknown mock state");

      const element = state.elements.find((e) => e.id === action.target.elementId);
      if (!element) {
        return {
          result: {
            status: "failure",
            error: "Element not found",
          },
        };
      }

      // Transition to next state (mock behavior)
      if (this.currentStateId === "initial") {
        this.currentStateId = "clicked";
      }

      return {
        result: { status: "success" },
      };
    }

    // Mock fill behavior
    if (action.type === "fill") {
      const state = this.states.get(this.currentStateId);
      if (!state) throw new Error("Unknown mock state");

      const element = state.elements.find((e) => e.id === action.target.elementId);
      if (!element) {
        return {
          result: {
            status: "failure",
            error: "Element not found",
          },
        };
      }

      element.value = action.value;
      return {
        result: { status: "success" },
      };
    }

    // Mock goto behavior
    if (action.type === "goto") {
      this.currentStateId = "navigated";
      return {
        result: { status: "success" },
      };
    }

    // Mock assert behavior
    if (action.type === "assert") {
      const state = this.states.get(this.currentStateId);
      if (!state) throw new Error("Unknown mock state");

      if (action.assertion.type === "textVisible") {
        const hasText = state.text?.includes(action.assertion.text);
        return {
          result: {
            status: hasText ? "success" : "failure",
            error: hasText ? undefined : "Text not found",
          },
        };
      }

      if (action.assertion.type === "urlIncludes") {
        const hasUrl = state.url.includes(action.assertion.value);
        return {
          result: {
            status: hasUrl ? "success" : "failure",
            error: hasUrl ? undefined : "URL does not match",
          },
        };
      }
    }

    // Default success for other actions
    return {
      result: { status: "success" },
    };
  }

  setState(stateId: string) {
    this.currentStateId = stateId;
  }

  addState(stateId: string, state: MockBrowserState) {
    this.states.set(stateId, state);
  }
}
