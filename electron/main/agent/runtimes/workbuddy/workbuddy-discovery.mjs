import fs from "node:fs";
import os from "node:os";
import { spawn as nodeSpawn } from "node:child_process";
import { redactSecretText } from "../../agent-events.mjs";
import { createCachedRuntimeDiscovery } from "../../connections/runtime-discovery-cache.mjs";
import {
  buildAgentEnvironment,
  discoverExecutable,
  parseSemanticVersion,
  runBounded,
} from "../../transports/executable-discovery.mjs";
import { WORKBUDDY_HOST_ENVIRONMENT } from "./workbuddy-environment.mjs";

const ACP_PROBE_TIMEOUT_MS = 4_000;
const ACP_PROBE_MAX_BYTES = 64 * 1024;

export function createWorkBuddyDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverWorkBuddyExecutable({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

export async function discoverWorkBuddyExecutable({
  signal,
  fsModule = fs,
  spawn = nodeSpawn,
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  readEnvironment,
  configuredExecutable = null,
  discover = discoverExecutable,
  probe = runBounded,
} = {}) {
  const result = await discover({
    signal,
    installationId: "workbuddy",
    additionalCandidates: [configuredExecutable].filter(Boolean),
    fsModule,
    spawn,
    env,
    platform,
    homedir,
    readEnvironment,
    parseVersion: parseWorkBuddyVersion,
    minimumVersion: null,
    label: "WorkBuddy",
    buildEnvironment: buildWorkBuddyEnvironment,
    buildProbeEnvironment: workBuddyProbeEnvironment,
  });

  let readiness = result;
  if (result.status === "ready" && result.executablePath) {
    try {
      const protocolProbe = await probe(spawn, result.executablePath, ["--help"], {
        signal,
        env: workBuddyProbeEnvironment(result.environment),
        timeoutMs: ACP_PROBE_TIMEOUT_MS,
        maxBytes: ACP_PROBE_MAX_BYTES,
        label: "WorkBuddy ACP",
      });
      const help = `${protocolProbe.stdout}\n${protocolProbe.stderr}`;
      if (protocolProbe.code !== 0 || !/(?:^|\s)--acp(?:\s|,|$)/mu.test(help)) {
        readiness = {
          ...result,
          status: "protocol-unavailable",
          code: "PROTOCOL_UNAVAILABLE",
          message: "This WorkBuddy installation does not expose a usable Agent Client Protocol endpoint.",
          diagnostic: help.trim().slice(0, 4_000),
        };
      }
    } catch (error) {
      signal?.throwIfAborted();
      readiness = {
        ...result,
        status: "protocol-unavailable",
        code: "PROTOCOL_PROBE_FAILED",
        message: "This WorkBuddy installation could not verify its Agent Client Protocol endpoint.",
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    provider: "workbuddy",
    runtimeId: "workbuddy",
    source: result.executablePath ? "user-installed" : "missing",
    compatibility: readiness.status === "ready" ? "acp-v1" : "unavailable",
    ...readiness,
    selectable: readiness.status === "ready",
    message: redactSecretText(readiness.message),
    ...(readiness.diagnostic ? { diagnostic: redactSecretText(readiness.diagnostic) } : {}),
  };
}

export function parseWorkBuddyVersion(value) {
  return parseSemanticVersion(value);
}

export function buildWorkBuddyEnvironment(baseEnv, loginEnv, options) {
  return {
    ...buildAgentEnvironment(baseEnv, loginEnv, options),
    ...WORKBUDDY_HOST_ENVIRONMENT,
    PUPPYONE_AGENT_BACKEND: "workbuddy",
  };
}

function workBuddyProbeEnvironment(environment) {
  return { ...environment, CODEBUDDY_DISABLE_COMPILE_CACHE: "1" };
}

export const workBuddyDiscoveryLimits = Object.freeze({
  acpProbeTimeoutMs: ACP_PROBE_TIMEOUT_MS,
  acpProbeMaxBytes: ACP_PROBE_MAX_BYTES,
});
