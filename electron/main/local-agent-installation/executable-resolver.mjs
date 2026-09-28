import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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
const MAX_IDENTITY_FILE_BYTES = 1024 * 1_024;
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
    let registeredApplications = [];
    if (platform === "win32" && definition.registeredApplicationNames?.length > 0) {
      try {
        registeredApplications = await discoveryPort.findRegisteredApplications(
          definition.registeredApplicationNames,
          { signal: resolutionContext.signal },
        );
      } catch {
        resolutionContext.signal?.throwIfAborted();
      }
    }
    let productCandidates;
    try {
      productCandidates = typeof definition.candidatePaths === "function"
        ? await definition.candidatePaths({
          env: environment,
          homedir,
          platform,
          registeredApplications,
        }) : [];
    } catch {
      return failed("candidate-provider-error");
    }
    const observation = await resolveExecutableObservation({
      names: definition.executableNames,
      configuredCandidates: [...normalizeExtraCandidates(extraCandidates), ...productCandidates],
      searchContext: executableSearchContextForDefinition(
        resolutionContext.executableSearch,
        definition,
      ),
      acceptCandidate: (candidate) => verifyIdentity(definition, candidate, { fsModule }),
      platform,
      fsModule,
      signal: resolutionContext.signal,
    });
    if (observation.status === "found") return Object.freeze({
      ...observation,
      ...(resolutionContext.environmentComplete === false ? { reasonCode: "environment-unavailable" } : {}),
      candidate: Object.freeze({ ...observation.candidate, environment: {
        ...environment,
        ...observation.candidate.environmentOverrides,
      },
        environmentSource: resolutionContext.environmentSource }),
    });
    if (resolutionContext.environmentComplete === false && observation.status === "not-found") {
      return failed(resolutionContext.environmentReasonCode || "environment-unavailable");
    }
    return observation;
  }

  return Object.freeze({ createContext, resolve });
}

function executableSearchContextForDefinition(searchContext, definition) {
  if (definition.searchPath !== false) return searchContext;
  return Object.freeze({
    ...searchContext,
    directories: Object.freeze((searchContext?.directories ?? []).filter(
      ({ source }) => source !== "path-installation",
    )),
  });
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
          if (validation.candidate.identityMismatchAsNotFound) continue;
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
  await verifyCandidateFile({
    file: candidate.executablePath,
    expected: candidate.canonicalIdentity,
    expectedFingerprint: candidate.identityFingerprint,
    label: "executable",
  }, fsModule);
  if (candidate.entrypointPath) {
    await verifyCandidateFile({
      file: candidate.entrypointPath,
      expected: candidate.entrypointCanonicalIdentity,
      expectedFingerprint: candidate.entrypointIdentityFingerprint,
      label: "entrypoint",
    }, fsModule);
  }
  if (candidate.identityFilePath) {
    await verifyCandidateFile({
      file: candidate.identityFilePath,
      expected: candidate.identityFileCanonicalIdentity,
      expectedFingerprint: candidate.identityFileFingerprint,
      expectedContentFingerprint: candidate.identityFileContentFingerprint,
      label: "identity manifest",
      accessMode: fsModule.constants.R_OK,
      contentLimit: MAX_IDENTITY_FILE_BYTES,
    }, fsModule);
  }
  return candidate.executablePath;
}

