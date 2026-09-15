import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExecutableDiscoveryPort } from "../platform/common/executable-discovery-port.mjs";
import { verifyLocalAgentCandidateIdentity } from "./candidate-identity.mjs";
import {
  defaultLocalAgentInstallationRegistry,
  getLocalAgentInstallationDefinition,
} from "./installation-registry.mjs";

const MAX_PATH_DIRECTORIES = 48;
const MAX_NAMES = 8;
const MAX_EXECUTABLE_VARIANTS = 2;
const MAX_NODE_MANAGER_VERSIONS = 32;
const MAX_SEARCH_DIRECTORIES = 96;
const MAX_CONFIGURED_CANDIDATES = 16;
const MAX_CANDIDATES = (MAX_SEARCH_DIRECTORIES * MAX_NAMES * MAX_EXECUTABLE_VARIANTS)
  + MAX_CONFIGURED_CANDIDATES;

export function createLocalAgentExecutableResolver({
  registry = defaultLocalAgentInstallationRegistry,
  discoveryPort = createExecutableDiscoveryPort(),
  verifyIdentity = verifyLocalAgentCandidateIdentity,
} = {}) {
  const { env, homedir, nodePlatform: platform, fsModule } = discoveryPort;

  async function createContext() {
    return Object.freeze({
      executableSearch: await createExecutableSearchContext({ env, homedir, platform, fsModule }),
    });
  }

  async function resolve(agentId, { context = null, extraCandidates = [] } = {}) {
    const definition = getLocalAgentInstallationDefinition(agentId, registry);
    if (!definition) return failed("unknown-agent");
    let productCandidates;
    try {
      productCandidates = typeof definition.candidatePaths === "function"
        ? await definition.candidatePaths({ env, homedir, platform })
        : [];
    } catch {
      return failed("candidate-provider-error");
    }
    let resolutionContext = context;
    if (!resolutionContext) {
      try {
        resolutionContext = await createContext();
      } catch {
        return failed("context-error");
      }
    }
    return resolveExecutableObservation({
      names: definition.executableNames,
      configuredCandidates: [...normalizeExtraCandidates(extraCandidates), ...productCandidates],
      searchContext: resolutionContext.executableSearch,
      acceptCandidate: (candidate) => verifyIdentity(definition, candidate, { fsModule }),
      platform,
      fsModule,
    });
  }

  return Object.freeze({ createContext, resolve });
}

