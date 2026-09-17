import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { runBoundedProcessProbe } from "./bounded-process-probe.mjs";
import { createExecutableDiscoveryPort } from "../../platform/common/executable-discovery-port.mjs";
import { normalizeEnvironment } from "../../platform/common/command-environment.mjs";
import {
  assertExecutableIdentity,
  createLocalAgentExecutableResolver,
  resolveExecutableObservation,
} from "../../local-agent-installation/executable-resolver.mjs";

const VERSION_TIMEOUT_MS = 4_000;
const MAX_DISCOVERY_OUTPUT = 64 * 1024;

/** Installation selection belongs to Platform; Runtime owns readiness probes. */
export async function discoverExecutable({
  installationId = null, executableNames, additionalCandidates = [],
  fsModule = fs, spawn = nodeSpawn, env = process.env, platform = process.platform,
  homedir = os.homedir(), parseVersion, minimumVersion, label,
  buildEnvironment = buildAgentEnvironment,
  buildProbeEnvironment = (environment) => environment,
  validateCandidate, searchPath = true, readEnvironment, signal,
}) {
  signal?.throwIfAborted();
  let observation;
  let context = null;
  if (installationId) {
    const installationResolver = createLocalAgentExecutableResolver({
      discoveryPort: createExecutableDiscoveryPort({
        env, fsModule, homedir, nodePlatform: platform, readEnvironment,
      }),
    });
    try {
      context = await installationResolver.createContext({ signal });
      observation = await installationResolver.resolve(installationId, { context, extraCandidates: additionalCandidates });
    } catch {
      signal?.throwIfAborted();
      observation = { status: "failed", reasonCode: "context-error" };
    }
  } else {
    // Managed distributions supply verified explicit candidates and never load
    // the user's shell or fall back to a same-named user installation.
    observation = await resolveExecutableObservation({
      names: executableNames?.length ? executableNames : [...new Set(additionalCandidates.filter(Boolean).map((file) => path.basename(file)))],
      configuredCandidates: additionalCandidates.filter(Boolean).map((file) => ({ path: file, source: "managed-candidate" })),
      env: searchPath ? env : { PATH: "" }, platform, fsModule, signal,
      acceptCandidate: validateCandidate
        ? (candidate) => validateCandidate({ candidate: candidate.executablePath, resolvedPath: candidate.canonicalIdentity })
        : null,
    });
    if (observation.status === "found") observation = { ...observation, candidate: {
      ...observation.candidate, executablePath: observation.candidate.canonicalIdentity,
    } };
  }
  signal?.throwIfAborted();
  const candidate = observation.status === "found" ? observation.candidate : null;
  const environment = buildEnvironment(candidate?.environment ?? context?.environment ?? env, {}, { homedir, platform });
  const executablePath = candidate?.executablePath ?? null;
  const base = {
    version: null,
    minimumVersion,
    executablePath,
    argsPrefix: candidate?.argsPrefix ?? [],
    invokedAs: candidate?.invokedAs ?? null,
    environment,
  };
  if (!candidate) return {
    ...base,
    status: observation.status === "failed" ? "error" : "not-installed",
    code: observation.status === "failed" ? "RUNTIME_DISCOVERY_FAILED" : "RUNTIME_NOT_INSTALLED",
    message: observation.status === "failed"
      ? `${label} installation could not be checked. Refresh to retry.`
      : `${label} was not found. Install it, complete its setup in a terminal, then refresh.`,
    ...(observation.reasonCode ? { diagnostic: observation.reasonCode } : {}),
  };
  try {
    await assertExecutableIdentity(candidate, { fsModule });
    const probeEnvironment = await buildProbeEnvironment(environment, { executablePath, homedir, platform });
    const result = await runBounded(spawn, executablePath, [...candidate.argsPrefix, "--version"], {
      env: probeEnvironment, timeoutMs: VERSION_TIMEOUT_MS, maxBytes: MAX_DISCOVERY_OUTPUT, label, signal,
    });
    const version = parseVersion(`${result.stdout}\n${result.stderr}`);
    if (result.code !== 0 || !version) return {
      ...base, status: "unsupported-version", code: "RUNTIME_VERSION_UNVERIFIED", version,
      message: `The installed ${label} version could not be verified. Update it and refresh.`,
    };
    if (minimumVersion && compareVersions(version, minimumVersion) < 0) return {
      ...base, status: "unsupported-version", code: "RUNTIME_VERSION_UNSUPPORTED", version,
      message: `${label} ${version} is older than the tested baseline ${minimumVersion}.`,
    };
    return {
      ...base, status: "ready", code: "READY", version,
      message: `${label} is ready.`,
      ...(observation.reasonCode ? { diagnostic: observation.reasonCode } : {}),
    };
  } catch (error) {
    signal?.throwIfAborted();
    return { ...base, status: "error", code: "RUNTIME_DISCOVERY_FAILED",
      message: error instanceof Error ? error.message : String(error) };
  }
}

export function runBounded(spawn, file, args, { env, timeoutMs, maxBytes, label = "Agent executable", signal }) {
  return runBoundedProcessProbe(file, args, {
    spawn, env, timeoutMs, maxOutputBytes: maxBytes, label: `${label} discovery`, signal,
  });
}

export function buildAgentEnvironment(baseEnv, overrides, { platform = process.platform } = {}) {
  return { ...normalizeEnvironment({ ...baseEnv, ...overrides }, platform), TERM: "dumb", PUPPYONE_AGENT: "1" };
}

export function parseSemanticVersion(value, prefixPattern = "") {
  const prefix = prefixPattern ? `(?:${prefixPattern}\\s+)?` : "";
  const match = String(value).match(new RegExp(`${prefix}(\\d+\\.\\d+\\.\\d+)`, "i"));
  return match?.[1] ?? null;
}

export function compareVersions(left, right) {
  const leftParts = String(left).split(".").map(Number);
  const rightParts = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export const executableDiscoveryLimits = Object.freeze({
  versionTimeoutMs: VERSION_TIMEOUT_MS, maxDiscoveryOutput: MAX_DISCOVERY_OUTPUT,
});
