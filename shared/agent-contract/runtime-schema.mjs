import {
  AGENT_READINESS_CODES,
  AGENT_READINESS_CODE_STATUS,
  AGENT_RUNTIME_CAPABILITIES,
} from "./constants.mjs";
import {
  assertArray,
  assertRecord,
  assertRuntimeId,
  enumValue,
  requiredString,
} from "./validation.mjs";

const CAPABILITY_METHODS = Object.freeze({
  manualApprovals: "resolveApproval",
  structuredQuestions: "resolveQuestion",
  fork: "forkSession",
  steer: "steerTurn",
  compaction: "compactSession",
});

export function assertAgentInspection(value) {
  const inspection = assertRecord(value, "Agent inspection");
  if (inspection.runtime !== undefined) assertRuntimeDescriptor(inspection.runtime);
  if (inspection.readiness !== undefined && inspection.readiness !== null) assertReadiness(inspection.readiness);
  assertArray(inspection.providers ?? [], "Agent inspection.providers").forEach(assertAgentInferenceProvider);
  assertArray(inspection.models ?? [], "Agent inspection.models").forEach(assertAgentModel);
  assertArray(inspection.modes ?? [], "Agent inspection.modes").forEach((mode) => assertNamedEntry(mode, "mode"));
  assertArray(inspection.commands ?? [], "Agent inspection.commands").forEach((command) => assertNamedEntry(command, "command", "name"));
  normalizeCapabilitySnapshot(inspection.capabilities ?? {});
  assertArray(inspection.warnings ?? [], "Agent inspection.warnings").forEach((warning) => requiredString(warning, "warning", 32_768));
  return value;
}

export function assertAgentRuntimeCapabilities(adapter, capabilities, runtimeId = "unknown") {
  const normalized = normalizeCapabilitySnapshot(capabilities);
  for (const [capability, method] of Object.entries(CAPABILITY_METHODS)) {
    if (normalized[capability] && typeof adapter?.[method] !== "function") {
      throw new TypeError(`Agent runtime ${runtimeId} advertises ${capability} but is missing ${method}().`);
    }
  }
  return normalized;
}

export function normalizeCapabilitySnapshot(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const revision = boundedOptionalText(source.revision, 160);
  const protocol = normalizeCapabilityProtocol(source.protocol);
  const constraints = normalizeCapabilityConstraints(source.constraints);
  const history = normalizeSessionHistoryCapabilities(source.history);
  const recovery = normalizeNativeRecoveryCapabilities(source.recovery);
  return {
    ...Object.fromEntries(AGENT_RUNTIME_CAPABILITIES.map((capability) => [capability, source[capability] === true])),
    ...(revision ? { revision } : {}),
    ...(protocol ? { protocol } : {}),
    ...(constraints ? { constraints } : {}),
    ...(history ? { history } : {}),
    ...(recovery ? { recovery } : {}),
    ...(source.modelConnections === true ? { modelConnections: true } : {}),
    ...(source.readOnly === true ? { readOnly: true } : {}),
    referenceInputs: normalizeReferenceInputCapabilities(source.referenceInputs, source),
  };
}

function normalizeNativeRecoveryCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const strategies = new Set(["unsupported", "cursor-replay", "snapshot-reload", "object-reconciliation"]);
  const activeExecution = new Set(["confirmed", "outcome-unknown"]);
  if (!strategies.has(value.strategy) || !activeExecution.has(value.activeExecution)) return null;
  return {
    strategy: value.strategy,
    activeExecution: value.activeExecution,
    atomicHandoff: value.atomicHandoff === true,
  };
}

function normalizeSessionHistoryCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    discovery: value.discovery === "paged" ? "paged" : "unsupported",
    exactOpen: value.exactOpen === "supported" ? "supported" : "unsupported",
    hydration: ["push-replay", "snapshot", "paged"].includes(value.hydration)
      ? value.hydration
      : "unsupported",
  };
}

function normalizeCapabilityProtocol(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = boundedOptionalText(value.name, 80);
  const version = Number.isSafeInteger(value.version) && value.version >= 0
    ? value.version
    : boundedOptionalText(value.version, 80);
  if (!name || version === "") return null;
  const agentVersion = boundedOptionalText(value.agentVersion, 80);
  const extensions = value.extensions && typeof value.extensions === "object" && !Array.isArray(value.extensions)
    ? Object.fromEntries(Object.entries(value.extensions)
      .filter(([key, entry]) => (
        /^[A-Za-z0-9._/-]{1,120}$/.test(key)
        && Number.isSafeInteger(entry)
        && entry >= 0
        && entry <= 1_000_000
      ))
      .slice(0, 64))
    : {};
  return {
    name,
    version,
    ...(agentVersion ? { agentVersion } : {}),
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };
}

