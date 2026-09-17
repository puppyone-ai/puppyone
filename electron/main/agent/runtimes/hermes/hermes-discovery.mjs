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

export const MINIMUM_HERMES_ACP_VERSION = "0.16.0";
const ACP_CHECK_TIMEOUT_MS = 8_000;
const ACP_CHECK_MAX_BYTES = 64 * 1024;

export function createHermesDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverHermesExecutable({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

export async function discoverHermesExecutable({
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
  const discovered = await discover({
    signal,
    installationId: "hermes",
    additionalCandidates: [configuredExecutable].filter(Boolean),
    fsModule,
    spawn,
    env,
    platform,
    homedir,
    readEnvironment,
    parseVersion: parseHermesVersion,
    minimumVersion: MINIMUM_HERMES_ACP_VERSION,
    label: "Hermes Agent",
    buildEnvironment: buildHermesEnvironment,
  });

  let readiness = discovered;
  if (discovered.status === "ready" && discovered.executablePath) {
    try {
      const protocolProbe = await probe(
        spawn,
        discovered.executablePath,
        [...(discovered.argsPrefix ?? []), "acp", "--check"],
        {
          signal,
          env: discovered.environment,
          timeoutMs: ACP_CHECK_TIMEOUT_MS,
          maxBytes: ACP_CHECK_MAX_BYTES,
          label: "Hermes ACP",
        },
      );
      const output = `${protocolProbe.stdout}\n${protocolProbe.stderr}`;
      if (protocolProbe.code !== 0 || !/Hermes ACP check OK/iu.test(output)) {
        readiness = {
          ...discovered,
          status: "protocol-unavailable",
          code: "PROTOCOL_UNAVAILABLE",
          message: "Hermes Agent is installed, but its official ACP dependencies are unavailable. Run `hermes acp --check` in a terminal.",
          diagnostic: output.trim().slice(0, 4_000),
        };
      }
    } catch (error) {
      signal?.throwIfAborted();
      readiness = {
        ...discovered,
        status: "protocol-unavailable",
        code: "PROTOCOL_PROBE_FAILED",
        message: "Hermes Agent could not verify its official ACP endpoint. Run `hermes acp --check` in a terminal.",
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    provider: "hermes",
    runtimeId: "hermes",
    source: discovered.executablePath ? "user-installed" : "missing",
    compatibility: readiness.status === "ready" ? "acp-v1" : "unavailable",
    ...readiness,
    selectable: readiness.status === "ready",
    message: redactSecretText(readiness.message),
    ...(readiness.diagnostic ? { diagnostic: redactSecretText(readiness.diagnostic) } : {}),
  };
}

export function parseHermesVersion(value) {
  return parseSemanticVersion(value);
}

export function buildHermesEnvironment(baseEnv, loginEnv, options) {
  return {
    ...buildAgentEnvironment(baseEnv, loginEnv, options),
    PUPPYONE_AGENT_BACKEND: "hermes",
  };
}

export const hermesDiscoveryLimits = Object.freeze({
  acpCheckTimeoutMs: ACP_CHECK_TIMEOUT_MS,
  acpCheckMaxBytes: ACP_CHECK_MAX_BYTES,
});
