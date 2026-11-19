/** Shared allowlist; importing an adapter must never start the Git worker. */
export const GIT_OPERATIONS = Object.freeze([
  "commitWorkspaceGit", "discardWorkspaceGitPaths", "getWorkspaceGitBranchGraph", "getWorkspaceGitCommitDetail",
  "getWorkspaceGitFileDiff", "getWorkspaceGitStatus", "pullWorkspaceGit", "pushWorkspaceGit",
  "stageAllWorkspaceGitChanges", "stageWorkspaceGitPaths", "unstageAllWorkspaceGitChanges", "unstageWorkspaceGitPaths",
]);
