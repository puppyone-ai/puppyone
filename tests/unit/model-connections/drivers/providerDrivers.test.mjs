import { describe, expect, it, vi } from "vitest";
import { ollamaDriver } from "../../../../electron/main/model-connections/drivers/ollama.mjs";
import { lmStudioDriver } from "../../../../electron/main/model-connections/drivers/lm-studio.mjs";
import { openaiCompatibleDriver } from "../../../../electron/main/model-connections/drivers/openai-compatible.mjs";
import { createModelDiscoveryService } from "../../../../electron/main/model-connections/discovery-service.mjs";
import { projectModelCatalog } from "../../../../electron/main/model-connections/model-catalog.mjs";

describe("provider metadata compatibility", () => {
  it("separates downloaded, loaded, effective context and theoretical maximum for Ollama", async () => {
    const request = vi.fn(async (url) => {
      if (url.endsWith("/api/tags")) return { models: [{ name: "test:latest" }, { name: "embed" }] };
      if (url.endsWith("/api/ps")) return { models: [{ name: "test:latest", context_length: 8192 }] };
      return { capabilities: ["completion", "tools"], model_info: { "test.context_length": 131072 } };
    });
    const result = await ollamaDriver.list({ baseUrl: "http://127.0.0.1:11434/v1" }, request, {});
    expect(result.models[0]).toMatchObject({ loaded: true, contextWindow: 8192, maxContextWindow: 131072, capabilities: { tools: "supported", images: "unsupported" } });
    expect(result.models[1]).toMatchObject({ loaded: false, contextWindow: null });
    expect(request.mock.calls.every(([url]) => !url.includes("/v1/api"))).toBe(true);
  });
  it("filters embedding models and preserves LM Studio instance context", async () => {
    const result = await lmStudioDriver.list({ baseUrl: "http://127.0.0.1:1234/v1" }, async () => ({ models: [
      { type: "embedding", key: "embed" },
      { type: "llm", key: "llm", max_context_length: 32768, loaded_instances: [{ config: { context_length: 4096 } }], capabilities: { trained_for_tool_use: true } },
    ] }), {});
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({ id: "llm", loaded: true, contextWindow: 4096, maxContextWindow: 32768, capabilities: { images: "unknown", tools: "supported" } });
  });
  it("falls back from unsupported native LM Studio endpoints but not authentication failures", async () => {
    const request = vi.fn().mockRejectedValueOnce({ code: "ENDPOINT_NOT_FOUND" }).mockResolvedValue({ data: [{ id: "old-server" }] });
    expect((await lmStudioDriver.list({ baseUrl: "http://127.0.0.1:1234/v1" }, request, {})).models[0].capabilities.tools).toBe("unknown");
    expect(request).toHaveBeenLastCalledWith("http://127.0.0.1:1234/v1/models", {});
    request.mockReset().mockRejectedValue({ code: "AUTHENTICATION_FAILED" });
    await expect(lmStudioDriver.list({ baseUrl: "http://127.0.0.1:1234/v1" }, request, {})).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(request).toHaveBeenCalledOnce();
  });
  it("supports an explicit model ID when /models is absent, without inventing capabilities", async () => {
    const connection = { id: "example", configGeneration: 1, auth: "none", baseUrl: "https://example.com/proxy/v1", manualModelId: "manual", manualContextWindow: 4096 };
    const result = await openaiCompatibleDriver.list(connection, async () => { throw { code: "ENDPOINT_NOT_FOUND" }; }, {});
    const catalog = projectModelCatalog(connection, result, "test");
    expect(catalog).toMatchObject({ complete: false, status: "ready", models: [{ id: "manual", contextWindow: 4096, capabilities: { tools: "unknown", text: "unknown" } }] });
  });
  it("truncates oversized model catalogs explicitly", async () => {
    const result = await openaiCompatibleDriver.list({ baseUrl: "https://example.com/v1" }, async () => ({ data: Array.from({ length: 300 }, (_, id) => ({ id: `model-${id}` })) }), {});
    expect(result.models).toHaveLength(256);
    expect(result.complete).toBe(false);
  });
  it("discovers only known loopback metadata and shares an in-flight probe", async () => {
    const request = vi.fn(async (url) => url.endsWith("/api/version") ? { version: "test" } : { models: [] });
    const service = createModelDiscoveryService({ drivers: [ollamaDriver, lmStudioDriver, openaiCompatibleDriver], request });
    const [one, two] = await Promise.all([service.discover(), service.discover()]);
    expect(one).toEqual(two); expect(one).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([url]) => new URL(url).hostname === "127.0.0.1")).toBe(true);
    await service.discover(); expect(request).toHaveBeenCalledTimes(2);
    service.dispose(); expect(await service.discover()).toEqual([]);
  });
});
