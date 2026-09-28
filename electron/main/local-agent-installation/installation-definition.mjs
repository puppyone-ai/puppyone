import { LOCAL_AGENT_INSTALLATION_IDS } from "../../../shared/local-agent-installation/schema.mjs";

export function defineLocalAgentInstallation(definition) {
  validateDefinition(definition);
  return deepFreeze({
    id: definition.id,
    displayName: definition.displayName.trim(),
    executableNames: [...definition.executableNames],
    ...(definition.registeredApplicationNames
      ? { registeredApplicationNames: [...definition.registeredApplicationNames] }
      : {}),
    ...(definition.searchPath === false ? { searchPath: false } : {}),
    ...(definition.candidatePaths ? { candidatePaths: definition.candidatePaths } : {}),
    ...(definition.identityPolicy ? { identityPolicy: { ...definition.identityPolicy } } : {}),
  });
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
  if (definition.registeredApplicationNames !== undefined && (
    !Array.isArray(definition.registeredApplicationNames)
    || definition.registeredApplicationNames.length === 0
    || definition.registeredApplicationNames.length > 8
    || definition.registeredApplicationNames.some((entry) => (
      typeof entry !== "string"
      || !/^[A-Za-z0-9 ._-]+\.exe$/u.test(entry)
      || entry.length > 120
    ))
  )) {
    throw new TypeError(`Local Agent ${definition.id} registeredApplicationNames must contain safe Windows application names.`);
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
  if (definition.identityPolicy.manifest !== undefined) {
    const manifest = definition.identityPolicy.manifest;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || !Number.isInteger(manifest.parentDepth) || manifest.parentDepth < 0 || manifest.parentDepth > 4
      || typeof manifest.fileName !== "string" || !/^[A-Za-z0-9._-]{1,80}$/u.test(manifest.fileName)
      || typeof manifest.property !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(manifest.property)
      || !Array.isArray(manifest.values) || manifest.values.length === 0 || manifest.values.length > 8
      || manifest.values.some((value) => typeof value !== "string" || value.length === 0 || value.length > 160)) {
      throw new TypeError(`Local Agent ${definition.id} identityPolicy.manifest is invalid.`);
    }
  }
  const invocations = new Set(definition.executableNames.map((entry) => (
    typeof entry === "object" ? String(entry.invokedAs || entry.fileName) : String(entry)
  )));
  if ((definition.identityPolicy.requiredForInvocations ?? []).some((value) => !invocations.has(value))) {
    throw new TypeError(`Local Agent ${definition.id} identity policy references an unknown invocation.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
