import os from "node:os";
import fs from "node:fs";
import { redactSecretText } from "../../agent-events.mjs";
import { createCachedRuntimeDiscovery } from "../../connections/runtime-discovery-cache.mjs";
import { probeCursorLocal } from "../../connections/probes/cursor-local-probe.mjs";
import { createExecutableDiscoveryPort } from "../../../platform/common/executable-discovery-port.mjs";
import { createLocalAgentExecutableResolver } from "../../../local-agent-installation/executable-resolver.mjs";

export function createCursorDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverCursorBackend({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

export async function discoverCursorBackend({
  signal,
  fsModule = fs,
  env = process.env,
  homedir = os.homedir(),
  platform = process.platform,
  readEnvironment,
  resolveCandidate = async () => {
    const resolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({ env, fsModule, homedir, nodePlatform: platform, readEnvironment }),
    });
    const context = await resolver.createContext({ signal });
    const result = await resolver.resolve("cursor", { context });
    if (result.status === "failed") throw new Error(result.reasonCode);
    return result.status === "found" ? result.candidate : null;
  },
  probe = probeCursorLocal,
} = {}) {
  signal?.throwIfAborted();
  const candidate = await resolveCandidate();
  const environment = candidate?.environment ?? env;
  const result = await probe({ candidate, env: environment, signal });
  const base = {
    runtimeId: "cursor",
    provider: "cursor",
    version: result.version ?? null,
    minimumVersion: null,
    executablePath: candidate?.executablePath ?? null,
    argsPrefix: candidate?.argsPrefix ?? [],
    environment,
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
