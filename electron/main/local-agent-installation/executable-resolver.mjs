import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExecutableDiscoveryPort } from "../platform/common/executable-discovery-port.mjs";
import { runDiscoveryIo } from "../platform/common/discovery-io-budget.mjs";
import { verifyLocalAgentCandidateIdentity } from "./candidate-identity.mjs";
import {
  defaultLocalAgentInstallationRegistry,
  getLocalAgentInstallationDefinition,
} from "./installation-registry.mjs";

const MAX_PATH_DIRECTORIES = 256;
const MAX_NAMES = 8;
const MAX_EXECUTABLE_VARIANTS = 4;
const MAX_SEARCH_DIRECTORIES = MAX_PATH_DIRECTORIES;
const MAX_CONFIGURED_CANDIDATES = 16;
const MAX_CANDIDATES = (MAX_SEARCH_DIRECTORIES * MAX_NAMES * MAX_EXECUTABLE_VARIANTS)
  + MAX_CONFIGURED_CANDIDATES;

export function createLocalAgentExecutableResolver({
  registry = defaultLocalAgentInstallationRegistry,
  discoveryPort = createExecutableDiscoveryPort(),
  verifyIdentity = verifyLocalAgentCandidateIdentity,
} = {}) {
  const { env, homedir, nodePlatform: platform, fsModule } = discoveryPort;

  async function createContext({ signal } = {}) {
    const snapshot = await discoveryPort.captureEnvironment({ signal });
    return Object.freeze({
      environment: snapshot.environment,
      environmentSource: snapshot.source,
      environmentComplete: snapshot.complete,
      environmentReasonCode: snapshot.reasonCode,
      executableSearch: await createExecutableSearchContext({ env: snapshot.environment, platform }),
      signal,
    });
  }

  async function resolve(agentId, { context = null, extraCandidates = [] } = {}) {
    const definition = getLocalAgentInstallationDefinition(agentId, registry);
    if (!definition) return failed("unknown-agent");
    let resolutionContext = context;
    if (!resolutionContext) {
      try {
        resolutionContext = await createContext();
      } catch {
        return failed("context-error");
      }
    }
    resolutionContext.signal?.throwIfAborted();
    const environment = resolutionContext.environment ?? env;
    let productCandidates;
    try {
      productCandidates = typeof definition.candidatePaths === "function"
        ? await definition.candidatePaths({ env: environment, homedir, platform }) : [];
    } catch {
      return failed("candidate-provider-error");
    }
    const observation = await resolveExecutableObservation({
      names: definition.executableNames,
      configuredCandidates: [...normalizeExtraCandidates(extraCandidates), ...productCandidates],
      searchContext: resolutionContext.executableSearch,
      acceptCandidate: (candidate) => verifyIdentity(definition, candidate, { fsModule }),
      platform,
      fsModule,
      signal: resolutionContext.signal,
    });
    if (observation.status === "found") return Object.freeze({
      ...observation,
      ...(resolutionContext.environmentComplete === false ? { reasonCode: "environment-unavailable" } : {}),
      candidate: Object.freeze({ ...observation.candidate, environment,
        environmentSource: resolutionContext.environmentSource }),
    });
    if (resolutionContext.environmentComplete === false && observation.status === "not-found") {
      return failed(resolutionContext.environmentReasonCode || "environment-unavailable");
    }
    return observation;
  }

  return Object.freeze({ createContext, resolve });
}

