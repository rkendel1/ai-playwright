import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderPlanner } from "../../packages/workspace/provider-planner.js";

const input = {
  task: "Finish the test",
  observation: { id: "obs-1", url: "http://localhost:3000", title: "App", elements: [] },
  history: [],
  remainingSteps: 5,
};

const action = JSON.stringify({
  type: "finish",
  result: "success",
  reason: "The requested state is visible",
  confidence: 0.99,
  risk: "read",
});

afterEach(() => vi.unstubAllGlobals());

describe("external provider planner", () => {
  it("navigates to the configured application before asking a model to finish", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const planner = new ProviderPlanner({ provider: "ollama", model: "mistral" });

    await expect(planner.next({
      ...input,
      observation: { ...input.observation, url: "about:blank" },
      defaultUrl: "https://github.com/",
    } as never)).resolves.toMatchObject({ type: "goto", url: "https://github.com/" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes an action envelope returned by a local model", async () => {
    const wrapped = JSON.stringify({ action: { type: "finish", result: "success", reason: "Verified" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: wrapped } }), { status: 200 })));

    await expect(new ProviderPlanner({ provider: "ollama", model: "mistral" }).next(input as never))
      .resolves.toMatchObject({ type: "finish", result: "success" });
  });

  it("normalizes a local model target name against the current observation", async () => {
    const loose = JSON.stringify({ action: "click", target: "API keys", reason: "Open API keys" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: loose } }), { status: 200 })));
    const observed = {
      ...input,
      observation: {
        ...input.observation,
        elements: [{ id: "e12", role: "button", name: "API keys", state: { visible: true, enabled: true } }],
      },
    };

    await expect(new ProviderPlanner({ provider: "ollama", model: "mistral" }).next(observed as never))
      .resolves.toMatchObject({ type: "click", target: { observationId: "obs-1", elementId: "e12" } });
  });

  it("normalizes element_id fields returned by local models", async () => {
    const loose = JSON.stringify({ type: "click", element_id: "e12", reason: "Open API keys" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: loose } }), { status: 200 })));
    const observed = {
      ...input,
      observation: {
        ...input.observation,
        elements: [{ id: "e12", role: "button", name: "API keys", state: { visible: true, enabled: true } }],
      },
    };

    await expect(new ProviderPlanner({ provider: "ollama", model: "mistral" }).next(observed as never))
      .resolves.toMatchObject({ type: "click", target: { observationId: "obs-1", elementId: "e12" } });
  });

  it("uses a selected Ollama model and local endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: action } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(new ProviderPlanner({ provider: "ollama", model: "qwen2.5", baseUrl: "http://localhost:11434/" }).next(input as never))
      .resolves.toMatchObject({ type: "finish" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ model: "qwen2.5", stream: false, format: "json" });
  });

  it("authenticates an OpenAI-compatible request without putting the key in its body", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: action }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await new ProviderPlanner({ provider: "openai", model: "chosen-model", apiKey: "secret-key" }).next(input as never);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer secret-key");
    expect(options.body).not.toContain("secret-key");
    expect(JSON.parse(options.body).model).toBe("chosen-model");
    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
  });

  it("uses the selected Claude model through Anthropic", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: action }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(new ProviderPlanner({ provider: "anthropic", model: "chosen-claude", apiKey: "secret-key" }).next(input as never))
      .resolves.toMatchObject({ type: "finish" });
    const [, options] = fetch.mock.calls[0];
    expect(options.headers["x-api-key"]).toBe("secret-key");
    expect(JSON.parse(options.body).model).toBe("chosen-claude");
  });
});
