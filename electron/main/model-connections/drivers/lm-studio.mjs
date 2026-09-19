import { boundedCatalog, capability, modelEntry, nativeUrl, positiveInteger } from "./shared.mjs";
import { openaiCompatibleDriver } from "./openai-compatible.mjs";

export const lmStudioDriver = {
  id: "lm-studio",
  candidates: [{ driver: "lm-studio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" }],
  async probe(candidate, request, options) {
    const value = await request(nativeUrl(candidate.baseUrl, "/api/v1/models"), options);
    return Array.isArray(value?.models) && value.models.every((model) => typeof model?.key === "string" && typeof model?.type === "string");
  },
  async list(connection, request, options) {
    try {
      const value = await request(nativeUrl(connection.baseUrl, "/api/v1/models"), options);
      const result = boundedCatalog(value?.models, (entry) => {
        if (entry?.type !== "llm") return null;
        const instances = Array.isArray(entry.loaded_instances) ? entry.loaded_instances : [];
        const contexts = instances.map((instance) => positiveInteger(instance?.config?.context_length)).filter(Boolean);
        return modelEntry(entry.key, {
          name: typeof entry.display_name === "string" ? entry.display_name.slice(0, 300) : entry.key,
          loaded: instances.length > 0,
          capabilities: { text: "supported", tools: capability(entry.capabilities?.trained_for_tool_use), images: capability(entry.capabilities?.vision) },
          contextWindow: contexts.length ? Math.min(...contexts) : null,
          maxContextWindow: positiveInteger(entry.max_context_length), evidence: "lm-studio:api/v1/models",
        });
      });
      return result;
    } catch (error) {
      if (error?.code !== "ENDPOINT_NOT_FOUND") throw error;
      return openaiCompatibleDriver.list(connection, request, options);
    }
  },
};
