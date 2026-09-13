import { describe, it, expect } from "vitest";
import {
  Kernel,
  taskId,
  elementId,
  observationId,
  type BrowserAction,
  type Observation,
} from "../../packages/core/src/index.js";
import type { PlannerAdapter, PlannerRequest, PlannerResponse, BrowserAdapter, BrowserRequest, BrowserResponse } from "../../packages/core/src/index.js";

describe("WASM Kernel - Portable State Machine", () => {
  it("should execute a complete task loop with mock adapters", async () => {
    // Test task: Create a project and verify it exists

    const task = {
      id: taskId("test-create-project"),
      goal: "Create a project named Demo and verify it exists",
      defaultUrl: "http://localhost:3000",
    };

    const policy = {
      allowedOrigins: ["http://localhost:3000"],
      approval: "destructive" as const,
    };

    const limits = {
      maxSteps: 10,
      maxTimeMs: 60000,
    };

    // Mock browser - tracks state and handles actions
    let currentObservation: Observation | null = null;
    let actionSequence: string[] = [];

    const mockBrowser: BrowserAdapter = {
      async observe(): Promise<Observation> {
        // Return observation based on current state
        if (!currentObservation) {
          currentObservation = {
            id: observationId("obs-1"),
            timestamp: Date.now(),
            url: "http://localhost:3000/projects",
            title: "Projects",
            text: "My Projects",
            elements: [
              {
                id: elementId("btn-new-project"),
                role: "button",
                name: "New Project",
                state: { visible: true, enabled: true },
              },
            ],
          };
        }
        return currentObservation;
      },

      async execute(request: BrowserRequest): Promise<BrowserResponse> {
        const { action } = request;
        actionSequence.push(action.type);

        // Handle click to open new project dialog or create
        if (action.type === "click") {
          if (
            action.target.elementId === elementId("btn-new-project")
          ) {
            currentObservation = {
              id: observationId("obs-2"),
              timestamp: Date.now(),
              url: "http://localhost:3000/projects/new",
              title: "New Project",
              text: "Create Project",
              elements: [
                {
                  id: elementId("input-project-name"),
                  role: "textbox",
                  name: "Project Name",
                  value: "",
                  state: { visible: true, enabled: true },
                },
                {
                  id: elementId("btn-create"),
                  role: "button",
                  name: "Create",
                  state: { visible: true, enabled: true },
                },
              ],
            };
          } else if (action.target.elementId === elementId("btn-create")) {
            // Project created successfully
            currentObservation = {
              id: observationId("obs-4"),
              timestamp: Date.now(),
              url: "http://localhost:3000/projects/demo",
              title: "Demo Project",
              text: "Project Demo successfully created",
              elements: [
                {
                  id: elementId("project-title"),
                  role: "heading",
                  name: "Demo",
                  state: { visible: true, enabled: true },
                },
              ],
            };
          }
          return { result: { status: "success" } };
        }

        // Handle fill name
        if (action.type === "fill") {
          currentObservation = {
            id: observationId("obs-3"),
            timestamp: Date.now(),
            url: "http://localhost:3000/projects/new",
            title: "New Project",
            text: "Create Project",
            elements: [
              {
                id: elementId("input-project-name"),
                role: "textbox",
                name: "Project Name",
                value: action.value,
                state: { visible: true, enabled: true },
              },
              {
                id: elementId("btn-create"),
                role: "button",
                name: "Create",
                state: { visible: true, enabled: true },
              },
            ],
          };
          return { result: { status: "success" } };
        }

        // Handle assert
        if (action.type === "assert") {
          if (
            action.assertion.type === "textVisible" &&
            currentObservation?.text?.includes(action.assertion.text)
          ) {
            return { result: { status: "success" } };
          }
          return {
            result: {
              status: "failure",
              error: "Assertion failed",
            },
          };
        }

        return { result: { status: "success" } };
      },
    };

    // Mock planner - deterministic action sequence
    let planCallCount = 0;
    const mockPlanner: PlannerAdapter = {
      async plan(request: PlannerRequest): Promise<PlannerResponse> {
        planCallCount++;

        if (planCallCount === 1) {
          return {
            action: {
              type: "click",
              target: {
                observationId: request.observation.id,
                elementId: "btn-new-project",
              },
            },
          };
        }

        if (planCallCount === 2) {
          return {
            action: {
              type: "fill",
              target: {
                observationId: request.observation.id,
                elementId: "input-project-name",
              },
              value: "Demo",
            },
          };
        }

        if (planCallCount === 3) {
          return {
            action: {
              type: "click",
              target: {
                observationId: request.observation.id,
                elementId: "btn-create",
              },
            },
          };
        }

        if (planCallCount === 4) {
          return {
            action: {
              type: "assert",
              assertion: {
                type: "textVisible",
                text: "Demo",
              },
            },
          };
        }

        return {
          action: {
            type: "finish",
            result: "success",
            reason: "Task complete",
          },
        };
      },
    };

    // Create and run kernel
    const kernel = new Kernel(task, policy, limits, mockPlanner, mockBrowser);
    const result = await kernel.run();

    // Verify results
    expect(result.status).toBe("passed");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify action sequence
    expect(actionSequence).toContain("click");
    expect(actionSequence).toContain("fill");
    expect(actionSequence).toContain("assert");

    // All steps should be successful
    result.steps.forEach((step) => {
      expect(step.validation.status).toBe("success");
      expect(step.result.status).toBe("success");
    });
  });

  it("should handle policy validation", async () => {
    const task = {
      id: taskId("test-policy"),
      goal: "Test policy validation",
    };

    const policy = {
      approval: "destructive" as const,
    };

    const limits = {
      maxSteps: 10,
      maxTimeMs: 60000,
    };

    const mockBrowser: BrowserAdapter = {
      async observe(): Promise<Observation> {
        return {
          id: observationId("obs-1"),
          timestamp: Date.now(),
          url: "http://localhost:3000",
          title: "Home",
          text: "Welcome",
          elements: [
            {
              id: elementId("btn-delete"),
              role: "button",
              name: "Delete",
              state: { visible: true, enabled: true },
            },
          ],
        };
      },

      async execute(): Promise<BrowserResponse> {
        return { result: { status: "success" } };
      },
    };

    // Planner proposes a destructive action that violates policy
    const mockPlanner: PlannerAdapter = {
      async plan(request: PlannerRequest): Promise<PlannerResponse> {
        return {
          action: {
            type: "click",
            target: {
              observationId: request.observation.id,
              elementId: "btn-delete",
            },
          },
        };
      },
    };

    const kernel = new Kernel(task, policy, limits, mockPlanner, mockBrowser);
    const result = await kernel.run();

    // Should be blocked due to policy violation
    expect(result.status).toBe("blocked");
    expect(result.error?.reason).toContain("Destructive action requires approval");
  });

  it("should detect stale observations", async () => {
    const task = {
      id: taskId("test-stale-obs"),
      goal: "Test stale observation detection",
    };

    const policy = {};
    const limits = {
      maxSteps: 10,
      maxTimeMs: 60000,
    };

    const mockBrowser: BrowserAdapter = {
      async observe(): Promise<Observation> {
        return {
          id: observationId("obs-current"),
          timestamp: Date.now(),
          url: "http://localhost:3000",
          title: "Home",
          text: "Welcome",
          elements: [
            {
              id: elementId("btn-action"),
              role: "button",
              name: "Action",
              state: { visible: true, enabled: true },
            },
          ],
        };
      },

      async execute(): Promise<BrowserResponse> {
        return { result: { status: "success" } };
      },
    };

    // Planner references a stale observation ID
    const mockPlanner: PlannerAdapter = {
      async plan(): Promise<PlannerResponse> {
        return {
          action: {
            type: "click",
            target: {
              observationId: observationId("obs-stale"),
              elementId: elementId("btn-action"),
            },
          },
        };
      },
    };

    const kernel = new Kernel(task, policy, limits, mockPlanner, mockBrowser);
    const result = await kernel.run();

    // Should be blocked due to stale observation
    expect(result.status).toBe("blocked");
    expect(result.error?.reason).toContain("stale observation");
  });

  it("should respect step limits", async () => {
    const task = {
      id: taskId("test-step-limit"),
      goal: "Test step limit enforcement",
    };

    const policy = {};
    const limits = {
      maxSteps: 2,
      maxTimeMs: 60000,
    };

    const mockBrowser: BrowserAdapter = {
      async observe(): Promise<Observation> {
        return {
          id: observationId("obs-1"),
          timestamp: Date.now(),
          url: "http://localhost:3000",
          title: "Home",
          text: "Welcome",
          elements: [
            {
              id: elementId("btn-action"),
              role: "button",
              name: "Action",
              state: { visible: true, enabled: true },
            },
          ],
        };
      },

      async execute(): Promise<BrowserResponse> {
        return { result: { status: "success" } };
      },
    };

    // Planner keeps proposing actions beyond the step limit
    let stepCount = 0;
    const mockPlanner: PlannerAdapter = {
      async plan(request: PlannerRequest): Promise<PlannerResponse> {
        stepCount++;
        return {
          action: {
            type: "click",
            target: {
              observationId: request.observation.id,
              elementId: elementId("btn-action"),
            },
          },
        };
      },
    };

    const kernel = new Kernel(task, policy, limits, mockPlanner, mockBrowser);
    const result = await kernel.run();

    // Should be blocked due to step limit
    expect(result.status).toBe("blocked");
    expect(result.steps.length).toBeLessThanOrEqual(limits.maxSteps);
  });
});
