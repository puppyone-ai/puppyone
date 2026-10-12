import {
  commitWorkspaceGit,
  createWorkspaceGitBranch,
  initializeWorkspaceGitRepository,
  stageAllWorkspaceGitChanges,
} from "../../../lib/localFiles";
import type { CloudInitializationErrorCode, GitStatusSnapshot } from "../../../types/electron";

/** The local steps, in the order a folder needs them. */
export type PublishPreparationStage =
  | "enabling-version-control"
  | "creating-snapshot"
  | "creating-branch";

export type PublishPreparationResult =
  | Readonly<{ ok: true; status: GitStatusSnapshot }>
  | Readonly<{ ok: false; code: CloudInitializationErrorCode; status: GitStatusSnapshot }>;

/**
 * Everything a folder needs before it can be reachable, and nothing that needs
 * an account: version history, a first snapshot, and a branch to send.
 *
 * Keeping this separate from the publish request is what lets the account
 * arrive late. A surface can run it while the user is still deciding, and a
 * surface that already has an account can run it as the first phase of
 * publishing. It is safe to run twice: every step checks the repository state
 * before touching it, so a second pass over a prepared folder does nothing.
 *
 * `author` is the identity for the first snapshot. Without one, Git's own
 * configured identity is used; when that is missing too, the snapshot is
 * reported as still required so a later attempt that does have an identity can
 * create it.
 */
export async function prepareWorkspaceForPublish({
  rootPath,
  status,
  author = null,
  onStage,
}: {
  rootPath: string;
  status: GitStatusSnapshot;
  author?: string | null;
  onStage?: (stage: PublishPreparationStage) => void;
}): Promise<PublishPreparationResult> {
  let current = status;
  let requirement: CloudInitializationErrorCode = "REPOSITORY_REQUIRED";
  try {
    if (!current.isRepo) {
      requirement = "REPOSITORY_REQUIRED";
      onStage?.("enabling-version-control");
      current = await initializeWorkspaceGitRepository(rootPath);
    }
    if (!current.headCommitId || current.totalCommits < 1) {
      requirement = "COMMIT_REQUIRED";
      onStage?.("creating-snapshot");
      current = await stageAllWorkspaceGitChanges(rootPath);
      current = await commitWorkspaceGit(rootPath, "Initial snapshot", {
        allowEmpty: true,
        ...(author ? { authorName: author, authorEmail: author } : {}),
      });
    }
    if (!normalizePublishBranch(current.branch)) {
      requirement = "BRANCH_REQUIRED";
      onStage?.("creating-branch");
      current = await createWorkspaceGitBranch(rootPath, resolveCloudPublishBranchName(current));
    }
  } catch {
    return { ok: false, code: requirement, status: current };
  }
  return { ok: true, status: current };
}

/**
 * True when the remaining work needs an account identity rather than being a
 * genuine local failure. A folder that has version history but no snapshot is
 * not broken; it is waiting for someone to sign it.
 */
export function isIdentityDeferredPreparation(code: CloudInitializationErrorCode): boolean {
  return code === "COMMIT_REQUIRED" || code === "BRANCH_REQUIRED";
}

export function normalizePublishBranch(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  return ["head", "detached"].includes(normalized.toLowerCase()) ? "" : normalized;
}

export function resolveCloudPublishBranchName(status: GitStatusSnapshot): string {
  const existing = new Set(
    status.branches
      .filter((branch) => !branch.remote)
      .map((branch) => branch.name),
  );
  for (const candidate of ["main", "puppyone-publish"]) {
    if (!existing.has(candidate)) return candidate;
  }
  let suffix = 2;
  while (existing.has(`puppyone-publish-${suffix}`)) suffix += 1;
  return `puppyone-publish-${suffix}`;
}