function normalizeCapabilityConstraints(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const switches = new Set(["turn-boundary", "session-boundary", "unsupported"]);
  const constraints = {
    ...(switches.has(value.modelSwitch) ? { modelSwitch: value.modelSwitch } : {}),
    ...(switches.has(value.modeSwitch) ? { modeSwitch: value.modeSwitch } : {}),
    ...(typeof value.forkRequiresIdle === "boolean" ? { forkRequiresIdle: value.forkRequiresIdle } : {}),
    ...(typeof value.compactionRequiresIdle === "boolean" ? { compactionRequiresIdle: value.compactionRequiresIdle } : {}),
  };
  return Object.keys(constraints).length > 0 ? constraints : null;
}

export function normalizeReferenceInputCapabilities(value, legacy = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyContext = legacy?.contextReferences === true;
  const legacyAttachments = legacy?.attachments === true;
  const workspace = record(source.workspace);
  const attachments = record(source.attachments);
  const limits = record(source.limits);
  const legacyMimeTypes = stringList(source.acceptedMimeTypes, isMimePattern);
  const legacyGenericAccepted = referenceTransportAccepted(source.genericFiles);
  return {
    schemaVersion: 1,
    workspace: {
      ...(workspace.crossRoots === true ? { crossRoots: true } : {}),
      files: workspace.files === true
        || (workspace.files === undefined && (source.workspaceFiles === true || (source.workspaceFiles === undefined && legacyContext))),
      directories: workspace.directories === true
        || (workspace.directories === undefined && (source.workspaceDirectories === true
          || (source.workspaceDirectories === undefined && legacyContext))),
    },
    attachments: {
      image: normalizeAttachmentCapability(attachments.image, {
        accepted: referenceTransportAccepted(source.images) || (source.images === undefined && legacyAttachments),
        mimeTypes: legacyMimeTypes,
      }),
      text: normalizeAttachmentCapability(attachments.text, { accepted: legacyGenericAccepted }),
      audio: normalizeAttachmentCapability(attachments.audio),
      video: normalizeAttachmentCapability(attachments.video),
      binary: normalizeAttachmentCapability(attachments.binary, { accepted: legacyGenericAccepted }),
    },
    limits: {
      maxCount: boundedPositiveInteger(limits.maxCount ?? source.maxReferences, 32, 32),
      maxBytesPerReference: boundedPositiveInteger(
        limits.maxBytesPerReference ?? source.maxReferenceBytes,
        25 * 1024 * 1024,
        25 * 1024 * 1024,
      ),
      maxTotalBytes: boundedPositiveInteger(
        limits.maxTotalBytes ?? source.maxTotalReferenceBytes,
        25 * 1024 * 1024,
        25 * 1024 * 1024,
      ),
    },
    steer: source.steer === true,
    attachmentOnly: source.attachmentOnly === true,
  };
}

function normalizeAttachmentCapability(value, fallback = {}) {
  const source = record(value);
  const mimeTypes = stringList(source.mimeTypes ?? fallback.mimeTypes, isMimePattern);
  const extensions = stringList(source.extensions ?? fallback.extensions, (entry) => /^\.[a-z0-9][a-z0-9._+-]{0,31}$/i.test(entry));
  return {
    accepted: source.accepted === true || (source.accepted === undefined && fallback.accepted === true),
    ...(mimeTypes.length > 0 ? { mimeTypes } : {}),
    ...(extensions.length > 0 ? { extensions } : {}),
    ...(Number.isSafeInteger(source.maxBytes) && source.maxBytes > 0 && source.maxBytes <= 25 * 1024 * 1024
      ? { maxBytes: source.maxBytes }
      : {}),
  };
}

function referenceTransportAccepted(value) {
  return ["data-url", "local-snapshot", "resource"].includes(value);
}

function isMimePattern(value) {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,79}\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,79})$/i.test(value);
}

