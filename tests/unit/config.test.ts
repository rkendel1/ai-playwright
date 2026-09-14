import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../../packages/workspace/config.js";

const workspaceDir = path.resolve(".config-test-workspace");

describe("workspace config", () => {
  afterEach(async () => {
    delete (globalThis as typeof globalThis & { __aipwEvalProbe?: string }).__aipwEvalProbe;
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("loads explicit WebLLM planner and model configuration", async () => {
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "runora.config.ts"),
      `export default {
  url: "http://127.0.0.1:3000",
  planner: "webllm",
  model: {
    provider: "webllm",
    model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  },
};`,
      "utf-8",
    );

    await expect(resolveConfig(workspaceDir)).resolves.toMatchObject({
      url: "http://127.0.0.1:3000",
      planner: "webllm",
      model: {
        provider: "webllm",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      },
    });
  });

  it("does not execute JavaScript while loading TypeScript config", async () => {
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "runora.config.ts"),
      `export default {
  url: ((globalThis as any).__aipwEvalProbe = "executed"),
};`,
      "utf-8",
    );

    await resolveConfig(workspaceDir);

    expect((globalThis as typeof globalThis & { __aipwEvalProbe?: string }).__aipwEvalProbe).toBeUndefined();
  });

  it("keeps legacy ai-playwright config compatibility", async () => {
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "ai-playwright.config.ts"),
      `export default {
  url: "http://127.0.0.1:4000",
};`,
      "utf-8",
    );

    await expect(resolveConfig(workspaceDir)).resolves.toMatchObject({
      url: "http://127.0.0.1:4000",
    });
  });

  it("prefers canonical runora config over legacy config", async () => {
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "ai-playwright.config.ts"),
      `export default {
  url: "http://127.0.0.1:4000",
};`,
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "runora.config.ts"),
      `export default {
  url: "http://127.0.0.1:5000",
};`,
      "utf-8",
    );

    await expect(resolveConfig(workspaceDir)).resolves.toMatchObject({
      url: "http://127.0.0.1:5000",
    });
  });
});
