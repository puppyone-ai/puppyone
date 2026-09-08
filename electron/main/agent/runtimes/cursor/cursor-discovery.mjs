import os from "node:os";
import { redactSecretText } from "../../agent-events.mjs";
import { createCachedRuntimeDiscovery } from "../../connections/runtime-discovery-cache.mjs";
import { probeCursorLocal } from "../../connections/probes/cursor-local-probe.mjs";
import { resolveFirstExecutable } from "../../connections/probes/executable-candidates.mjs";

export function createCursorDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverCursorBackend({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

export async function discoverCursorBackend({
  signal,
  env = process.env,
  homedir = os.homedir(),
  platform = process.platform,
  resolveCandidate = () => resolveFirstExecutable({
    names: ["cursor-agent", "agent", "cursor agent"],
    env,
    homedir,
    platform,
  }),
  probe = probeCursorLocal,
} = {}) {
  signal?.throwIfAborted();
  const candidate = await resolveCandidate();
  const result = await probe({ candidate, env, signal });
  const base = {
    runtimeId: "cursor",
    provider: "cursor",
    version: result.version ?? null,
    minimumVersion: null,
    executablePath: candidate?.executablePath ?? null,
    argsPrefix: candidate?.argsPrefix ?? [],
    environment: {},
    source: result.source ?? (candidate ? "user-installed" : "missing"),
    compatibility: "acp-v1",
  };
  if (result.installation === "not-found") {
    return {
      ...base,
      status: "not-installed",
      code: "RUNTIME_NOT_INSTALLED",
      message: "Cursor Agent was not found.",
    };
  }
  if (result.installation !== "detected") {
    return {
      ...base,
      status: "error",
      code: "RUNTIME_DISCOVERY_FAILED",
      message: "Cursor Agent was detected, but its installation could not be inspected safely.",
      ...(result.diagnostic ? { diagnostic: redactSecretText(result.diagnostic) } : {}),
    };
  }
  if (result.authentication === "signed-out") {
    return {
      ...base,
      status: "installed-not-authenticated",
      code: "AUTHENTICATION_REQUIRED",
      selectable: false,
      message: "Cursor Agent is installed; sign in with Cursor before starting its ACP Agent.",
    };
  }
  if (result.authentication === "expired") {
    return {
      ...base,
      status: "installed-not-authenticated",
      code: "AUTHENTICATION_EXPIRED",
      selectable: false,
      message: "Cursor Agent's local sign-in has expired. Sign in again, then retry.",
    };
  }
  if (result.authentication === "error") {
    const probeCode = result.authenticationFailure === "crashed"
      ? "AUTHENTICATION_PROBE_CRASHED"
      : result.authenticationFailure === "timed-out"
        ? "AUTHENTICATION_PROBE_TIMED_OUT"
        : "AUTHENTICATION_PROBE_FAILED";
    const probeMessage = result.authenticationFailure === "crashed"
      ? "Cursor Agent's sign-in command crashed before it could report the authentication state."
      : result.authenticationFailure === "timed-out"
        ? "Cursor Agent's sign-in command timed out before it could report the authentication state."
        : "Cursor Agent's sign-in command failed, so PuppyOne could not verify the authentication state.";
    return {
      ...base,
      status: "error",
      code: probeCode,
      selectable: false,
      inspectionFallback: "runtime-handshake",
      message: probeMessage,
      ...(result.authenticationDiagnostic ? { diagnostic: redactSecretText(result.authenticationDiagnostic) } : {}),
    };
  }
  if (result.authentication !== "signed-in") {
    return {
      ...base,
      status: "error",
      code: "AUTHENTICATION_STATUS_UNKNOWN",
      selectable: false,
      inspectionFallback: "runtime-handshake",
      message: "Cursor Agent returned an unrecognized sign-in status.",
      ...(result.authenticationDiagnostic ? { diagnostic: redactSecretText(result.authenticationDiagnostic) } : {}),
    };
  }
  return {
    ...base,
    status: "ready",
    code: "READY",
    selectable: true,
    message: `Cursor Agent ${result.version ?? ""} is ready through ACP.`.trim(),
  };
}
