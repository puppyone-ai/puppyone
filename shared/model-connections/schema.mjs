export const MODEL_CONNECTION_DRIVERS = Object.freeze(["ollama", "lm-studio", "unsloth", "openai-compatible"]);
export const MODEL_CONNECTION_LIMITS = Object.freeze({ connections: 32, models: 256, keyBytes: 8192, responseBytes: 2 * 1024 * 1024 });

export function connectionError(code) {
  return Object.assign(new Error(`Model connection: ${code}`), { code });
}

export function connectionId(value) {
  if (typeof value !== "string" || !/^mc_[a-f0-9-]{36}$/u.test(value)) throw connectionError("INVALID_CONNECTION");
  return value;
}

export function isLoopbackHost(host) {
  return host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

export function normalizeModelBaseUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\u0000-\u001f]/u.test(value)) throw connectionError("INVALID_URL");
  let url;
  try { url = new URL(value); } catch { throw connectionError("INVALID_URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw connectionError("INVALID_URL");
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) throw connectionError("HTTPS_REQUIRED");
  // Pin localhost rather than resolving an attacker-controlled DNS answer.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  const pathname = url.pathname.replace(/\/+$/u, "");
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`;
  return url.href.replace(/\/$/u, "");
}

function text(value, max, optional = false) {
  if (optional && (value == null || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw connectionError("INVALID_CONFIGURATION");
  return value.trim();
}

export function parseConnectionCommand(command, raw) {
  const input = raw ?? {};
  if (typeof input !== "object" || Array.isArray(input)) throw connectionError("INVALID_CONFIGURATION");
  if (["read", "discover"].includes(command)) return {};
  if (["remove", "refresh", "verify"].includes(command)) {
    const parsed = { id: connectionId(input.id) };
    if (command !== "refresh") {
      if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1) throw connectionError("INVALID_CONFIGURATION");
      parsed.expectedGeneration = input.expectedGeneration;
    }
    if (command === "verify") parsed.modelId = text(input.modelId, 300);
    return parsed;
  }
  if (command !== "save") throw connectionError("INVALID_COMMAND");
  if (!MODEL_CONNECTION_DRIVERS.includes(input.driver) || !["none", "bearer"].includes(input.auth)) throw connectionError("INVALID_CONFIGURATION");
  const id = input.id == null ? null : connectionId(input.id);
  if (id && (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1)) throw connectionError("INVALID_CONFIGURATION");
  if (input.apiKey != null && (typeof input.apiKey !== "string" || input.apiKey.length < 8 || input.apiKey.length > MODEL_CONNECTION_LIMITS.keyBytes || /[\r\n\0]/u.test(input.apiKey))) throw connectionError("INVALID_KEY");
  const context = input.manualContextWindow ?? null;
  if (context !== null && (!Number.isSafeInteger(context) || context < 1024 || context > 10_000_000)) throw connectionError("INVALID_CONTEXT");
  return {
    id, expectedGeneration: id ? input.expectedGeneration : null,
    driver: input.driver, name: text(input.name, 120), baseUrl: normalizeModelBaseUrl(input.baseUrl), auth: input.auth,
    ...(input.apiKey != null ? { apiKey: input.apiKey } : {}),
    defaultModelId: text(input.defaultModelId, 300, true), manualModelId: text(input.manualModelId, 300, true),
    manualContextWindow: context, serverToolsDisabled: input.serverToolsDisabled === true,
  };
}

export function modelRoute(connection, modelId) {
  return `${connectionId(connection)}/${text(modelId, 300)}`;
}

export function parseModelRoute(value) {
  if (typeof value !== "string") throw connectionError("MODEL_REQUIRED");
  const slash = value.indexOf("/");
  return { connectionId: connectionId(value.slice(0, slash)), modelId: text(value.slice(slash + 1), 300) };
}

export function assertConnectionSnapshot(value) {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.connections) || !Array.isArray(value.catalogs)) throw connectionError("INVALID_RESPONSE");
  if (value.connections.length > MODEL_CONNECTION_LIMITS.connections) throw connectionError("INVALID_RESPONSE");
  for (const connection of value.connections) {
    connectionId(connection.id);
    if (!MODEL_CONNECTION_DRIVERS.includes(connection.driver) || typeof connection.credentialConfigured !== "boolean") throw connectionError("INVALID_RESPONSE");
  }
  // Deny secret-bearing structures even if an implementation accidentally returns one.
  const forbidden = new Set(["apikey", "credentialref", "secret", "authorization", "lease", "refreshtoken"]);
  const visit = (entry) => {
    if (!entry || typeof entry !== "object") return;
    for (const [key, child] of Object.entries(entry)) {
      if (forbidden.has(key.replaceAll("_", "").toLowerCase())) throw connectionError("INVALID_RESPONSE");
      visit(child);
    }
  };
  visit(value);
  return value;
}
