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

export function createPiDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(({ signal }) => discoverPiExecutable({ ...discoveryOptions, signal }), cacheOptions);
}

export async function discoverPiExecutable({
  signal,
  fsModule = fs,
  spawn = nodeSpawn,
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  configuredExecutable = null,
} = {}) {
  const result = await discoverExecutable({
    signal,
    installationId: "pi",
    additionalCandidates: [configuredExecutable].filter(Boolean),
    fsModule,
    spawn,
    env,
    platform,
    homedir,
    parseVersion: (value) => parseSemanticVersion(value),
    minimumVersion: null,
    label: "Pi",
    buildEnvironment: buildAgentEnvironment,
  });
  let readiness = result;
  if (result.status === "ready" && result.executablePath) {
    try {
      const probe = await runBounded(spawn, result.executablePath, ["--help"], {
        signal,
        env: result.environment,
        timeoutMs: 4_000,
        maxBytes: 64 * 1024,
        label: "Pi RPC",
      });
      const output = `${probe.stdout}\n${probe.stderr}`;
      if (probe.code !== 0 || !/AI coding assistant/iu.test(output) || !/--mode\s+<mode>/u.test(output) || !/rpc/iu.test(output)) {
        readiness = {
          ...result,
          status: "protocol-unavailable",
          code: "PROTOCOL_UNAVAILABLE",
          message: "This Pi installation does not expose its official RPC mode.",
          diagnostic: output.trim().slice(0, 4_000),
        };
      }
    } catch (error) {
      readiness = {
        ...result,
        status: "protocol-unavailable",
        code: "PROTOCOL_PROBE_FAILED",
        message: "Pi's RPC capability could not be inspected safely.",
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    provider: "pi",
    runtimeId: "pi",
    source: result.executablePath ? "user-installed" : "missing",
    compatibility: readiness.status === "ready" ? "pi-rpc-v1" : "unavailable",
    ...readiness,
    message: redactSecretText(readiness.message),
    ...(readiness.diagnostic ? { diagnostic: redactSecretText(readiness.diagnostic) } : {}),
  };
}
