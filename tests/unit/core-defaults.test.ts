import { describe, expect, it, vi } from "vitest";

vi.mock("../../packages/webllm/planner.js", () => ({
  WebLLMPlannerAdapter: class {
    constructor() {
      throw new Error("WebLLM should not be created by default");
    }
  },
  WebLLMPlanner: class {},
}));

describe("aiPlaywright defaults", () => {
  it("does not create a WebLLM planner unless one is requested", async () => {
    const { aiPlaywright } = await import("../../packages/core/index.js");
    const runtime = {
      launch: vi.fn(async () => ({ page: {} })),
      close: vi.fn(async () => undefined),
    };

    const browser = await aiPlaywright({ runtime: runtime as never });
    await browser.close();

    expect(runtime.launch).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
  });
});
