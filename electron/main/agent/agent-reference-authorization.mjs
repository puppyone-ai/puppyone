import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeAgentWorkspaceRelativePath } from "../../../shared/agent-contract/reference-identity.mjs";
import { isWorkspaceResourceReference, parseWorkspaceResourceReference } from "../../../shared/workspace-resource-reference.mjs";

const MAX_REFERENCES = 32;
const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 25 * 1024 * 1024;

/**
 * Turn untrusted Renderer path hints into main-authorized live workspace
 * references. Files and directories are re-canonicalized for every turn.
 */
export async function authorizeAgentReferences({
  workspaceRoot,
  references,
  budget = createAgentReferenceBudget(),
  fsModule = fs,
  resolveResource,
}) {
  if (!Array.isArray(references) || references.length === 0) return [];
  assertReferenceBudget(budget);
  const canonicalRoot = await fsModule.promises.realpath(path.resolve(workspaceRoot));
  const authorized = [];
  const seen = new Set();

  for (const reference of references.slice(0, MAX_REFERENCES)) {
    const portablePath = typeof reference === "object" && reference !== null && "relativePath" in reference
      ? normalizeAgentWorkspaceRelativePath(reference.relativePath)
      : null;
    if (typeof reference === "object" && reference !== null && "relativePath" in reference && !portablePath) {
      throw new Error("Agent workspace references require a valid workspace-relative identity.");
    }
    const requestedPath = typeof reference === "string" ? reference : reference?.resourceUri ?? portablePath ?? reference?.path;
    if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
      throw new Error("Agent workspace references require a valid path.");
    }
    const resourceUri = isWorkspaceResourceReference(requestedPath) ? requestedPath : null;
    if (resourceUri && !resolveResource) throw new Error("Workspace resource resolution is unavailable.");
    if (resourceUri && portablePath && parseWorkspaceResourceReference(resourceUri).relativePath !== portablePath) {
      throw new Error("Agent reference path does not match its resource identity.");
    }
    const resource = resolveResource
      ? await resolveResource(path.isAbsolute(requestedPath) ? path.relative(canonicalRoot, requestedPath) || "." : requestedPath)
      : null;
    const owningRoot = resource?.workspaceRoot ?? canonicalRoot;
    const resolvedPath = resource?.absolutePath ?? (path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(canonicalRoot, requestedPath));
    const canonicalPath = await fsModule.promises.realpath(resolvedPath).catch(() => {
      throw new Error("An Agent file reference no longer exists.");
    });
    if (!isSameOrInsidePath(owningRoot, canonicalPath)) {
      throw new Error("Agent file references must stay inside the assigned workspace.");
    }
    if (seen.has(canonicalPath)) continue;
    if (budget.remainingReferences <= 0) {
      throw new Error("Agent file references exceed the 32-file safety limit.");
    }
    const metadata = await fsModule.promises.stat(canonicalPath).catch(() => {
      throw new Error("An Agent workspace reference changed while it was being authorized.");
    });
    const entryType = metadata.isDirectory() ? "directory" : metadata.isFile() ? "file" : null;
    if (!entryType) throw new Error("Agent workspace references must be regular files or directories.");
    if (reference?.entryType && reference.entryType !== entryType) {
      throw new Error("An Agent workspace reference changed type.");
    }
    if (entryType === "file") {
      if (metadata.size > MAX_REFERENCE_BYTES) throw new Error("An Agent file reference exceeds the 25 MB safety limit.");
      if (metadata.size > budget.remainingBytes) throw new Error("Agent file references exceed the 25 MB total safety limit.");
      const flags = fsModule.constants.O_RDONLY | (fsModule.constants.O_NOFOLLOW ?? 0);
      const handle = await fsModule.promises.open(canonicalPath, flags).catch(() => {
        throw new Error("An Agent file reference changed while it was being authorized.");
      });
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size !== metadata.size) {
          throw new Error("An Agent file reference changed while it was being authorized.");
        }
      } finally {
        await handle.close();
      }
      budget.remainingBytes -= metadata.size;
    }
    budget.remainingReferences -= 1;
    seen.add(canonicalPath);
    const requestPath = path.relative(owningRoot, canonicalPath) || ".";
    const relativePath = normalizeAgentWorkspaceRelativePath(requestPath);
    if (!relativePath) throw new Error("Agent workspace reference identity could not be normalized.");
    const name = safeDisplayName(reference?.displayName || reference?.name || path.basename(canonicalPath) || path.basename(canonicalRoot));
    authorized.push({
      authorized: true,
      // Keep pre-upgrade draft mentions valid; new acquisitions always receive
      // root-qualified IDs. A legacy relative reference stays scoped to its session.
      id: workspaceReferenceId(portablePath && !resourceUri ? relativePath : resource?.resourceUri ?? relativePath, entryType),
      kind: "workspace-entry",
      entryType,
      path: canonicalPath,
      relativePath,
      ...(resource ? {
        resourceUri: resource.resourceUri,
        workspaceFolderId: resource.folderId,
        authorizedWorkspaceRoot: owningRoot,
        ...(owningRoot !== canonicalRoot ? { workspaceName: safeDisplayName(resource.workspaceName) } : {}),
      } : {}),
      displayName: name,
      name,
      mime: entryType === "file" ? inferMimeType(canonicalPath) : "inode/directory",
      size: entryType === "file" ? metadata.size : 0,
      status: "ready",
    });
  }
  return authorized;
}

