import { LOCAL_AGENT_INSTALLATION_IDS } from "../../../shared/local-agent-installation/schema.mjs";
import { claudeInstallationDefinition } from "./definitions/claude.mjs";
import { codexInstallationDefinition } from "./definitions/codex.mjs";
import { cursorInstallationDefinition } from "./definitions/cursor.mjs";
import { hermesInstallationDefinition } from "./definitions/hermes.mjs";
import { opencodeInstallationDefinition } from "./definitions/opencode.mjs";
import { piInstallationDefinition } from "./definitions/pi.mjs";
import {
  workBuddyChinaInstallationDefinition,
  workBuddyInternationalInstallationDefinition,
} from "./definitions/workbuddy.mjs";

const DEFAULT_DEFINITIONS = Object.freeze([
  codexInstallationDefinition,
  claudeInstallationDefinition,
  cursorInstallationDefinition,
  opencodeInstallationDefinition,
  piInstallationDefinition,
  workBuddyChinaInstallationDefinition,
  workBuddyInternationalInstallationDefinition,
  hermesInstallationDefinition,
]);

export function createLocalAgentInstallationRegistry(definitions = DEFAULT_DEFINITIONS) {
  const seen = new Set();
  const normalized = Array.from(definitions, (definition) => {
    validateDefinition(definition);
    if (seen.has(definition.id)) throw new Error(`Duplicate Local Agent installation id: ${definition.id}`);
    seen.add(definition.id);
    return deepFreeze({
      id: definition.id,
      displayName: definition.displayName.trim(),
      executableNames: [...definition.executableNames],
      ...(definition.searchPath === false ? { searchPath: false } : {}),
      ...(definition.candidatePaths ? { candidatePaths: definition.candidatePaths } : {}),
      ...(definition.identityPolicy ? { identityPolicy: { ...definition.identityPolicy } } : {}),
    });
  });
  return Object.freeze(normalized);
}

export function getLocalAgentInstallationDefinition(agentId, registry = defaultLocalAgentInstallationRegistry) {
  return registry.find(({ id }) => id === agentId) ?? null;
}

function validateDefinition(definition) {
  if (!definition || !LOCAL_AGENT_INSTALLATION_IDS.includes(definition.id)) {
    throw new TypeError("Local Agent installation definition id is invalid.");
  }
  if (typeof definition.displayName !== "string" || !definition.displayName.trim()) {
    throw new TypeError(`Local Agent ${definition.id} requires a display name.`);
  }
  if (!Array.isArray(definition.executableNames) || definition.executableNames.length === 0
    || definition.executableNames.length > 8
    || definition.executableNames.some((entry) => (
      typeof entry !== "string" && (!entry || typeof entry.fileName !== "string")
    ))) {
    throw new TypeError(`Local Agent ${definition.id} requires executable names.`);
  }
  if (definition.candidatePaths !== undefined && typeof definition.candidatePaths !== "function") {
    throw new TypeError(`Local Agent ${definition.id} candidatePaths must be a function.`);
  }
  if (definition.searchPath !== undefined && typeof definition.searchPath !== "boolean") {
    throw new TypeError(`Local Agent ${definition.id} searchPath must be a boolean.`);
  }
  validateIdentityPolicy(definition);
}

function validateIdentityPolicy(definition) {
  if (definition.identityPolicy === undefined) return;
  if (!definition.identityPolicy || typeof definition.identityPolicy !== "object") {
    throw new TypeError(`Local Agent ${definition.id} identity policy is invalid.`);
  }
  for (const field of ["requiredForInvocations", "packageNames", "pathFragments", "fileMarkers"]) {
    const values = definition.identityPolicy[field] ?? [];
    if (!Array.isArray(values) || values.length > 8 || values.some((value) => (
      typeof value !== "string" || value.length === 0 || value.length > 160
    ))) throw new TypeError(`Local Agent ${definition.id} identityPolicy.${field} is invalid.`);
  }
  const invocations = new Set(definition.executableNames.map((entry) => (
    typeof entry === "object" ? String(entry.invokedAs || entry.fileName) : String(entry)
  )));
  if ((definition.identityPolicy.requiredForInvocations ?? []).some((value) => !invocations.has(value))) {
    throw new TypeError(`Local Agent ${definition.id} identity policy references an unknown invocation.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const defaultLocalAgentInstallationRegistry = createLocalAgentInstallationRegistry();
