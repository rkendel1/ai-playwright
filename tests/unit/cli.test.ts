import { describe, expect, it } from "vitest";
import { parseArgs } from "../../packages/cli/index.js";

describe("CLI parseArgs", () => {
  it("defaults run instructions to the deterministic planner", () => {
    const parsed = parseArgs(["run", "--url", "http://localhost:3000", "Create", "Demo"]);
    expect(parsed).toEqual({
      url: "http://localhost:3000",
      planner: "deterministic",
      model: undefined,
      instruction: "Create Demo",
      headed: false,
      artifactsDir: expect.stringContaining(".ai-playwright-results"),
    });
  });

  it("parses explicit deterministic planner", () => {
    const parsed = parseArgs(["run", "--planner", "deterministic", "--url", "http://localhost:3000", "Create", "Demo"]);
    expect(parsed).toEqual({
      url: "http://localhost:3000",
      planner: "deterministic",
      model: undefined,
      instruction: "Create Demo",
      headed: false,
      artifactsDir: expect.stringContaining(".ai-playwright-results"),
    });
  });

  it("throws usage error when command is missing", () => {
    expect(() => parseArgs(["bad"])).toThrow("Usage: aipw run");
  });

  it("throws when instruction is empty", () => {
    expect(() => parseArgs(["run", "--url", "http://localhost:3000"])).toThrow("Please provide a task instruction");
  });
});
