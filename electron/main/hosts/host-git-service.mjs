import {
  commitWorkspaceGit, discardWorkspaceGitPaths, getWorkspaceGitBranchGraph, getWorkspaceGitCommitDetail,
  getWorkspaceGitFileDiff, getWorkspaceGitStatus, pullWorkspaceGit, pushWorkspaceGit,
  stageAllWorkspaceGitChanges, stageWorkspaceGitPaths, unstageAllWorkspaceGitChanges, unstageWorkspaceGitPaths,
} from "../../local-api/workspace.mjs";
import { HostFileError } from "./host-file-service.mjs";

const MAX_PATHS = 1000;

/** Folder-relative Git paths; the same rules as the host file protocol, minus nothing. */
function gitPath(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || value.startsWith("/") || value.includes("\\") ||
      value.includes("\0") || value.split("/").some((part) => part === "" || part === "." || part === ".." ||
      part.toLowerCase() === ".git")) throw new HostFileError("invalid_path");
  return value;
}

function gitPaths(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_PATHS) throw new HostFileError("invalid_path");
  return values.map(gitPath);
}

/**
 * Named Git operations in a registered folder. Every call re-reads this
 * computer's consent (folder.git). These are the same functions the local
 * Changes and History panes use; under the folder tier they run sandboxed.
 */
export function createHostGitService({ resolveFolder, git: defaultGit = {
  commitWorkspaceGit, discardWorkspaceGitPaths, getWorkspaceGitBranchGraph, getWorkspaceGitCommitDetail,
  getWorkspaceGitFileDiff, getWorkspaceGitStatus, pullWorkspaceGit, pushWorkspaceGit,
  stageAllWorkspaceGitChanges, stageWorkspaceGitPaths, unstageAllWorkspaceGitChanges, unstageWorkspaceGitPaths,
},
// The Git to use for this folder under this computer's execution policy (the folder sandbox
// or this user). Hooks and repository config can run code, so Git is execution like a terminal.
gitFor = null }) {
  const queues = new Map();
  // One Git operation at a time per folder, like the local operation coordinator.
  function serialize(folderId, operation) {
    const previous = queues.get(folderId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    queues.set(folderId, current);
    return current.finally(() => { if (queues.get(folderId) === current) queues.delete(folderId); });
  }

  async function run(request) {
    const folder = await resolveFolder(request?.folder_id);
    if (!folder || !folder.capabilities?.includes("folder.git")) throw new HostFileError("folder_unavailable");
    const root = folder.rootPath;
    const git = (gitFor ? await gitFor({ folderId: request.folder_id, rootPath: root }) : null) ?? defaultGit;
    const operations = {
      status: () => git.getWorkspaceGitStatus(root),
      graph: () => git.getWorkspaceGitBranchGraph(root),
      commit_detail: () => {
        if (typeof request.commit !== "string" || !/^[0-9a-f]{7,64}$/.test(request.commit)) throw new HostFileError("invalid_path");
        return git.getWorkspaceGitCommitDetail(root, request.commit);
      },
      file_diff: () => git.getWorkspaceGitFileDiff(root, gitPath(request.path),
        request.scope === "staged" ? "staged" : "unstaged"),
      stage: () => git.stageWorkspaceGitPaths(root, gitPaths(request.paths)),
      stage_all: () => git.stageAllWorkspaceGitChanges(root),
      unstage: () => git.unstageWorkspaceGitPaths(root, gitPaths(request.paths)),
      unstage_all: () => git.unstageAllWorkspaceGitChanges(root),
      discard: () => git.discardWorkspaceGitPaths(root, gitPaths(request.paths)),
      commit: () => {
        if (typeof request.message !== "string" || !request.message.trim() || request.message.length > 10_000) {
          throw new HostFileError("invalid_content");
        }
        return git.commitWorkspaceGit(root, request.message);
      },
      pull: () => git.pullWorkspaceGit(root),
      push: () => git.pushWorkspaceGit(root),
    };
    const operation = Object.hasOwn(operations, request.op) ? operations[request.op] : null;
    if (!operation) throw new HostFileError("file_operation_failed");
    const result = await serialize(request.folder_id, operation);
    // Results are JSON data for the remote panes; nothing native crosses the socket.
    return JSON.parse(JSON.stringify(result ?? {}));
  }

  return Object.freeze({ run });
}
