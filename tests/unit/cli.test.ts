import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "../../packages/cli/index.js";

describe("CLI parseArgs", () => {
  it("parses run instruction with --url", () => {
    const parsed = parseArgs(["run", "--url", "http://localhost:3000", "Create", "Demo"]);
    expect(parsed).toEqual({
      url: "http://localhost:3000",
      planner: "webllm",
      model: undefined,
      instruction: "Create Demo",
      headed: false,
      artifactsDir: expect.stringContaining(".runora-results"),
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
      artifactsDir: expect.stringContaining(".runora-results"),
    });
  });

  it("throws usage error when command is missing", () => {
    expect(() => parseArgs(["bad"])).toThrow("Usage: runora run");
  });

  it("throws when instruction is empty", () => {
    expect(() => parseArgs(["run", "--url", "http://localhost:3000"])).toThrow("Please provide a task instruction");
  });
});

describe("Runora package identity", () => {
  it("exposes runora as the canonical CLI while keeping legacy aliases", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf-8"));

    expect(packageJson.name).toBe("runora");
    expect(packageJson.bin.runora).toBe("dist/packages/cli/index.js");
    expect(packageJson.bin["ai-playwright"]).toBe("dist/packages/cli/index.js");
    expect(packageJson.bin.aipw).toBe("dist/packages/cli/index.js");
  });
});

describe("Runora CLI help", () => {
  it("prints Runora commands", () => {
    const result = spawnSync("npx", ["tsx", path.resolve("packages/cli/index.ts"), "--help"], {
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Runora");
    expect(result.stdout).toContain("npx runora init");
    expect(result.stdout).toContain("npx runora test");
    expect(result.stdout).toContain("npx runora ui");
  });
});

describe("create-runora", () => {
  it("generates an independent Runora project template", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-runora-"));
    try {
      const result = spawnSync(
        process.execPath,
        [path.resolve("packages/create-runora/index.js"), "sample-app", "--no-install"],
        { cwd: tempDir, encoding: "utf-8" }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Runora project created");

      const projectDir = path.join(tempDir, "sample-app");
      const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"));
      expect(packageJson.scripts.test).toBe("runora test");
      expect(packageJson.scripts.ui).toBe("runora ui");
      expect(packageJson.dependencies.runora).toBe("^1.0.17");
      expect(fs.existsSync(path.join(projectDir, "runora.config.ts"))).toBe(true);
      expect(fs.readFileSync(path.join(projectDir, "README.md"), "utf-8")).toContain("Runora project");
      expect(fs.readFileSync(path.join(projectDir, "tests/example.test.ts"), "utf-8")).toContain("Example");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
