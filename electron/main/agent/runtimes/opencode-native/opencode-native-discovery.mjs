import fs from "node:fs";
import os from "node:os";
import { spawn as nodeSpawn } from "node:child_process";
import { redactSecretText } from "../../agent-events.mjs";
import { createCachedRuntimeDiscovery } from "../../connections/runtime-discovery-cache.mjs";
import {
  buildAgentEnvironment,
  discoverExecutable,
  runBounded,
} from "../../transports/executable-discovery.mjs";
import {
  parseOpenCodeVersion,
} from "../opencode-protocol/opencode-version.mjs";
import { OPEN_CODE_HOST_SAFETY_ENVIRONMENT } from "../opencode-protocol/opencode-security-policy.mjs";

export function createUserOpenCodeDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverUserOpenCodeExecutable({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

export async function discoverUserOpenCodeExecutable({
  signal,
  fsModule = fs,
  spawn = nodeSpawn,
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  readEnvironment,
  configuredExecutable = null,
} = {}) {
  const result = await discoverExecutable({
    signal,
    installationId: "opencode",
    additionalCandidates: [configuredExecutable].filter(Boolean),
    fsModule,
    spawn,
    env,
    platform,
    homedir,
    readEnvironment,
    parseVersion: parseOpenCodeVersion,
    minimumVersion: null,
    label: "OpenCode",
    buildEnvironment: buildUserOpenCodeEnvironment,
  });
  let readiness = result;
  if (result.status === "ready" && result.executablePath) {
    try {
      const probe = await runBounded(spawn, result.executablePath, ["acp", "--help"], {
        signal,
        env: result.environment,
        timeoutMs: 4_000,
        maxBytes: 64 * 1024,
        label: "OpenCode ACP",
      });
      if (probe.code !== 0) {
        readiness = {
          ...result,
          status: "protocol-unavailable",
          code: "PROTOCOL_UNAVAILABLE",
          message: "This OpenCode installation does not expose a usable Agent Client Protocol endpoint.",
          diagnostic: `${probe.stdout}\n${probe.stderr}`.trim().slice(0, 4_000),
        };
      }
    } catch (error) {
      readiness = {
        ...result,
        status: "protocol-unavailable",
        code: "PROTOCOL_PROBE_FAILED",
        message: "This OpenCode installation could not start its Agent Client Protocol endpoint.",
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    provider: "opencode-native",
    runtimeId: "opencode-native",
    source: result.executablePath ? "user-installed" : "missing",
    compatibility: readiness.status === "ready" ? "acp-v1" : "unavailable",
    ...readiness,
    message: redactSecretText(readiness.message),
    ...(readiness.diagnostic ? { diagnostic: redactSecretText(readiness.diagnostic) } : {}),
  };
}

export function buildUserOpenCodeEnvironment(baseEnv, loginEnv, options) {
  const environment = buildAgentEnvironment(baseEnv, loginEnv, options);
  // Preserve the user's explicit OpenCode profile, auth and provider
  // environment. PuppyOne Agent's managed profile exists only in its own
  // child environment, so this independently constructed map never inherits
  // it from that sibling backend.
  environment.OPENCODE_CLIENT = "puppyone-desktop-native";
  environment.PUPPYONE_AGENT_BACKEND = "opencode-native";
  Object.assign(environment, OPEN_CODE_HOST_SAFETY_ENVIRONMENT);
  return environment;
}
