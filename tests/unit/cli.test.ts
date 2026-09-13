import { describe, expect, it } from "vitest";
import { parseArgs } from "../../packages/cli/index.js";

describe("CLI parseArgs", () => {
  it("parses run instruction with --url", () => {
    const parsed = parseArgs(["run", "--url", "http://localhost:3000", "Create", "Demo"]);
    expect(parsed).toEqual({
      url: "http://localhost:3000",
      instruction: "Create Demo",
    });
  });

  it("throws usage error when command is missing", () => {
    expect(() => parseArgs(["bad"])).toThrow("Usage: aipw run");
  });

  it("throws when instruction is empty", () => {
    expect(() => parseArgs(["run", "--url", "http://localhost:3000"])).toThrow("Please provide a task instruction");
  });
});
