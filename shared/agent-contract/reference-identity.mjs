const MAX_WORKSPACE_RELATIVE_PATH_LENGTH = 4_096;
const MAX_REFERENCE_LABEL_LENGTH = 4_096;

/**
 * Normalize the portable identity of a workspace reference.
 *
 * Paths are POSIX-style and relative to the resource's owning root (the Agent
 * session root for legacy references). Absolute paths, traversal and control
 * characters are rejected instead of being silently repaired.
 */
export function normalizeAgentWorkspaceRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_WORKSPACE_RELATIVE_PATH_LENGTH) {
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(value) || /^(?:[/\\]|[A-Za-z]:)/.test(value)) return null;
  const segments = value.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) return null;
  const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
  return normalized || (segments.every((segment) => !segment || segment === ".") ? "." : null);
}

/** Human-readable, portable label used by both Composer and Main validation. */
export function agentReferenceMentionLabel(reference) {
  if (reference?.kind === "workspace-entry") {
    const relativePath = normalizeAgentWorkspaceRelativePath(reference.relativePath);
    if (relativePath) {
      const label = relativePath !== "." ? relativePath.slice(0, MAX_REFERENCE_LABEL_LENGTH) : safeReferenceDisplayName(reference.displayName ?? reference.name);
      return reference.workspaceName ? `${label} · ${safeReferenceDisplayName(reference.workspaceName)}` : label;
    }
  }
  return safeReferenceDisplayName(reference?.displayName ?? reference?.name);
}

export function agentReferenceMentionText(reference) {
  return `@${agentReferenceMentionLabel(reference)}`;
}

function safeReferenceDisplayName(value) {
  const label = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_REFERENCE_LABEL_LENGTH)
    : "";
  return label || "file";
}

export const agentReferenceIdentityLimits = Object.freeze({
  maxWorkspaceRelativePathLength: MAX_WORKSPACE_RELATIVE_PATH_LENGTH,
  maxReferenceLabelLength: MAX_REFERENCE_LABEL_LENGTH,
});
