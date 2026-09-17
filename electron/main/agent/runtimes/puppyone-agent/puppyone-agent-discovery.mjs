import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { redactSecretText } from "../../agent-events.mjs";
import { createCachedRuntimeDiscovery } from "../../connections/runtime-discovery-cache.mjs";
import { runBounded } from "../../transports/executable-discovery.mjs";
import { PUPPYONE_AGENT_RUNTIME_ID } from "./puppyone-agent-identity.mjs";
import { buildPuppyOneAgentEnvironment } from "./puppyone-agent-environment.mjs";
import { PUPPYONE_PI_KERNEL } from "./puppyone-agent-kernel.mjs";
import { WORKSPACE_AGENT_DISPLAY_NAME } from "./puppyone-agent-public-identity.mjs";

export function createPuppyOneAgentDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverPuppyOneAgentWorker({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

/** Discover only PuppyOne's bundled worker. There is deliberately no PATH fallback. */
export async function discoverPuppyOneAgentWorker({
  appPath,
  userDataPath,
  executablePath,
  env = process.env,
  platform = process.platform,
  fsModule = fs,
  spawn = nodeSpawn,
  signal,
} = {}) {
  const workerPath = typeof appPath === "string"
    ? path.resolve(appPath, "electron/main/agent/runtimes/puppyone-agent/worker/main.mjs")
    : null;
  const profilePath = typeof userDataPath === "string"
    ? path.resolve(userDataPath, "agent-runtime", "puppyone-agent")
    : null;
  const environment = profilePath
    ? buildPuppyOneAgentEnvironment(env, { profilePath, platform })
    : {};
  const base = {
    provider: PUPPYONE_AGENT_RUNTIME_ID,
    runtimeId: PUPPYONE_AGENT_RUNTIME_ID,
    source: "bundled",
    pinnedVersion: PUPPYONE_PI_KERNEL.version,
    upstreamCommit: PUPPYONE_PI_KERNEL.sourceCommit,
    executablePath: typeof executablePath === "string" && path.isAbsolute(executablePath) ? executablePath : null,
    argsPrefix: workerPath ? [workerPath] : [],
    environment,
    version: null,
    compatibility: "unavailable",
  };
  try {
    signal?.throwIfAborted();
    if (!workerPath || !profilePath || !base.executablePath) throw new Error(`${WORKSPACE_AGENT_DISPLAY_NAME} launch paths are unavailable.`);
    const worker = await fsModule.promises.lstat(workerPath);
    if (!worker.isFile() || worker.isSymbolicLink()) throw new Error(`The bundled ${WORKSPACE_AGENT_DISPLAY_NAME} worker is invalid.`);
    const probe = await runBounded(spawn, base.executablePath, [workerPath, "--probe"], {
      signal,
      env: environment,
      timeoutMs: 8_000,
      maxBytes: 64 * 1024,
      label: `${WORKSPACE_AGENT_DISPLAY_NAME} Pi SDK`,
    });
    const result = parsePuppyOneWorkerProbe(probe.stdout);
    if (probe.code !== 0 || !result.ready) throw new Error(probe.stderr || "The bundled Pi SDK worker rejected its version probe.");
    if (result.version !== PUPPYONE_PI_KERNEL.version || result.protocol !== PUPPYONE_PI_KERNEL.protocol) {
      return {
        ...base,
        version: result.version,
        status: "unsupported-version",
        code: "RUNTIME_VERSION_UNSUPPORTED",
        message: `${WORKSPACE_AGENT_DISPLAY_NAME} expected Pi SDK ${PUPPYONE_PI_KERNEL.version}, but found ${result.version || "an unknown version"}.`,
      };
    }
    return {
      ...base,
      version: result.version,
      status: "ready",
      code: "READY",
      message: `${WORKSPACE_AGENT_DISPLAY_NAME} is ready.`,
      compatibility: PUPPYONE_PI_KERNEL.protocol,
      workerPath,
      profilePath,
    };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      ...base,
      status: "error",
      code: "RUNTIME_DISCOVERY_FAILED",
      message: "This PuppyOne build could not start its managed Agent kernel. Update or reinstall PuppyOne, then retry.",
      diagnostic: redactSecretText(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function parsePuppyOneWorkerProbe(value) {
  const lines = String(value).trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1 || lines[0].length > 4_000) throw new Error(`${WORKSPACE_AGENT_DISPLAY_NAME} worker returned an invalid probe.`);
  const result = JSON.parse(lines[0]);
  if (
    result?.schema !== "puppyone-pi-worker-probe/v1"
    || result.product !== PUPPYONE_AGENT_RUNTIME_ID
    || typeof result.version !== "string"
    || typeof result.protocol !== "string"
    || typeof result.ready !== "boolean"
  ) throw new Error(`${WORKSPACE_AGENT_DISPLAY_NAME} worker probe did not match its contract.`);
  return result;
}
