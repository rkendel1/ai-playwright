import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserExecutor } from "../../packages/core/executor.js";
import type { Planner, PlannerInput, PlannerTrace } from "../../packages/core/planner.js";
import { runTask } from "../../packages/core/task.js";

const artifactsRoot = path.resolve(".artifacts-task-trace-test");

describe("task trace planner evidence", () => {
  afterEach(async () => {
    await fs.rm(artifactsRoot, { recursive: true, force: true });
  });

  it("records observation, model output, parsed action, validation, and execution", async () => {
    let lastTrace: PlannerTrace | undefined;
    const rawOutput = JSON.stringify({
      type: "assert",
      assertion: { type: "textVisible", text: "Ready" },
      reason: "The observed page already contains Ready.",
      confidence: 0.9,
      risk: "read",
    });

    const planner: Planner = {
      provider: "webllm",
      model: "test-model",
      async next(input: PlannerInput) {
        const action = JSON.parse(rawOutput);
        lastTrace = {
          provider: "webllm",
          model: "test-model",
          input: { task: input.task, observation: input.observation },
          rawOutput,
          parsedAction: action,
          inference: { durationMs: 3, inputTokens: 10, outputTokens: 6 },
        };
        return action;
      },
      consumeTrace() {
        const trace = lastTrace;
        lastTrace = undefined;
        return trace;
      },
    };

    const executor: BrowserExecutor = {
      async execute() {
        return { status: "success", output: "Ready" };
      },
    };

    const page = {
      async screenshot() {},
      async evaluate() {
        return {
          id: "obs-1",
          generation: 1,
          url: "http://localhost:3000/",
          title: "Trace fixture",
          text: "Ready",
          elements: [],
        };
      },
    };

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Verify Ready is visible",
      limits: { maxSteps: 1, maxTimeMs: 1000 },
      artifactsRoot,
      taskId: "task-001",
    });

    expect(result.status).toBe("blocked");
    const trace = JSON.parse(await fs.readFile(path.join(result.artifactsPath, "trace.json"), "utf-8"));
    expect(trace.steps[0]).toMatchObject({
      observation: { id: "obs-1", text: "Ready" },
      action: { type: "assert", assertion: { type: "textVisible", text: "Ready" } },
      planner: {
        provider: "webllm",
        model: "test-model",
        rawOutput,
        parsedAction: { type: "assert", assertion: { type: "textVisible", text: "Ready" } },
        inference: { durationMs: 3, inputTokens: 10, outputTokens: 6 },
      },
      validation: { status: "success" },
      result: { status: "success", output: "Ready" },
    });
  });

  it("feeds a premature finish back to the planner and recovers with verification", async () => {
    let call = 0;
    const planner: Planner = {
      provider: "browser-webllm",
      async next() {
        call += 1;
        if (call === 1) return { type: "finish", result: "success", reason: "Done" };
        if (call === 2) return { type: "assert", assertion: { type: "textVisible", text: "Ready" } };
        return { type: "finish", result: "success", reason: "Verified" };
      },
    };
    const executor: BrowserExecutor = { async execute() { return { status: "success" }; } };
    const page = {
      async screenshot() {},
      async evaluate() {
        return { id: `obs-${call}`, generation: call, url: "http://localhost:3000/", title: "App", text: "Ready", elements: [] };
      },
    };

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Verify Ready",
      limits: { maxSteps: 3, maxTimeMs: 1000 },
      artifactsRoot,
      taskId: "task-recovery",
    });

    expect(result.status).toBe("passed");
    expect(result.steps.map((step) => (step.action as { type?: string } | undefined)?.type)).toEqual(["finish", "assert", "finish"]);
    expect(result.steps[0].validation.status).toBe("failure");
  });

  it("stops a run while the planner is still waiting", async () => {
    const controller = new AbortController();
    const planner: Planner = { async next() { return new Promise(() => undefined); } };
    const executor: BrowserExecutor = { async execute() { return { status: "success" }; } };
    const page = {
      async screenshot() {},
      async evaluate() {
        return { id: "obs-stop", generation: 1, url: "http://localhost:3000/", title: "App", text: "Ready", elements: [] };
      },
    };
    setTimeout(() => controller.abort(), 10);

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Long task",
      limits: { maxSteps: 10, maxTimeMs: 60_000 },
      artifactsRoot,
      taskId: "task-stopped",
      signal: controller.signal,
    });

    expect(result.status).toBe("blocked");
    expect(result.error?.reason).toBe("Test stopped by user.");
  });

  it("grounds a premature finish to the visible control named by the task", async () => {
    const planner: Planner = { async next() { return { type: "finish", result: "success", reason: "Done" }; } };
    const executor: BrowserExecutor = { async execute() { return { status: "success" }; } };
    const page = {
      async screenshot() {},
      async evaluate() {
        return {
          id: "obs-api-keys",
          generation: 1,
          url: "http://localhost:3000/",
          title: "AppPort",
          text: "Overview API keys Webhooks Create API key",
          elements: [
            { id: "e1", role: "button", name: "Overview", state: { visible: true, enabled: true } },
            { id: "e2", role: "button", name: "API keys1", state: { visible: true, enabled: true } },
            { id: "e10", role: "button", name: "Create API keyReturns a one-time secret+", state: { visible: true, enabled: true } },
          ],
        };
      },
    };

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Create a new api key by going to API keys in the left side panel, then click Create key",
      limits: { maxSteps: 1, maxTimeMs: 1000 },
      artifactsRoot,
      taskId: "task-grounded",
    });

    expect((result.steps[0].action as { type: string; target: { elementId: string } }).type).toBe("click");
    expect((result.steps[0].action as { target: { elementId: string } }).target.elementId).toBe("e2");
  });

  it("executes a common web search without relying on an LLM action", async () => {
    let value = "";
    let currentUrl = "https://www.google.com/";
    const planner: Planner = { async next() { throw new Error("The planner should not be called for a grounded search"); } };
    const executor: BrowserExecutor = {
      async execute(_page, action) {
        if (action.type === "fill") value = action.value;
        if (action.type === "press") currentUrl = "https://www.google.com/search?q=great+dane+puppies";
        return { status: "success" };
      },
    };
    const page = {
      async screenshot() {},
      async evaluate() {
        return {
          id: `obs-${value}-${currentUrl}`,
          generation: 1,
          url: currentUrl,
          title: "Google",
          text: "Google Search",
          elements: [{ id: "e18", role: "combobox", name: "Search", value, state: { visible: true, enabled: true } }],
        };
      },
    };

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Go to Google and search great dane puppies",
      limits: { maxSteps: 4, maxTimeMs: 1000 },
      artifactsRoot,
      taskId: "task-google-search",
    });

    expect(result.status).toBe("passed");
    expect(result.steps.map((step) => (step.action as { type: string }).type)).toEqual(["fill", "press", "assert", "finish"]);
  });

  it("grounds navigation, form entry, choices, submission, and verification", async () => {
    let screen: "overview" | "keys" | "form" | "done" = "overview";
    let keyName = "";
    const checked = new Set<string>();
    const planner: Planner = { async next() { throw new Error("Grounded form flow should not need the LLM"); } };
    const executor: BrowserExecutor = {
      async execute(_page, action) {
        if (action.type === "click" && action.target.elementId === "api-keys") screen = "keys";
        if (action.type === "click" && action.target.elementId === "create-key") screen = "form";
        if (action.type === "fill") keyName = action.value;
        if (action.type === "click" && action.target.elementId.startsWith("scope-")) checked.add(action.target.elementId);
        if (action.type === "click" && action.target.elementId === "submit-key") screen = "done";
        return { status: "success" };
      },
    };
    const page = {
      async screenshot() {},
      async evaluate() {
        const state = (id: string, role: string, name: string, value = "", isChecked = false) => ({ id, role, name, value, state: { visible: true, enabled: true, checked: isChecked } });
        const elements = screen === "overview"
          ? [state("overview", "button", "Overview"), state("api-keys", "button", "API keys1")]
          : screen === "keys"
            ? [state("api-keys", "button", "API keys1"), state("create-key", "button", "Create API key")]
            : screen === "form"
              ? [
                  state("key-name", "textbox", "Key name", keyName),
                  state("scope-send", "checkbox", "invoices.send", "", checked.has("scope-send")),
                  state("scope-receive", "checkbox", "invoices.receive", "", checked.has("scope-receive")),
                  state("submit-key", "button", "Create key"),
                ]
              : [];
        return { id: `obs-${screen}-${keyName}-${checked.size}`, generation: 1, url: "http://localhost:3000/", title: "AppPort", text: screen === "done" ? `API key created ${keyName}` : "", elements };
      },
    };

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Go to API keys, click Create key, create a key called new-server-key with scopes invoices.send and invoices.receive",
      limits: { maxSteps: 8, maxTimeMs: 1000 },
      artifactsRoot,
      taskId: "task-general-form",
    });

    expect(result.status).toBe("passed");
    expect(keyName).toBe("new-server-key");
    expect([...checked]).toEqual(["scope-send", "scope-receive"]);
  });

  it("fills vault credentials locally and redacts them from planner input and evidence", async () => {
    const username = "admin@example.test";
    const password = "correct-horse-battery-staple";
    let enteredUsername = "";
    let enteredPassword = "";
    let signedIn = false;
    const plannerInputs: PlannerInput[] = [];
    const planner: Planner = {
      async next(input) {
        plannerInputs.push(input);
        return { type: "assert", assertion: { type: "textVisible", text: "Dashboard" } };
      },
    };
    const executor: BrowserExecutor = {
      async execute(_page, action) {
        if (action.type === "fill" && action.target.elementId === "username") enteredUsername = action.value;
        if (action.type === "fill" && action.target.elementId === "password") enteredPassword = action.value;
        if (action.type === "click") signedIn = true;
        return { status: "success" };
      },
    };
    const page = {
      async screenshot() {},
      async evaluate() {
        return {
          id: `obs-${enteredUsername}-${enteredPassword}-${signedIn}`,
          generation: 1,
          url: "https://app.example.test/login",
          title: "Example",
          text: signedIn ? "Dashboard" : "Sign in",
          elements: signedIn ? [] : [
            { id: "username", role: "textbox", name: "Username", value: enteredUsername, autocomplete: "username", state: { visible: true, enabled: true } },
            { id: "password", role: "textbox", name: "Password", inputType: "password", autocomplete: "current-password", state: { visible: true, enabled: true } },
            { id: "sign-in", role: "button", name: "Sign in", state: { visible: true, enabled: true } },
          ],
        };
      },
    };

    const result = await runTask({
      planner,
      executor,
      page: page as never,
      task: "Sign in and verify the Dashboard",
      secrets: { username, password },
      limits: { maxSteps: 6, maxTimeMs: 1000 },
      artifactsRoot,
      taskId: "task-vault-login",
    });

    expect(result.status).toBe("passed");
    expect(enteredUsername).toBe(username);
    expect(enteredPassword).toBe(password);
    expect(JSON.stringify(plannerInputs)).not.toContain(username);
    expect(JSON.stringify(plannerInputs)).not.toContain(password);
    const trace = await fs.readFile(path.join(result.artifactsPath, "trace.json"), "utf8");
    expect(trace).not.toContain(username);
    expect(trace).not.toContain(password);
    expect(trace).toContain("[REDACTED]");
  });
});
