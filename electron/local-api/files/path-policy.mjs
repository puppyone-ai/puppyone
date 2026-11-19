import fs from "node:fs/promises";
import path from "node:path";

const RESOURCE_URI_LIKE_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:[/\\]/;

export function normalizeRelativePath(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new Error("Folder path must be a string.");
  }
  const uriCandidate = value
    .trimStart()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (RESOURCE_URI_LIKE_PATTERN.test(uriCandidate)) {
    throw new Error("Workspace paths must be provider-relative, not Resource URIs.");
  }
  if (path.isAbsolute(value)) {
    throw new Error("Folder path is outside the selected workspace.");
  }
  const normalized = path.normalize(value).replaceAll("\\", "/");
  if (normalized === "." || normalized === "") return "";
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    throw new Error("Folder path is outside the selected workspace.");
  }
  return normalized;
}

export function isSameOrInsidePath(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  if (candidate === parent) return true;

  const relativePath = path.relative(parent, candidate);
  return Boolean(relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function resolveWorkspacePath(rootPath, relativePath) {
  const root = path.resolve(rootPath);
  const normalizedRelative = normalizeRelativePath(relativePath);
  const resolved = normalizedRelative ? path.resolve(root, normalizedRelative) : root;
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Folder path is outside the selected workspace.");
  }
  return resolved;
}

export async function resolveExistingWorkspacePath(rootPath, relativePath) {
  const resolvedRoot = path.resolve(rootPath);
  const canonicalRoot = await fs.realpath(resolvedRoot).catch((error) => {
    throw new Error(`Unable to resolve workspace root: ${error.message}`);
  });
  const candidatePath = resolveWorkspacePath(canonicalRoot, relativePath);
  const candidateMetadata = await fs.lstat(candidatePath).catch((error) => {
    throw new Error(`Unable to resolve workspace entry: ${error.message}`);
  });

  if (candidatePath !== canonicalRoot && candidateMetadata.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be accessed through workspace file operations.");
  }

  const canonicalCandidate = await fs.realpath(candidatePath).catch((error) => {
    throw new Error(`Unable to resolve workspace entry: ${error.message}`);
  });
  if (!isSameOrInsidePath(canonicalRoot, canonicalCandidate)) {
    throw new Error("Workspace entry resolves outside the selected workspace.");
  }

  return canonicalCandidate;
}

const DISPLAY_SPACE = /[\u0020\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;

/**
 * Resolve an authored display path while preserving exact filesystem semantics
 * as the primary rule. This narrowly handles visually identical Unicode-space
 * variants produced by macOS screenshot names. A fallback segment is accepted
 * only when it has exactly one display-equivalent directory entry; ambiguity
 * fails closed and symbolic-link traversal remains forbidden.
 */
export async function resolveExistingWorkspaceDisplayPath(rootPath, relativePath) {
  try {
    return await resolveExistingWorkspacePath(rootPath, relativePath);
  } catch (exactError) {
    const canonicalRoot = await fs.realpath(path.resolve(rootPath)).catch(() => {
      throw exactError;
    });
    const normalizedRelative = normalizeRelativePath(relativePath);
    if (!normalizedRelative) throw exactError;

    const exactCandidate = resolveWorkspacePath(canonicalRoot, normalizedRelative);
    const exactFailure = await fs.lstat(exactCandidate).then(
      () => null,
      (error) => error,
    );
    if (!exactFailure || exactFailure.code !== "ENOENT") throw exactError;

    const requestedSegments = normalizedRelative.split("/");
    const resolvedSegments = [];
    let currentDirectory = canonicalRoot;

    for (let index = 0; index < requestedSegments.length; index += 1) {
      const requestedSegment = requestedSegments[index];
      const entries = await fs.readdir(currentDirectory, { withFileTypes: true }).catch(() => {
        throw exactError;
      });
      const exact = entries.find((entry) => entry.name === requestedSegment) ?? null;
      const matches = exact
        ? [exact]
        : entries.filter((entry) => (
          getWorkspaceDisplayNameKey(entry.name) === getWorkspaceDisplayNameKey(requestedSegment)
        ));
      if (matches.length === 0) throw exactError;
      if (matches.length > 1) {
        throw new Error("Workspace entry is ambiguous after Unicode display normalization.");
      }

      const entry = matches[0];
      const candidatePath = path.join(currentDirectory, entry.name);
      const metadata = await fs.lstat(candidatePath).catch(() => {
        throw exactError;
      });
      if (metadata.isSymbolicLink()) {
        throw new Error("Symbolic links cannot be accessed through workspace file operations.");
      }
      if (index < requestedSegments.length - 1 && !metadata.isDirectory()) {
        throw exactError;
      }

      resolvedSegments.push(entry.name);
      currentDirectory = candidatePath;
    }

    return resolveExistingWorkspacePath(canonicalRoot, resolvedSegments.join("/"));
  }
}

function getWorkspaceDisplayNameKey(value) {
  return value.normalize("NFC").replace(DISPLAY_SPACE, " ");
}