async function verifyCandidateFile({
  file,
  expected,
  expectedFingerprint,
  expectedContentFingerprint,
  label,
  accessMode,
  contentLimit,
}, fsModule) {
  if (!safeAbsolutePath(file)) throw new Error(`Local ${label} is not a safe absolute path.`);
  const resolved = await fsModule.promises.realpath(file);
  if (resolved !== (expected || file)) throw new Error(`Local ${label} changed identity before launch.`);
  const metadata = await fsModule.promises.stat(resolved);
  if (!metadata.isFile()) throw new Error(`Local ${label} is not a regular file.`);
  await fsModule.promises.access(resolved, accessMode ?? fsModule.constants.X_OK);
  if (expectedFingerprint && fingerprint(metadata) !== expectedFingerprint) {
    throw new Error(`Local ${label} changed identity before launch.`);
  }
  if (expectedContentFingerprint && (
    await fingerprintContent(resolved, contentLimit, fsModule) !== expectedContentFingerprint
  )) throw new Error(`Local ${label} changed identity before launch.`);
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
  const push = (filename, descriptor, source, recipe = null) => {
    if (ordered.length >= MAX_CANDIDATES || !safeAbsolutePath(filename)) return;
    const key = `${filename}\0${descriptor.invokedAs}`;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({
      filename,
      descriptor,
      source,
      launcherPath: recipe?.launcherPath,
      argsPrefix: recipe?.argsPrefix,
      environmentOverrides: recipe?.environmentOverrides,
      identityFilePath: recipe?.identityFilePath,
      requiresManifestIdentity: recipe?.requiresManifestIdentity === true,
      identityMismatchAsNotFound: recipe?.identityMismatchAsNotFound === true,
    });
  };
  const pushConfigured = (entry) => {
    const descriptor = descriptors.find(({ fileName }) => path.basename(entry.path) === fileName) ?? descriptors[0];
    push(entry.path, descriptor, safeSource(entry.source), entry);
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
    const entrypoint = await inspectCandidateFile(candidate.filename, fsModule);
    if (entrypoint.status !== "found") return entrypoint;
    const launcherPath = candidate.launcherPath ?? candidate.filename;
    const launcher = launcherPath === candidate.filename
      ? entrypoint
      : await inspectCandidateFile(launcherPath, fsModule);
    if (launcher.status !== "found") return launcher;
    const identityFile = candidate.identityFilePath
      ? await inspectCandidateFile(candidate.identityFilePath, fsModule, {
        accessMode: fsModule.constants.R_OK,
        contentLimit: MAX_IDENTITY_FILE_BYTES,
      })
      : null;
    if (identityFile && identityFile.status !== "found") return identityFile;
    const launchPathEntry = await fsModule.promises.realpath(path.dirname(launcherPath));
    const recipeArgs = candidate.argsPrefix == null
      ? candidate.descriptor.argsPrefix
      : normalizeArgs(candidate.argsPrefix);
    if (candidate.argsPrefix != null && recipeArgs.length !== candidate.argsPrefix.length) {
      return failed("invalid-launch-recipe");
    }
    return Object.freeze({
      status: "found",
      candidate: Object.freeze({
        executablePath: launcherPath,
        canonicalIdentity: launcher.resolved,
        identityFingerprint: fingerprint(launcher.metadata),
        ...(launcherPath !== candidate.filename ? {
          entrypointPath: candidate.filename,
          entrypointCanonicalIdentity: entrypoint.resolved,
          entrypointIdentityFingerprint: fingerprint(entrypoint.metadata),
        } : {}),
        invokedAs: candidate.descriptor.invokedAs,
        argsPrefix: Object.freeze([...recipeArgs]),
        ...(identityFile ? {
          identityFilePath: candidate.identityFilePath,
          identityFileCanonicalIdentity: identityFile.resolved,
          identityFileFingerprint: fingerprint(identityFile.metadata),
          identityFileContentFingerprint: identityFile.contentFingerprint,
        } : {}),
        ...(candidate.requiresManifestIdentity ? { requiresManifestIdentity: true } : {}),
        ...environmentOverrides(candidate.environmentOverrides),
        ...(candidate.identityMismatchAsNotFound ? { identityMismatchAsNotFound: true } : {}),
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

async function inspectCandidateFile(filename, fsModule, {
  accessMode = fsModule.constants.X_OK,
  contentLimit,
} = {}) {
  if (!safeAbsolutePath(filename)) return failed("unsafe-path");
  try {
    const resolved = await fsModule.promises.realpath(filename);
    if (!safeAbsolutePath(resolved)) return failed("unsafe-canonical-path");
    const metadata = await fsModule.promises.stat(resolved);
    if (!metadata.isFile()) return failed("not-a-file");
    await fsModule.promises.access(resolved, accessMode);
    const contentFingerprint = contentLimit
      ? await fingerprintContent(resolved, contentLimit, fsModule)
      : null;
    return { status: "found", resolved, metadata, contentFingerprint };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return Object.freeze({ status: "not-found", reasonCode: "not-found" });
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") return failed("permission-denied");
    return failed("filesystem-error");
  }
}

async function fingerprintContent(filename, maxBytes, fsModule) {
  const handle = await fsModule.promises.open(filename, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new Error("Local identity file exceeds the size limit.");
    return createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
  } finally {
    await handle.close();
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
  return value.slice(0, 4).map(String).filter((entry) => entry.length <= 4_096 && !/[\r\n\0]/u.test(entry));
}

function normalizeEnvironmentOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 8).filter(([key, entry]) => (
    /^[A-Za-z_][A-Za-z0-9_]{0,79}$/u.test(key)
    && typeof entry === "string"
    && entry.length <= 4_096
    && !/[\r\n\0]/u.test(entry)
  )));
}

function environmentOverrides(value) {
  const overrides = normalizeEnvironmentOverrides(value);
  return Object.keys(overrides).length > 0
    ? { environmentOverrides: Object.freeze(overrides) }
    : {};
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