export async function createExecutableSearchContext({
  env = process.env,
  homedir = os.homedir(),
  platform = process.platform,
  fsModule = fs,
} = {}) {
  const userDirectories = [
    env?.NVM_BIN,
    env?.PNPM_HOME,
    platform === "win32" ? env?.NVM_SYMLINK : null,
    platform === "win32" && env?.APPDATA ? path.join(env.APPDATA, "npm") : null,
    platform === "win32" && env?.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Volta", "bin") : null,
    path.join(homedir, ".local", "bin"),
    path.join(homedir, ".npm-global", "bin"),
    path.join(homedir, ".bun", "bin"),
    path.join(homedir, ".cargo", "bin"),
    path.join(homedir, ".volta", "bin"),
    path.join(homedir, ".asdf", "shims"),
    platform === "win32" ? path.join(homedir, "scoop", "shims") : null,
    path.join(homedir, "bin"),
  ].filter(safeAbsolutePath);
  if (platform !== "win32") {
    userDirectories.push(...await boundedNvmBinDirectories({ env, fsModule, homedir }));
  }
  const pathDirectories = String(env?.PATH || "")
    .split(platform === "win32" ? ";" : ":")
    .filter(safeAbsolutePath)
    .slice(0, MAX_PATH_DIRECTORIES);
  const systemDirectories = platform === "win32"
    ? windowsCandidateDirectories(env)
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const directories = [];
  const seen = new Set();
  for (const directory of [...pathDirectories, ...userDirectories, ...systemDirectories]) {
    if (directories.length >= MAX_SEARCH_DIRECTORIES || seen.has(directory)) continue;
    seen.add(directory);
    directories.push(Object.freeze({
      directory,
      source: classifySource(directory, pathDirectories, userDirectories, systemDirectories),
    }));
  }
  return Object.freeze({ directories: Object.freeze(directories) });
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
} = {}) {
  const descriptors = normalizeNames(names, platform);
  if (descriptors.length === 0) return failed("no-executable-names");
  const context = searchContext ?? await createExecutableSearchContext({ env, homedir, platform, fsModule });
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
    const validation = await validateCandidate(candidate, fsModule);
    if (validation.status === "not-found") continue;
    if (validation.status === "failed") {
      failureReason ??= validation.reasonCode;
      continue;
    }
    if (typeof acceptCandidate === "function") {
      try {
        if (!await acceptCandidate(validation.candidate)) {
          failureReason ??= "identity-mismatch";
          continue;
        }
      } catch {
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
  return resolved;
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
        executablePath: resolved,
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

function normalizeNames(names, platform) {
  const values = Array.isArray(names) ? names : [names];
  return values.slice(0, MAX_NAMES).flatMap((value) => {
    if (typeof value === "object" && value) {
      return executableNames(value.fileName, platform).map((fileName) => ({
        fileName,
        invokedAs: String(value.invokedAs || value.fileName).slice(0, 80),
        argsPrefix: normalizeArgs(value.argsPrefix),
      }));
    }
    if (typeof value !== "string" || !value.trim()) return [];
    const [binary, ...argsPrefix] = value.trim().split(/\s+/u);
    return executableNames(binary, platform).map((fileName) => ({
      fileName,
      invokedAs: value.trim().slice(0, 80),
      argsPrefix,
    }));
  });
}

function executableNames(value, platform) {
  const normalized = String(value || "");
  if (!/^[A-Za-z0-9._-]+$/u.test(normalized)) return [];
  if (platform !== "win32" || /\.(?:cmd|exe)$/iu.test(normalized)) return [normalized];
  return [`${normalized}.exe`, `${normalized}.cmd`];
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

function fingerprint(metadata) {
  return [metadata.dev, metadata.ino, metadata.size, Math.trunc(metadata.mtimeMs)].join(":");
}

function classifySource(directory, pathDirectories, userDirectories, systemDirectories) {
  if (pathDirectories.includes(directory)) return "path-installation";
  if (userDirectories.includes(directory)) return "user-installation";
  if (systemDirectories.includes(directory)) return "system-installation";
  return "search-context";
}

function windowsCandidateDirectories(env) {
  return [env?.ProgramFiles && path.join(env.ProgramFiles, "nodejs")].filter(safeAbsolutePath);
}

async function boundedNvmBinDirectories({ env, fsModule, homedir }) {
  const nvmRoot = safeAbsolutePath(env?.NVM_DIR) ? env.NVM_DIR : path.join(homedir, ".nvm");
  const versionsRoot = path.join(nvmRoot, "versions", "node");
  try {
    return (await fsModule.promises.readdir(versionsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareNodeVersionsDescending)
      .slice(0, MAX_NODE_MANAGER_VERSIONS)
      .map((version) => path.join(versionsRoot, version, "bin"));
  } catch {
    return [];
  }
}

function compareNodeVersionsDescending(left, right) {
  const parts = (value) => String(value).replace(/^v/u, "").split(".").map((entry) => Number(entry) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return String(right).localeCompare(String(left));
}

function failed(reasonCode) {
  return Object.freeze({ status: "failed", reasonCode });
}

export const executableCandidateLimits = Object.freeze({
  maxPathDirectories: MAX_PATH_DIRECTORIES,
  maxNames: MAX_NAMES,
  maxCandidates: MAX_CANDIDATES,
  maxExecutableVariants: MAX_EXECUTABLE_VARIANTS,
  maxNodeManagerVersions: MAX_NODE_MANAGER_VERSIONS,
  maxSearchDirectories: MAX_SEARCH_DIRECTORIES,
});
