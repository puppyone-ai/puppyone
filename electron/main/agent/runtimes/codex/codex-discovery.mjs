import fs from "node:fs";
import os from "node:os";
import { spawn as nodeSpawn } from "node:child_process";
import { redactSecretText } from "../../agent-events.mjs";
import { createCachedRuntimeDiscovery } from "../../connections/runtime-discovery-cache.mjs";
import {
  buildAgentEnvironment,
  compareVersions,
  discoverExecutable,
  parseSemanticVersion,
  readLoginShellEnvironment,
} from "../../transports/executable-discovery.mjs";

// This is the oldest app-server schema exercised by the checked-in protocol
// fixture. Versions below this floor are not advertised as compatible.
export const MIN_SUPPORTED_CODEX_VERSION = "0.144.1";

export function createCodexDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverCodexExecutable({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

export async function discoverCodexExecutable({
  signal,
  fsModule = fs,
  spawn = nodeSpawn,
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
} = {}) {
  const result = await discoverExecutable({
    signal,
    installationId: "codex",
    fsModule,
    spawn,
    env,
    platform,
    homedir,
    parseVersion: parseCodexVersion,
    minimumVersion: MIN_SUPPORTED_CODEX_VERSION,
    label: "Codex",
    buildEnvironment: buildProviderEnvironment,
  });
  return {
    provider: "codex",
    runtimeId: "codex",
    ...result,
    message: redactSecretText(result.message),
    ...(result.diagnostic ? { diagnostic: redactSecretText(result.diagnostic) } : {}),
  };
}

export function parseCodexVersion(value) {
  return parseSemanticVersion(value, "codex(?:-cli)?");
}

export { compareVersions, readLoginShellEnvironment };

export function buildProviderEnvironment(baseEnv, loginEnv, options) {
  return buildAgentEnvironment(baseEnv, loginEnv, options);
}
