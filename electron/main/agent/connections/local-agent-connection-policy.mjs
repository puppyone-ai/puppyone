const SAFE_SOURCES = new Set([
  "configured", "user-installation", "system-installation", "path-installation", "application-bundle",
]);

export function deriveLocalConnection(probe, gates = {}) {
  const installation = normalizeInstallation(probe?.installation);
  const authentication = normalizeAuthentication(probe?.authentication);
  const version = safeVersion(probe?.version);
  const ready = isConnectionReady(probe, gates, installation, authentication);
  const integration = deriveIntegration({
    ready, installation, authentication, protocolCompatible: probe?.protocolCompatible,
  });

  return {
    id: normalizeId(probe?.id),
    displayName: safeText(probe?.displayName, "Local Agent", 80),
    installation,
    version,
    authentication,
    integration,
    capabilities: {
      versionProbe: Boolean(version),
      authenticationProbe: authentication !== "unknown",
      protocolProbe: probe?.protocolCompatible === true,
    },
    selectable: integration === "ready",
    statusMessage: statusMessage({
      displayName: probe?.displayName,
      installation,
      authentication,
      version,
      unavailableMessage: probe?.unavailableMessage,
      protocolCompatible: probe?.protocolCompatible === true,
      hasModels: probe?.hasModels === true,
      ready,
    }),
    actions: actionsFor(installation),
    ...(SAFE_SOURCES.has(probe?.source) ? { source: probe.source } : {}),
  };
}

function isConnectionReady(probe, gates, installation, authentication) {
  // Omitted gates preserve the legacy default: only explicit false denies admission.
  return installation === "detected"
    && authentication === "signed-in"
    && probe?.protocolCompatible === true
    && probe?.hasModels === true
    && gates.backendRegistered !== false
    && gates.workspaceAllowed !== false;
}

function deriveIntegration({ ready, installation, authentication, protocolCompatible }) {
  if (ready) return "ready";
  if (installation === "unsupported") return "incompatible";
  if (installation === "broken") return "blocked";
  if (installation !== "detected") return "inventory-only";
  if (protocolCompatible !== true) return "protocol-unavailable";
  if (authentication === "error" || authentication === "unknown") return "blocked";
  return "setup-required";
}

function statusMessage({ displayName, installation, authentication, version, unavailableMessage, protocolCompatible, hasModels, ready }) {
  const label = safeText(displayName, "Local Agent", 80);
  const suffix = version ? ` ${version}` : "";
  if (installation === "not-found") return `${label} was not found in known installation locations.`;
  if (installation === "unsupported") return `${label}${suffix} is older than the tested compatibility baseline.`;
  if (installation === "broken") return `${label} was detected, but its version or status probe could not be completed safely.`;
  if (!protocolCompatible) return `${label}${suffix} is detected. ${safeText(unavailableMessage, "This PuppyOne build does not support its native Agent protocol.", 256)}`;
  if (authentication === "signed-out") return `${label}${suffix} is detected but requires sign-in. Refresh after signing in with its documented CLI flow.`;
  if (authentication === "expired") return `${label}${suffix} is detected, but its local session has expired.`;
  if (authentication === "error") return `${label}${suffix} is detected, but its authentication state could not be read.`;
  if (authentication === "unknown") return `${label}${suffix} is detected, but its authentication status was not recognized.`;
  if (!hasModels) return `${label}${suffix} is detected, but no compatible text-and-tools model is available.`;
  if (ready) return `${label}${suffix} is ready for native Agent sessions.`;
  return `${label}${suffix} is detected but is not enabled for this workspace.`;
}

function actionsFor(installation) {
  if (installation === "not-found") return [{ id: "learn-more", label: "Learn more" }];
  return [
    { id: "refresh", label: "Refresh" },
    { id: "learn-more", label: "Learn why" },
  ];
}

function normalizeInstallation(value) {
  return ["not-found", "detected", "unsupported", "broken"].includes(value) ? value : "broken";
}

function normalizeAuthentication(value) {
  return ["unknown", "signed-out", "signed-in", "expired", "error"].includes(value) ? value : "unknown";
}

function normalizeId(value) {
  const normalized = String(value || "local-agent").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized) ? normalized : "local-agent";
}

function safeVersion(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= 80 && /^[A-Za-z0-9._+-]+$/.test(normalized) ? normalized : null;
}

function safeText(value, fallback, limit) {
  const normalized = typeof value === "string" ? value.replace(/[\r\n\0]+/g, " ").trim() : "";
  return (normalized || fallback).slice(0, limit);
}
