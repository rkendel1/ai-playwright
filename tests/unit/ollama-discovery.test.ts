import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverCloudModels, discoverOllamaModels } from "../../packages/workspace/ui-server.js";

afterEach(() => vi.unstubAllGlobals());

describe("Ollama model discovery", () => {
  it("returns installed model names from Ollama on every desktop platform", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: "llama3.2:latest" }, { model: "qwen2.5:7b" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(discoverOllamaModels("http://localhost:11434/"))
      .resolves.toEqual(["llama3.2:latest", "qwen2.5:7b"]);
    expect(fetch).toHaveBeenCalledWith(new URL("http://localhost:11434/api/tags"), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("rejects non-HTTP endpoints", async () => {
    await expect(discoverOllamaModels("file:///tmp/ollama"))
      .rejects.toThrow("must use HTTP or HTTPS");
  });
});

describe("cloud model discovery", () => {
  it("loads compatible OpenAI models available to the supplied key", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "gpt-5.6-luna" }, { id: "gpt-realtime-2" }, { id: "text-embedding-3-small" },
    ] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(discoverCloudModels("openai", "secret"))
      .resolves.toEqual(["gpt-5.6-luna"]);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });

  it("loads Claude models available to the supplied key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "claude-sonnet-5" }, { id: "unrelated-model" },
    ] }), { status: 200 })));

    await expect(discoverCloudModels("anthropic", "secret"))
      .resolves.toEqual(["claude-sonnet-5"]);
  });
});
