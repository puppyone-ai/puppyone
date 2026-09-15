import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { redactSecretText } from "../../agent-events.mjs";
import { createCachedRuntimeDiscovery } from "../../connections/runtime-discovery-cache.mjs";
import {
  buildAgentEnvironment,
  discoverExecutable,
  runBounded,
} from "../../transports/executable-discovery.mjs";

export const CLAUDE_AGENT_SDK_VERSION = "0.3.159";
// Compatibility is verified through the official SDK initialization handshake.
// A version floor would reject working native installations without proving a
// protocol incompatibility, which is exactly the failure the adapter layer is
// intended to avoid.
export const CLAUDE_CODE_TESTED_BASELINE = null;

export function createClaudeDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverClaudeRuntime({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

export async function discoverClaudeRuntime({
  signal,
  fsModule = fs,
  spawn = nodeSpawn,
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  tmpdir = os.tmpdir(),
  sdkLoader = () => import("@anthropic-ai/claude-agent-sdk"),
} = {}) {
  try {
    const sdk = await sdkLoader();
    if (typeof sdk?.query !== "function") {
      throw new Error("Claude Agent SDK is incomplete.");
    }
  } catch (error) {
    return {
      runtimeId: "claude",
      provider: "claude",
      status: "error",
      code: "RUNTIME_DISCOVERY_FAILED",
      version: null,
      minimumVersion: CLAUDE_CODE_TESTED_BASELINE,
      sdkVersion: CLAUDE_AGENT_SDK_VERSION,
      executablePath: null,
      environment: buildAgentEnvironment(env, {}),
      source: "missing",
      compatibility: "unavailable",
      message: redactSecretText(`Claude Agent SDK is unavailable: ${error instanceof Error ? error.message : String(error)}`),
    };
  }

  let probeDirectory = null;
  let local;
  try {
    local = await discoverExecutable({
      signal,
      installationId: "claude",
      fsModule,
      spawn,
      env,
      platform,
      homedir,
      parseVersion: parseClaudeVersion,
      minimumVersion: CLAUDE_CODE_TESTED_BASELINE,
      label: "Claude Code",
      buildEnvironment: buildAgentEnvironment,
      buildProbeEnvironment: async (runtimeEnvironment) => {
        probeDirectory = await fsModule.promises.mkdtemp(
          path.join(tmpdir, "puppyone-claude-version-probe-"),
        );
        return {
          ...runtimeEnvironment,
          CLAUDE_CONFIG_DIR: probeDirectory,
        };
      },
      // Explicit GUI-safe candidates cover NVM/Volta/asdf installs without
      // executing the user's interactive shell during application startup.
      loadLoginShellEnvironment: false,
    });
  } finally {
    try {
      if (probeDirectory) {
        await fsModule.promises.rm(probeDirectory, { recursive: true, force: true });
      }
    } catch {
      // Probe cleanup is best-effort and must never hide the discovery result.
    }
  }
  let compatible = local;
  if (local.status === "ready" && local.executablePath) {
    let capabilityProbeDirectory = null;
    try {
      capabilityProbeDirectory = await fsModule.promises.mkdtemp(
        path.join(tmpdir, "puppyone-claude-capability-probe-"),
      );
      const probe = await runBounded(spawn, local.executablePath, ["--help"], {
        signal,
        env: { ...local.environment, CLAUDE_CONFIG_DIR: capabilityProbeDirectory },
        timeoutMs: 4_000,
        maxBytes: 64 * 1024,
        label: "Claude Code Agent SDK capability",
      });
      const help = `${probe.stdout}\n${probe.stderr}`;
      if (probe.code !== 0 || !hasSecureSdkCapabilities(help)) {
        compatible = {
          ...local,
          status: "protocol-unavailable",
          code: "PROTOCOL_UNAVAILABLE",
          message: "Claude Code is installed, but this build does not expose the secure streaming controls required by the official Agent SDK.",
          diagnostic: "Required native capabilities: streaming JSON input/output and setting-source isolation.",
        };
      }
    } catch (error) {
      compatible = {
        ...local,
        status: "protocol-unavailable",
        code: "PROTOCOL_PROBE_FAILED",
        message: "Claude Code is installed, but its official Agent SDK capabilities could not be verified.",
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (capabilityProbeDirectory) {
        await fsModule.promises.rm(capabilityProbeDirectory, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  const useLocal = compatible.status === "ready";
  const hasLocalExecutable = Boolean(local.executablePath);
  return {
    runtimeId: "claude",
    provider: "claude",
    ...compatible,
    status: compatible.status,
    version: local.version,
    minimumVersion: CLAUDE_CODE_TESTED_BASELINE,
    sdkVersion: CLAUDE_AGENT_SDK_VERSION,
    executablePath: local.executablePath,
    source: hasLocalExecutable ? "user-installed" : "missing",
    compatibility: useLocal ? "native-sdk-local-cli" : "unavailable",
    message: useLocal
      ? `Claude Code ${local.version} is ready for the official Agent SDK compatibility handshake.`
      : compatible.status === "not-installed"
        ? "Claude Code was not found. Install the native Claude Code product, configure an API key or supported cloud provider, then refresh."
        : redactSecretText(compatible.message),
    ...(compatible.diagnostic ? { diagnostic: redactSecretText(compatible.diagnostic) } : {}),
  };
}

function hasSecureSdkCapabilities(value) {
  const help = String(value);
  return help.includes("--input-format")
    && help.includes("--output-format")
    && help.includes("--setting-sources")
    && help.includes("--permission-mode");
}

export function parseClaudeVersion(value) {
  for (const line of String(value).split(/\r?\n/u)) {
    const match = /^(?:claude(?:\s+code)?\s+)?v?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?$/iu.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}
