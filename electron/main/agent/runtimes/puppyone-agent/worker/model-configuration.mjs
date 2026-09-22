import fs from "node:fs";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { connectionId, connectionError, normalizeModelBaseUrl } from "../../../../../../shared/model-connections/schema.mjs";
import { redactModelResponse } from "./redact-model-response.mjs";

export async function readModelConfiguration({ fd = 3, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const stream = fs.createReadStream(null, { fd, autoClose: true });
    const timer = setTimeout(() => stream.destroy(connectionError("TIMEOUT")), timeoutMs);
    timer.unref?.();
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) stream.destroy(connectionError("INVALID_CONFIGURATION")); else chunks.push(chunk);
    });
    stream.once("error", () => { clearTimeout(timer); reject(connectionError("AUTHORITY_REQUIRED")); });
    stream.once("end", () => {
      clearTimeout(timer);
      try { resolve(validateModelConfiguration(JSON.parse(Buffer.concat(chunks).toString("utf8")))); }
      catch { reject(connectionError("INVALID_CONFIGURATION")); }
    });
  });
}

export function validateModelConfiguration(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.models) || !value.models.length || value.models.length > 257) throw connectionError("INVALID_CONFIGURATION");
  connectionId(value.connectionId);
  if (normalizeModelBaseUrl(value.baseUrl) !== value.baseUrl || !Number.isSafeInteger(value.configGeneration) || value.configGeneration < 1) throw connectionError("INVALID_CONFIGURATION");
  if (!["none", "bearer"].includes(value.auth) || (value.auth === "bearer" && (typeof value.apiKey !== "string" || value.apiKey.length < 8 || value.apiKey.length > 8192 || /[\r\n\0]/u.test(value.apiKey)))) throw connectionError("INVALID_KEY");
  for (const model of value.models) {
    if (typeof model.id !== "string" || !model.id || model.id.length > 300 || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1024 || model.contextWindow > 10_000_000) throw connectionError("INVALID_CONFIGURATION");
  }
  if (!value.models.some((model) => model.id === value.selectedModelId)) throw connectionError("MODEL_UNAVAILABLE");
  return value;
}

/** One process, one connection: SDK requests cannot redirect credentials or fall back to another origin. */
export function installModelFetchBoundary(configuration, fetchImpl = globalThis.fetch) {
  const allowed = new URL(configuration.baseUrl);
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== allowed.origin || !url.pathname.startsWith(`${allowed.pathname}/`)) throw connectionError("ENDPOINT_NOT_ALLOWED");
    return redactModelResponse(await fetchImpl(input, { ...init, redirect: "error" }), configuration.apiKey);
  };
}

export async function createMemoryModelRuntime() {
  // A public CredentialStore implementation, not a deep import or a file-backed Pi profile.
  const credentials = { read: async () => undefined, list: async () => [],
    modify: async () => { throw connectionError("AUTHORITY_REQUIRED"); }, delete: async () => { throw connectionError("AUTHORITY_REQUIRED"); } };
  return ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
}

export async function createConnectionModelRuntime(configuration) {
  validateModelConfiguration(configuration);
  const runtime = await createMemoryModelRuntime();
  runtime.registerProvider(configuration.connectionId, {
    name: configuration.connectionId, api: "openai-completions", baseUrl: configuration.baseUrl,
    authHeader: configuration.auth === "bearer",
    models: configuration.models.map((model) => ({
      id: model.id, name: model.name, reasoning: false,
      input: model.capabilities.images === "supported" ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow, maxTokens: Math.min(4096, Math.floor(model.contextWindow / 4)),
      compat: { supportsDeveloperRole: false, supportsStore: false },
    })),
  });
  await runtime.setRuntimeApiKey(configuration.connectionId, configuration.apiKey || "puppyone-local-no-auth");
  return runtime;
}

export async function verifyConnectionModel(configuration, { signal } = {}) {
  const runtime = await createConnectionModelRuntime(configuration);
  const model = runtime.getModel(configuration.connectionId, configuration.selectedModelId);
  const token = "puppyone-model-check";
  const tool = { name: "puppyone_connection_check", description: "Return the supplied check token; no files or commands are used.",
    parameters: { type: "object", properties: { token: { type: "string" } }, required: ["token"], additionalProperties: false } };
  const response = await runtime.completeSimple(model, {
    systemPrompt: "This is a connection compatibility test. Call puppyone_connection_check with the exact token supplied by the user. Do not use any other tool.",
    messages: [{ role: "user", content: token, timestamp: Date.now() }], tools: [tool],
  }, { signal, maxTokens: 256, temperature: 0 });
  const call = response.content.find((entry) => entry.type === "toolCall" && entry.name === tool.name && entry.arguments?.token === token);
  if (!call || response.stopReason === "error") throw connectionError("VERIFICATION_FAILED");
  const completion = await runtime.completeSimple(model, {
    systemPrompt: "The connection check has completed. Reply with a short confirmation; do not call further tools.",
    messages: [{ role: "user", content: token, timestamp: Date.now() }, response,
      { role: "toolResult", toolCallId: call.id, toolName: tool.name, content: [{ type: "text", text: "Connection check passed." }], isError: false, timestamp: Date.now() }],
    tools: [tool],
  }, { signal, maxTokens: 128, temperature: 0 });
  if (completion.stopReason === "error" || !completion.content.some((entry) => entry.type === "text" && entry.text.trim())) throw connectionError("VERIFICATION_FAILED");
}
