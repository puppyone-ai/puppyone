import { boundedCatalog, capability, mapConcurrent, modelEntry, nativeUrl, positiveInteger } from "./shared.mjs";

export const ollamaDriver = {
  id: "ollama",
  candidates: [{ driver: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" }],
  async probe(candidate, request, options) {
    const result = await request(nativeUrl(candidate.baseUrl, "/api/version"), options);
    return typeof result?.version === "string";
  },
  async list(connection, request, options) {
    const tags = await request(nativeUrl(connection.baseUrl, "/api/tags"), options);
    const running = await request(nativeUrl(connection.baseUrl, "/api/ps"), options).catch(() => null);
    const catalog = boundedCatalog(tags?.models, (entry) => {
      const id = entry?.name ?? entry?.model;
      const instance = running?.models?.find((model) => model?.name === id || model?.model === id);
      return modelEntry(id, { loaded: running ? Boolean(instance) : null, contextWindow: positiveInteger(instance?.context_length), evidence: "ollama:tags/ps" });
    });
    // Metadata enrichment is bounded, not a request per model in an unbounded library.
    await mapConcurrent(catalog.models.slice(0, 16), 3, async (model) => {
      try {
        const detail = await request(nativeUrl(connection.baseUrl, "/api/show"), { ...options, body: { model: model.id } });
        const caps = Array.isArray(detail?.capabilities) ? detail.capabilities : null;
        model.capabilities = {
          reasoning: "unknown",
          text: caps ? capability(caps.includes("completion")) : "unknown",
          tools: caps ? capability(caps.includes("tools")) : "unknown",
          images: caps ? capability(caps.includes("vision")) : "unknown",
        };
        model.maxContextWindow = positiveInteger(Object.entries(detail?.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1]);
        model.evidence = "ollama:show";
      } catch { /* Missing model detail is unknown evidence, not a failed whole catalog. */ }
    });
    return catalog;
  },
};
