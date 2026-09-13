import { describe, expect, it, vi } from "vitest";
import { WebLLMPlanner } from "../../packages/webllm/planner.js";
import type { PlannerInput } from "../../packages/core/planner.js";

function input(): PlannerInput {
  return {
    task: "Create a project named Demo",
    observation: {
      id: "obs-1",
      generation: 1,
      url: "http://localhost:3000/",
      title: "Projects",
      text: "Projects\nNew Project",
      elements: [{ id: "e1", role: "button", name: "New Project", state: { visible: true, enabled: true } }],
    },
    history: [],
    remainingSteps: 10,
    defaultUrl: "http://localhost:3000/",
  };
}

describe("WebLLMPlanner", () => {
  it("loads WebLLM and returns the model-produced BrowserAction", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ type: "click", target: { observationId: "obs-1", elementId: "e1" }, reason: "The visible button creates a project.", confidence: 0.91, risk: "write" }) } }],
    });
    const planner = new WebLLMPlanner({
      model: "test-model",
      engineFactory: vi.fn().mockResolvedValue({ chat: { completions: { create } } } as never),
    });

    const action = await planner.next(input());

    expect(action).toEqual({ type: "click", target: { observationId: "obs-1", elementId: "e1" }, reason: "The visible button creates a project.", confidence: 0.91, risk: "write" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ response_format: { type: "json_object" }, temperature: 0 }));
  });

  it("fails clearly when WebLLM cannot initialize", async () => {
    const planner = new WebLLMPlanner({
      model: "missing-model",
      engineFactory: vi.fn().mockRejectedValue(new Error("no webgpu")),
    });

    await expect(planner.next(input())).rejects.toThrow("Failed to initialize WebLLM model 'missing-model': no webgpu");
  });

  it("rejects invalid structured output", async () => {
    const planner = new WebLLMPlanner({
      model: "test-model",
      engineFactory: vi.fn().mockResolvedValue({
        chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: "not json" } }] }) } },
      } as never),
    });

    await expect(planner.next(input())).rejects.toThrow("WebLLM returned invalid JSON");
  });
});
