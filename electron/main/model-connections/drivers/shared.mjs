import { connectionError, MODEL_CONNECTION_LIMITS } from "../../../../shared/model-connections/schema.mjs";

export function nativeUrl(baseUrl, suffix) { return `${baseUrl.replace(/\/v1$/u, "")}${suffix}`; }
export const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0 && value <= 10_000_000 ? value : null;
export const capability = (value) => value === true ? "supported" : value === false ? "unsupported" : "unknown";
export function modelEntry(id, fields = {}) {
  if (typeof id !== "string" || !id.trim() || id.length > 300 || /[\u0000-\u001f\u007f]/u.test(id)) return null;
  return {
    id, name: id, available: true, loaded: null,
    contextWindow: null, maxContextWindow: null, evidence: "catalog", ...fields,
    capabilities: { text: "unknown", tools: "unknown", images: "unknown", reasoning: "unknown", ...fields.capabilities },
  };
}
export function boundedCatalog(values, map) {
  if (!Array.isArray(values)) throw connectionError("INVALID_RESPONSE");
  const entries = values.slice(0, MODEL_CONNECTION_LIMITS.models).map(map).filter(Boolean);
  return { models: [...new Map(entries.map((entry) => [entry.id, entry])).values()], complete: values.length <= MODEL_CONNECTION_LIMITS.models };
}
export async function mapConcurrent(values, concurrency, action) {
  const results = new Array(values.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) { const current = index++; results[current] = await action(values[current], current); }
  }));
  return results;
}
