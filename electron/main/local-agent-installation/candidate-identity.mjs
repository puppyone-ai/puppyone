import fs from "node:fs";
import path from "node:path";

const MAX_IDENTITY_VALUES = 8;
const MAX_PARENT_DEPTH = 6;
const MAX_PACKAGE_BYTES = 128 * 1_024;
const MAX_EXECUTABLE_PREFIX_BYTES = 16 * 1_024;
const MAX_MANIFEST_BYTES = 1024 * 1_024;

/** Verify ambiguous executable names with bounded, read-only evidence. */
export async function verifyLocalAgentCandidateIdentity(definition, candidate, { fsModule = fs } = {}) {
  const policy = definition?.identityPolicy;
  if (!policy) return true;
  if (["configured", "environment-override", "explicit-configuration"].includes(candidate?.source)) {
    return true;
  }
  const required = new Set(policy.requiredForInvocations ?? []);
  if (!required.has(candidate?.invokedAs)) return true;

  const identityPath = candidate?.entrypointCanonicalIdentity
    ?? candidate?.entrypointPath
    ?? candidate?.canonicalIdentity
    ?? candidate?.executablePath;
  if (candidate?.requiresManifestIdentity && (
    !policy.manifest
    || !await hasManifestIdentity(candidate, identityPath, policy.manifest, fsModule)
  )) return false;
  const normalizedPath = normalizePath(identityPath);
  if ((policy.pathFragments ?? []).some((fragment) => normalizedPath.includes(normalizePath(fragment)))) {
    return true;
  }
  if (await hasPackageIdentity(identityPath, policy.packageNames, fsModule)) return true;
  return hasExecutableMarker(identityPath, policy.fileMarkers, fsModule);
}

async function hasManifestIdentity(candidate, executablePath, policy, fsModule) {
  if (!safeAbsolutePath(executablePath)) return false;
  let manifestPath = candidate?.identityFileCanonicalIdentity ?? candidate?.identityFilePath;
  if (!manifestPath) {
    let directory = path.dirname(executablePath);
    for (let depth = 0; depth < policy.parentDepth; depth += 1) directory = path.dirname(directory);
    manifestPath = path.join(directory, policy.fileName);
  }
  if (!safeAbsolutePath(manifestPath)) return false;
  try {
    const metadata = await fsModule.promises.stat(manifestPath);
    if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) return false;
    const manifest = JSON.parse(await fsModule.promises.readFile(manifestPath, "utf8"));
    return policy.values.includes(manifest?.[policy.property]);
  } catch {
    return false;
  }
}

async function hasPackageIdentity(executablePath, packageNames, fsModule) {
  const expected = new Set(normalizeEvidenceValues(packageNames));
  if (!safeAbsolutePath(executablePath) || expected.size === 0) return false;
  let directory = path.dirname(executablePath);
  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth += 1) {
    const manifestPath = path.join(directory, "package.json");
    try {
      const metadata = await fsModule.promises.stat(manifestPath);
      if (metadata.isFile() && metadata.size <= MAX_PACKAGE_BYTES) {
        const manifest = JSON.parse(await fsModule.promises.readFile(manifestPath, "utf8"));
        if (expected.has(String(manifest?.name || "").toLowerCase())) return true;
      }
    } catch {
      // Standalone binaries and wrappers usually have no adjacent manifest.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return false;
}

async function hasExecutableMarker(executablePath, markers, fsModule) {
  const expected = normalizeEvidenceValues(markers);
  if (!safeAbsolutePath(executablePath) || expected.length === 0) return false;
  let handle;
  try {
    handle = await fsModule.promises.open(executablePath, "r");
    const buffer = Buffer.alloc(MAX_EXECUTABLE_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, bytesRead).toString("utf8").toLowerCase();
    return expected.some((marker) => prefix.includes(marker));
  } catch {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function normalizeEvidenceValues(values) {
  return (Array.isArray(values) ? values : [])
    .slice(0, MAX_IDENTITY_VALUES)
    .filter((value) => typeof value === "string" && value.length > 0 && value.length <= 160)
    .map((value) => value.toLowerCase());
}

function normalizePath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").toLowerCase() : "";
}

function safeAbsolutePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096
    && path.isAbsolute(value) && !/[\r\n\0]/u.test(value);
}

export const localAgentCandidateIdentityPolicy = Object.freeze({
  maxExecutablePrefixBytes: MAX_EXECUTABLE_PREFIX_BYTES,
  maxPackageBytes: MAX_PACKAGE_BYTES,
  maxParentDepth: MAX_PARENT_DEPTH,
  maxManifestBytes: MAX_MANIFEST_BYTES,
});
