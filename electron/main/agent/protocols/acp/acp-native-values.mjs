import { nativeSessionId } from "../../../../../shared/agent-contract/native-session-id.mjs";


export function isUnavailableAcpSessionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return error?.code === -32602
    || /invalid params|unknown session|session.{0,32}(?:not found|does not exist|unavailable)/iu.test(message);
}

export function publicModels(config, fallbackProviderId) {
  const variants = config.efforts.available.map((entry) => entry.id);
  return config.models.available.map((model, index) => {
    const identity = splitModelIdentity(model.id, fallbackProviderId);
    return {
      id: model.id,
      model: model.id,
      providerId: identity.providerId,
      modelId: identity.modelId,
      displayName: model.name || model.id,
      description: model.description || "",
      isDefault: model.id === config.models.currentId || (!config.models.currentId && index === 0),
      variants,
      defaultVariant: variants.includes(config.efforts.currentId) ? config.efforts.currentId : variants[0] ?? null,
    };
  });
}

function splitModelIdentity(value, fallbackProviderId) {
  const id = text(value, 2_000);
  const colon = id.indexOf(":");
  const slash = id.indexOf("/");
  if (colon > 0 && (slash < 0 || colon < slash)) {
    if (id.startsWith("custom:")) {
      const endpointSeparator = id.indexOf(":", colon + 1);
      if (endpointSeparator > colon + 1) return {
        providerId: id.slice(0, endpointSeparator),
        modelId: id.slice(endpointSeparator + 1),
      };
    }
    return { providerId: id.slice(0, colon), modelId: id.slice(colon + 1) };
  }
  if (slash > 0) return { providerId: id.slice(0, slash), modelId: id.slice(slash + 1) };
  return { providerId: fallbackProviderId, modelId: id };
}

export function publicProviders(models) {
  const groups = new Map();
  for (const model of models) {
    const id = model.providerId || "opencode";
    const current = groups.get(id) ?? { id, displayName: humanize(id), source: "native", defaultModel: null, modelCount: 0 };
    current.modelCount += 1;
    if (model.isDefault) current.defaultModel = model.model;
    groups.set(id, current);
  }
  return Array.from(groups.values());
}

export function publicModes(config) {
  return config.modes.available.map((mode, index) => ({
    id: mode.id,
    displayName: mode.name || humanize(mode.id),
    description: mode.description || "",
    isDefault: mode.id === config.modes.currentId || (!config.modes.currentId && index === 0),
  }));
}

export function mergeJsonConfig(value, overlay) {
  let base = {};
  try {
    const parsed = value ? JSON.parse(value) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
  } catch {
    // A malformed inherited inline config is not forwarded into the managed runtime.
  }
  return JSON.stringify({
    ...base,
    ...overlay,
    agent: { ...(record(base.agent)), ...(record(overlay.agent)) },
  });
}

export function event(type, providerSessionId, turnId, itemId, payload) {
  return { type, providerSessionId: nativeSessionId(providerSessionId), turnId: safeId(turnId), itemId: safeId(itemId), payload };
}

export function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

export function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function normalizeDate(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function array(value) {
  return Array.isArray(value) ? value : [];
}

export function humanize(value) {
  return text(value, 160).replace(/[-_.]+/gu, " ").replace(/\b\w/gu, (character) => character.toUpperCase());
}
