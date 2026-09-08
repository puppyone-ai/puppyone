import { nativeSessionId } from "../../../../shared/agent-contract/native-session-id.mjs";
const DISCOVERY_KINDS = new Set(["unsupported", "paged"]);
const EXACT_OPEN_KINDS = new Set(["unsupported", "supported"]);
const HYDRATION_KINDS = new Set(["unsupported", "push-replay", "snapshot", "paged"]);

/** Resolves the optional History method group without inspecting adapter brands. */
export function resolveAgentSessionHistoryPort(adapter) {
  if (!adapter || typeof adapter.getSessionHistoryPort !== "function") return null;
  const port = adapter.getSessionHistoryPort();
  if (!port || typeof port !== "object" || Array.isArray(port)) {
    throw new TypeError("Agent SessionHistoryPort must be an object.");
  }
  if (port.sourceScopeId != null && !nativeSessionId(port.sourceScopeId)) throw new TypeError("Agent History source identity is invalid.");
  return port;
}

/**
 * Keeps the negotiated capability profile and executable method group honest.
 * History is optional, but an advertised operation can never be half-present.
 */
export function assertAgentSessionHistoryCapabilities(adapter, capabilities, runtimeId = "unknown") {
  const profile = capabilities?.history;
  if (!profile) return capabilities;
  if (!DISCOVERY_KINDS.has(profile.discovery)) {
    throw new TypeError(`Agent runtime ${runtimeId} has an invalid History discovery capability.`);
  }
  if (!EXACT_OPEN_KINDS.has(profile.exactOpen)) {
    throw new TypeError(`Agent runtime ${runtimeId} has an invalid History exact-open capability.`);
  }
  if (!HYDRATION_KINDS.has(profile.hydration)) {
    throw new TypeError(`Agent runtime ${runtimeId} has an invalid History hydration capability.`);
  }

  const port = resolveAgentSessionHistoryPort(adapter);
  if (profile.discovery === "paged" && typeof port?.discover !== "function") {
    throw new TypeError(`Agent runtime ${runtimeId} advertises paged History discovery but has no SessionHistoryPort.discover().`);
  }
  if (profile.exactOpen === "supported" && (!capabilities.resume || typeof adapter.resumeSession !== "function")) {
    throw new TypeError(`Agent runtime ${runtimeId} advertises exact History open without native resume support.`);
  }
  if (profile.hydration !== "unsupported" && typeof port?.hydrate !== "function") {
    throw new TypeError(`Agent runtime ${runtimeId} advertises History hydration but has no SessionHistoryPort.hydrate().`);
  }

  const supported = profile.discovery !== "unsupported"
    || profile.exactOpen !== "unsupported"
    || profile.hydration !== "unsupported";
  if (capabilities.sessionHistory !== supported) {
    throw new TypeError(`Agent runtime ${runtimeId} has an inconsistent sessionHistory compatibility projection.`);
  }
  return capabilities;
}
