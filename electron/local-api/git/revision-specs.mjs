/**
 * Pure scope/status matrix for Git before/after sources. Refs in `comparison`
 * are derived by trusted main/local Git code, never supplied by the renderer.
 */
export function deriveGitRevisionSpecs({
  scope,
  file,
  comparison = null,
  hasHead = true,
  getMimeType = () => null,
}) {
  const beforePath = file.oldPath || file.path;
  const afterPath = file.path;
  const beforeMimeType = getMimeType(beforePath);
  const afterMimeType = getMimeType(afterPath);
  const preferText = file.binary !== true;
  const missing = (relativePath, reason) => ({ kind: "missing", path: relativePath, reason });
  const tree = (ref, relativePath, mimeType) => ({
    kind: "tree",
    ref,
    path: relativePath,
    mimeType,
    preferText,
  });
  const index = (relativePath, mimeType) => ({
    kind: "index",
    path: relativePath,
    mimeType,
    preferText,
  });
  const worktree = (relativePath, mimeType) => ({
    kind: "worktree",
    path: relativePath,
    mimeType,
    preferText,
  });
  const beforeMissing = file.status === "added" || file.status === "untracked";
  const afterMissing = file.status === "deleted";

  if (scope === "untracked") {
    return {
      before: missing(beforePath, "untracked-before"),
      after: worktree(afterPath, afterMimeType),
    };
  }
  if (scope === "unstaged") {
    return {
      before: beforeMissing ? missing(beforePath, "added-before") : index(beforePath, beforeMimeType),
      after: afterMissing ? missing(afterPath, "deleted-after") : worktree(afterPath, afterMimeType),
    };
  }
  if (scope === "staged") {
    return {
      before: beforeMissing || !hasHead
        ? missing(beforePath, beforeMissing ? "added-before" : "head-missing")
        : tree("HEAD", beforePath, beforeMimeType),
      after: afterMissing ? missing(afterPath, "deleted-after") : index(afterPath, afterMimeType),
    };
  }
  if ((scope === "remote" || scope === "committed") && comparison) {
    return {
      before: beforeMissing
        ? missing(beforePath, "added-before")
        : tree(comparison.beforeRef, beforePath, beforeMimeType),
      after: afterMissing
        ? missing(afterPath, "deleted-after")
        : tree(comparison.afterRef, afterPath, afterMimeType),
    };
  }
  throw new Error(`Unsupported Git diff scope: ${String(scope)}`);
}