export async function createExecutableSearchContext({
  env = process.env,
  platform = process.platform,
} = {}) {
  const pathDirectories = String(env?.PATH ?? env?.Path ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(safeAbsolutePath);
  const directories = [];
  const seen = new Set();
  for (const directory of pathDirectories) {
    const key = platform === "win32" ? directory.toLowerCase() : directory;
    if (seen.has(key)) continue;
    if (directories.length >= MAX_PATH_DIRECTORIES) throw new Error("Executable PATH exceeds the search budget.");
    seen.add(key);
    directories.push(Object.freeze({
      directory,
      source: "path-installation",
    }));
  }
  const executableExtensions = platform === "win32"
    ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((value) => value.toLowerCase())
      .filter((value, index, all) => [".com", ".exe", ".bat", ".cmd"].includes(value) && all.indexOf(value) === index)
    : [];
  return Object.freeze({ directories: Object.freeze(directories), executableExtensions: Object.freeze(executableExtensions) });
}

/** Resolve without invoking a login shell or executing any discovered binary. */
export async function resolveExecutableObservation({
  names,
  configuredCandidates = [],
  configuredPaths = [],
  searchContext,
  acceptCandidate = null,
  env = process.env,
  homedir = os.homedir(),
  platform = process.platform,
  fsModule = fs,
  signal,
} = {}) {
  const context = searchContext ?? await createExecutableSearchContext({ env, homedir, platform, fsModule });
  const descriptors = normalizeNames(names, platform, context.executableExtensions);
  if (descriptors.length === 0) return failed("no-executable-names");
  const normalizedConfigured = [
    ...(Array.isArray(configuredPaths) ? configuredPaths : []).map((value) => ({
      path: value,
      source: "configured",
    })),
    ...(Array.isArray(configuredCandidates) ? configuredCandidates : []),
  ];
  const { candidates, hasInvalidConfiguration } = buildCandidates({
    descriptors,
    configuredCandidates: normalizedConfigured,
    searchContext: context,
  });
  if (hasInvalidConfiguration) return failed("invalid-configuration");
  let failureReason = null;

  for (const candidate of candidates) {
    signal?.throwIfAborted();
    let validation;
    try {
      validation = await runDiscoveryIo(() => validateCandidate(candidate, fsModule), { signal });
    } catch (error) {
      signal?.throwIfAborted();
      return failed(error?.code === "filesystem-busy" ? "filesystem-busy" : "filesystem-timeout");
    }
    if (validation.status === "not-found") {
      if (isExplicitSource(candidate.source)) return failed("configured-path-not-found");
      continue;
    }
    if (validation.status === "failed") {
      if (isExplicitSource(candidate.source)) return failed(`configured-${validation.reasonCode}`);
      failureReason ??= validation.reasonCode;
      continue;
    }
    if (typeof acceptCandidate === "function") {
      try {
        if (!await runDiscoveryIo(() => acceptCandidate(validation.candidate), { signal })) {
          if (isExplicitSource(candidate.source)) return failed("configured-identity-mismatch");
          failureReason ??= "identity-mismatch";
          continue;
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (["filesystem-timeout", "filesystem-busy"].includes(error?.code)) return failed(error.code);
        if (isExplicitSource(candidate.source)) return failed("configured-identity-check-error");
        failureReason ??= "identity-check-error";
        continue;
      }
    }
    return Object.freeze({ status: "found", candidate: validation.candidate });
  }
  return failureReason ? failed(failureReason) : Object.freeze({ status: "not-found", reasonCode: "not-found" });
}

/** Compatibility facade for generic callers during the migration. */
export async function resolveFirstExecutable(options = {}) {
  const result = await resolveExecutableObservation(options);
  return result.status === "found" ? result.candidate : null;
}

export async function assertExecutableIdentity(candidate, { fsModule = fs } = {}) {
  return runDiscoveryIo(() => verifyExecutableIdentity(candidate, fsModule));
}

async function verifyExecutableIdentity(candidate, fsModule) {
  if (!candidate || !safeAbsolutePath(candidate.executablePath)) {
    throw new Error("Local executable is not a safe absolute path.");
  }
  const expected = candidate.canonicalIdentity || candidate.executablePath;
  const resolved = await fsModule.promises.realpath(candidate.executablePath);
  if (resolved !== expected) throw new Error("Local executable changed identity before launch.");
  const metadata = await fsModule.promises.stat(resolved);
  if (!metadata.isFile()) throw new Error("Local executable is not a regular file.");
  await fsModule.promises.access(resolved, fsModule.constants.X_OK);
  if (candidate.identityFingerprint && fingerprint(metadata) !== candidate.identityFingerprint) {
    throw new Error("Local executable changed identity before launch.");
  }
  return candidate.executablePath;
}

function buildCandidates({ descriptors, configuredCandidates, searchContext }) {
  const explicit = [];
  const product = [];
  let hasInvalidConfiguration = false;
  for (const value of configuredCandidates.slice(0, MAX_CONFIGURED_CANDIDATES)) {
    const entry = typeof value === "string"
      ? { path: value, source: "configured" }
      : value;
    if (!entry || !safeAbsolutePath(entry.path)) {
      if (value != null) hasInvalidConfiguration = true;
      continue;
    }
    if (entry.source === "environment-override" || entry.source === "explicit-configuration" || entry.source === "configured") {
      explicit.push(entry);
    } else product.push(entry);
  }
  const ordered = [];
  const seen = new Set();
  const push = (filename, descriptor, source) => {
    if (ordered.length >= MAX_CANDIDATES || !safeAbsolutePath(filename)) return;
    const key = `${filename}\0${descriptor.invokedAs}`;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ filename, descriptor, source });
  };
  const pushConfigured = (entry) => {
    const descriptor = descriptors.find(({ fileName }) => path.basename(entry.path) === fileName) ?? descriptors[0];
    push(entry.path, descriptor, safeSource(entry.source));
  };
  explicit.forEach(pushConfigured);
  pushSearchDirectories(searchContext, descriptors, push, (source) => source === "path-installation");
  product.forEach(pushConfigured);
  pushSearchDirectories(searchContext, descriptors, push, (source) => source !== "path-installation");
  return { candidates: ordered, hasInvalidConfiguration };
}

