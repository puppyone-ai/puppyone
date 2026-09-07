import path from "node:path";

const WORKSPACE_REFERENCE_HEADING = "Authorized context files for this turn:";

/**
 * Render authorized, live workspace references as ordinary prompt text.
 *
 * The caller still owns authorization. This helper only preserves the common
 * delivery contract and refuses paths outside the session or the individual
 * reference's Main-authorized owning root.
 */
export function formatAuthorizedWorkspaceReferencePrompt(prompt, references, workspaceRoot) {
  const paths = authorizedWorkspaceReferencePaths(references, workspaceRoot);
  return paths.length > 0
    ? `${prompt}\n\n${WORKSPACE_REFERENCE_HEADING}\n${paths.map((filename) => `- ${filename}`).join("\n")}`
    : prompt;
}

export function authorizedWorkspaceReferencePaths(references, workspaceRoot) {
  return Array.from(new Set((Array.isArray(references) ? references : [])
    .filter((entry) => entry?.kind !== "staged-attachment"
      && !(entry?.inlineMentioned === true && entry?.mentionDelivery === "path"))
    .map((entry) => authorizedWorkspaceReferencePath(entry, workspaceRoot))
    .filter(Boolean)));
}

/**
 * Validate one workspace reference independently of how it is rendered in a
 * provider prompt. Inline mentions are intentionally omitted from the prompt
 * appendix, but they still need the same workspace-bound authorization proof.
 */
export function authorizedWorkspaceReferencePath(reference, workspaceRoot) {
  if (typeof workspaceRoot !== "string" || typeof reference?.path !== "string") return null;
  // Only Main-authorized records may carry an additional owning root. A URI or
  // Renderer-supplied absolute path on its own never widens the session boundary.
  const root = path.resolve(reference.authorized === true && typeof reference.authorizedWorkspaceRoot === "string"
    ? reference.authorizedWorkspaceRoot
    : workspaceRoot);
  const filename = path.isAbsolute(reference.path)
    ? path.resolve(reference.path)
    : path.resolve(root, reference.path);
  return isSameOrInside(root, filename) ? filename : null;
}

function isSameOrInside(root, filename) {
  const relative = path.relative(root, filename);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