/** Project an authorized workspace record onto the metadata-only Renderer draft DTO. */
export function workspaceDraftReferences(references) {
  return (Array.isArray(references) ? references : []).map((reference) => ({
    id: reference.id,
    kind: "workspace-entry",
    entryType: reference.entryType,
    relativePath: reference.relativePath,
    ...(reference.resourceUri ? { resourceUri: reference.resourceUri, workspaceFolderId: reference.workspaceFolderId } : {}),
    ...(reference.workspaceName ? { workspaceName: reference.workspaceName } : {}),
    displayName: reference.displayName,
    mime: reference.mime,
    size: reference.size,
    status: "ready",
  }));
}

export function createAgentReferenceBudget() {
  return {
    remainingBytes: MAX_TOTAL_REFERENCE_BYTES,
    remainingReferences: MAX_REFERENCES,
  };
}

function assertReferenceBudget(budget) {
  if (
    !budget
    || !Number.isSafeInteger(budget.remainingBytes)
    || budget.remainingBytes < 0
    || budget.remainingBytes > MAX_TOTAL_REFERENCE_BYTES
    || !Number.isSafeInteger(budget.remainingReferences)
    || budget.remainingReferences < 0
    || budget.remainingReferences > MAX_REFERENCES
  ) {
    throw new Error("Agent file reference budget is invalid.");
  }
}

function isSameOrInsidePath(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function inferMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION.get(extension) || "application/octet-stream";
}

function workspaceReferenceId(relativePath, entryType) {
  return `workspace-${createHash("sha256").update(entryType).update("\0").update(relativePath).digest("base64url").slice(0, 32)}`;
}

function safeDisplayName(value) {
  return String(value || "workspace item").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 512) || "workspace item";
}

const MIME_BY_EXTENSION = new Map([
  [".md", "text/markdown"],
  [".mdx", "text/markdown"],
  [".txt", "text/plain"],
  [".json", "application/json"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".cjs", "text/javascript"],
  [".ts", "text/typescript"],
  [".tsx", "text/typescript"],
  [".jsx", "text/javascript"],
  [".css", "text/css"],
  [".html", "text/html"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
  [".csv", "text/csv"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".pdf", "application/pdf"],
]);

export const agentReferenceLimits = Object.freeze({
  maxReferences: MAX_REFERENCES,
  maxReferenceBytes: MAX_REFERENCE_BYTES,
  maxTotalReferenceBytes: MAX_TOTAL_REFERENCE_BYTES,
});