function stringList(value, predicate) {
  return Array.isArray(value)
    ? Array.from(new Set(value
      .filter((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 160)
      .map((entry) => entry.trim().toLowerCase())
      .filter(predicate)))
      .slice(0, 64)
    : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedPositiveInteger(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function assertRuntimeDescriptor(value) {
  const descriptor = assertRecord(value, "runtime descriptor");
  assertRuntimeId(descriptor.id, "runtime descriptor.id");
  requiredString(descriptor.displayName, "runtime descriptor.displayName", 160);
  return value;
}

/** Project a trusted/native descriptor onto the bounded Renderer-safe DTO. */
export function sanitizeAgentRuntimeDescriptor(value) {
  const descriptor = assertRecord(value, "runtime descriptor");
  const id = assertRuntimeId(descriptor.id, "runtime descriptor.id");
  const displayName = requiredString(descriptor.displayName, "runtime descriptor.displayName", 160);
  const execution = sanitizeRuntimeExecution(descriptor.execution);
  const protocol = sanitizeRuntimeProtocol(descriptor.protocol);
  const integration = sanitizeRuntimeIntegration(descriptor.integration);
  const trust = sanitizeRuntimeTrust(descriptor.trust);
  const ownership = sanitizeRuntimeOwnership(descriptor.ownership);
  return {
    id,
    displayName,
    description: boundedOptionalText(descriptor.description, 2_000),
    kind: boundedOptionalText(descriptor.kind, 80) || "native",
    iconKey: boundedOptionalText(descriptor.iconKey, 80) || id,
    priority: Number.isSafeInteger(descriptor.priority) ? descriptor.priority : 0,
    ...(boundedOptionalText(descriptor.distribution, 80) ? { distribution: boundedOptionalText(descriptor.distribution, 80) } : {}),
    ...(boundedOptionalText(descriptor.version, 80) ? { version: boundedOptionalText(descriptor.version, 80) } : {}),
    ...(boundedOptionalText(descriptor.source, 80) ? { source: boundedOptionalText(descriptor.source, 80) } : {}),
    ...(boundedOptionalText(descriptor.compatibility, 120) ? { compatibility: boundedOptionalText(descriptor.compatibility, 120) } : {}),
    ...(execution ? { execution } : {}),
    ...(protocol ? { protocol } : {}),
    ...(integration ? { integration } : {}),
    ...(trust ? { trust } : {}),
    ...(ownership ? { ownership } : {}),
  };
}

function sanitizeRuntimeExecution(value) {
  if (!isObject(value)) return null;
  const kind = boundedOptionalText(value.kind, 80);
  const distribution = boundedOptionalText(value.distribution, 80);
  const controller = boundedOptionalText(value.controller, 80);
  return kind && distribution && controller ? { kind, distribution, controller } : null;
}

function sanitizeRuntimeProtocol(value) {
  if (!isObject(value)) return null;
  const kind = boundedOptionalText(value.kind, 80);
  const transport = boundedOptionalText(value.transport, 80);
  return kind && transport ? { kind, transport } : null;
}

function sanitizeRuntimeIntegration(value) {
  if (!isObject(value)) return null;
  const kind = boundedOptionalText(value.kind, 80);
  const adapter = boundedOptionalText(value.adapter, 80);
  return kind && adapter ? { kind, adapter } : null;
}

function sanitizeRuntimeTrust(value) {
  if (!isObject(value)) return null;
  const level = boundedOptionalText(value.level, 80);
  const publisher = boundedOptionalText(value.publisher, 160);
  return level && publisher ? { level, publisher } : null;
}

function sanitizeRuntimeOwnership(value) {
  if (!isObject(value)) return null;
  const harness = boundedOptionalText(value.harness, 80);
  const models = boundedOptionalText(value.models, 80);
  const session = boundedOptionalText(value.session, 80);
  const credentials = sanitizeOwnerList(value.credentials);
  const billing = sanitizeOwnerList(value.billing);
  return harness && models && session && credentials.length && billing.length
    ? { harness, credentials, models, billing, session }
    : null;
}

function sanitizeOwnerList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((entry) => boundedOptionalText(entry, 80))
    .filter(Boolean)))
    .slice(0, 8);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertAgentRuntimeReadiness(value) {
  const readiness = assertRecord(value, "runtime readiness");
  assertRuntimeId(readiness.runtimeId ?? readiness.provider, "runtime readiness.runtimeId");
  enumValue(readiness.status, "runtime readiness.status", ["not-installed", "installed-not-authenticated", "unsupported-version", "protocol-unavailable", "ready", "error"]);
  const code = enumValue(readiness.code, "runtime readiness.code", AGENT_READINESS_CODES);
  if (AGENT_READINESS_CODE_STATUS[code] !== readiness.status) {
    throw new TypeError(`runtime readiness.code ${code} is incompatible with status ${readiness.status}.`);
  }
  return value;
}

const assertReadiness = assertAgentRuntimeReadiness;

export function assertAgentModel(value) {
  const model = assertRecord(value, "Agent model");
  requiredString(model.id, "Agent model.id", 512);
  requiredString(model.model, "Agent model.model", 512);
  requiredString(model.displayName, "Agent model.displayName", 512);
  if (model.providerId !== undefined) requiredString(model.providerId, "Agent model.providerId", 160);
  if (model.modelId !== undefined) requiredString(model.modelId, "Agent model.modelId", 300);
  return value;
}

export function assertAgentInferenceProvider(value) {
  const provider = assertRecord(value, "Agent inference provider");
  requiredString(provider.id, "Agent inference provider.id", 160);
  requiredString(provider.displayName, "Agent inference provider.displayName", 160);
  if (provider.source !== undefined && provider.source !== null) requiredString(provider.source, "Agent inference provider.source", 40);
  if (provider.defaultModel !== undefined && provider.defaultModel !== null) requiredString(provider.defaultModel, "Agent inference provider.defaultModel", 512);
  if (!Number.isSafeInteger(provider.modelCount) || provider.modelCount < 0 || provider.modelCount > 500) {
    throw new TypeError("Agent inference provider.modelCount must be a bounded non-negative integer.");
  }
  return value;
}

function assertNamedEntry(value, label, idKey = "id") {
  const entry = assertRecord(value, `Agent ${label}`);
  requiredString(entry[idKey], `Agent ${label}.${idKey}`, 512);
  return value;
}

function boundedOptionalText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
