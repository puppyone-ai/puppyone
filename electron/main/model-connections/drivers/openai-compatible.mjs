import { boundedCatalog, modelEntry } from "./shared.mjs";

export const openaiCompatibleDriver = {
  id: "openai-compatible",
  async list(connection, request, options) {
    try {
      const value = await request(`${connection.baseUrl}/models`, options);
      return boundedCatalog(value?.data, (entry) => modelEntry(entry?.id));
    } catch (error) {
      // An explicitly configured model is valid even when the server has no catalog API.
      if (error?.code === "ENDPOINT_NOT_FOUND" && connection.manualModelId) return { models: [], complete: false };
      throw error;
    }
  },
};