function pushSearchDirectories(searchContext, descriptors, push, matchesSource) {
  for (const entry of searchContext?.directories ?? []) {
    if (!safeAbsolutePath(entry?.directory)) continue;
    const source = safeSource(entry?.source);
    if (!matchesSource(source)) continue;
    for (const descriptor of descriptors) push(path.join(entry.directory, descriptor.fileName), descriptor, source);
  }
}

async function validateCandidate(candidate, fsModule) {
  try {
    const resolved = await fsModule.promises.realpath(candidate.filename);
    const launchPathEntry = await fsModule.promises.realpath(path.dirname(candidate.filename));
    if (!safeAbsolutePath(resolved)) return failed("unsafe-canonical-path");
    const metadata = await fsModule.promises.stat(resolved);
    if (!metadata.isFile()) return failed("not-a-file");
    await fsModule.promises.access(resolved, fsModule.constants.X_OK);
    return Object.freeze({
      status: "found",
      candidate: Object.freeze({
        executablePath: candidate.filename,
        canonicalIdentity: resolved,
        identityFingerprint: fingerprint(metadata),
        invokedAs: candidate.descriptor.invokedAs,
        argsPrefix: Object.freeze([...candidate.descriptor.argsPrefix]),
        launchPathEntry,
        source: candidate.source,
      }),
    });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return Object.freeze({ status: "not-found", reasonCode: "not-found" });
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") return failed("permission-denied");
    return failed("filesystem-error");
  }
}

function normalizeNames(names, platform, extensions) {
  const values = Array.isArray(names) ? names : [names];
  return values.slice(0, MAX_NAMES).flatMap((value) => {
    if (typeof value === "object" && value) {
      return executableNames(value.fileName, platform, extensions).map((fileName) => ({
        fileName,
        invokedAs: String(value.invokedAs || value.fileName).slice(0, 80),
        argsPrefix: normalizeArgs(value.argsPrefix),
      }));
    }
    if (typeof value !== "string" || !value.trim()) return [];
    const [binary, ...argsPrefix] = value.trim().split(/\s+/u);
    return executableNames(binary, platform, extensions).map((fileName) => ({
      fileName,
      invokedAs: value.trim().slice(0, 80),
      argsPrefix,
    }));
  });
}

function executableNames(value, platform, extensions = [".com", ".exe", ".bat", ".cmd"]) {
  const normalized = String(value || "");
  if (!/^[A-Za-z0-9._-]+$/u.test(normalized)) return [];
  if (platform !== "win32" || /\.(?:com|exe|bat|cmd)$/iu.test(normalized)) return [normalized];
  return extensions.map((extension) => `${normalized}${extension}`);
}

function normalizeExtraCandidates(values) {
  return (Array.isArray(values) ? values : []).map((value) => (
    typeof value === "string"
      ? { path: value, source: "explicit-configuration" }
      : value
  ));
}

function normalizeArgs(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map(String).filter((entry) => entry.length <= 160 && !/[\r\n\0]/u.test(entry));
}

function safeAbsolutePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096
    && path.isAbsolute(value) && !/[\r\n\0]/u.test(value);
}

function safeSource(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/u.test(value)
    ? value
    : "search-context";
}

function isExplicitSource(value) {
  return value === "configured"
    || value === "environment-override"
    || value === "explicit-configuration";
}

function fingerprint(metadata) {
  return [metadata.dev, metadata.ino, metadata.size, Math.trunc(metadata.mtimeMs)].join(":");
}

function failed(reasonCode) {
  return Object.freeze({ status: "failed", reasonCode });
}

export const executableCandidateLimits = Object.freeze({
  maxPathDirectories: MAX_PATH_DIRECTORIES,
  maxNames: MAX_NAMES,
  maxCandidates: MAX_CANDIDATES,
  maxExecutableVariants: MAX_EXECUTABLE_VARIANTS,
  maxSearchDirectories: MAX_SEARCH_DIRECTORIES,
});
