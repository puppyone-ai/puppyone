import type { GitStatusSnapshot } from "../../types/electron";
import { getCanonicalPuppyoneRemote } from "../source-control/remotes";

export type ProjectBackupProvider = "github" | "gitlab";

export const PROJECT_BACKUP_PROVIDER_LABELS: Record<ProjectBackupProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

export type ProjectBackupDestination = ProjectBackupProvider | "puppyone-cloud";

/** A local observation of remote changes; commit time is not backup completion time. */
export function getProjectBackupSnapshot(
  status: GitStatusSnapshot | null,
  provider: ProjectBackupDestination,
  cloudProjectId?: string,
  cloudOrigin?: string,
) {
  const canonical = provider === "puppyone-cloud" ? getCanonicalPuppyoneRemote(status) : null;
  const candidates = status?.remotes.filter((remote) => {
    if (provider === "puppyone-cloud") {
      return remote === canonical?.remote
        && (!cloudProjectId || canonical.info.projectId === cloudProjectId)
        && (!cloudOrigin || canonical.info.origin === cloudOrigin.toLowerCase().replace(/\/$/, ""));
    }
    const host = getRemoteHostname(remote.pushUrl?.trim() || remote.fetchUrl?.trim() || "");
    return provider === "github" ? host === "github.com" || host === "ssh.github.com" : host === "gitlab.com";
  }) ?? [];
  const target = status?.syncTarget;
  const remote = candidates.find((candidate) => candidate.name === target?.remote) ?? candidates[0];
  // Tracking refs describe fetch. A different push destination cannot borrow
  // their version or ahead/behind state as evidence of its own saved copy.
  const comparable = remote && (!remote.pushUrl?.trim() || remote.pushUrl.trim() === remote.fetchUrl?.trim());
  const currentBranch = status?.branches.find((branch) => branch.current && !branch.remote);
  const ref = comparable && remote
    ? target?.remote === remote.name ? target.ref
      : currentBranch?.upstream?.startsWith(`${remote.name}/`) ? currentBranch.upstream
        : status?.branch ? `${remote.name}/${status.branch}` : null
    : null;
  const branch = ref ? status?.branches.find((candidate) => candidate.remote && candidate.name === ref) : null;
  const counts = status?.headCommitId && branch?.lastCommitId && comparable && remote
    ? target?.remote === remote.name && target.exists && target.ref === ref ? target
      : currentBranch?.upstream === ref ? currentBranch
        : branch.lastCommitId === status?.headCommitId ? { ahead: 0, behind: 0 } : null
    : null;
  const state = !counts ? "unverified" : counts.ahead && counts.behind ? "diverged"
    : counts.ahead ? "outgoing" : counts.behind ? "incoming" : "matching";
  return {
    state,
    ahead: counts?.ahead ?? 0,
    behind: counts?.behind ?? 0,
    localChanges: status?.entries.length ?? 0,
    branch: branch?.name.slice((remote?.name.length ?? 0) + 1) ?? null,
    commitId: branch?.lastCommitId ?? null,
    lastChangeAt: branch?.lastCommitId && branch.lastCommitDate && Number.isFinite(Date.parse(branch.lastCommitDate))
      ? branch.lastCommitDate : null,
    lastChangeSummary: branch?.lastCommitId ? branch.lastCommitMessage?.trim() || null : null,
    repositoryUrl: provider === "github" && remote
      ? getGitHubRepositoryUrl(remote.pushUrl?.trim() || remote.fetchUrl?.trim() || "") : null,
  };
}

/** Identified hosting services, not a claim that all files are pushed. */
export function getProjectBackupProviders(status: GitStatusSnapshot | null): ProjectBackupProvider[] {
  if (!status?.isRepo) return [];
  const providers = new Set<ProjectBackupProvider>();
  for (const remote of status.remotes) {
    // A separate push URL is the backup destination; fetch may use another host.
    const destination = remote.pushUrl?.trim() || remote.fetchUrl?.trim();
    if (!destination) continue;
    const host = getRemoteHostname(destination);
    if (host === "github.com" || host === "ssh.github.com") providers.add("github");
    else if (host === "gitlab.com") providers.add("gitlab");
  }
  return (["github", "gitlab"] as const).filter((provider) => providers.has(provider));
}

function getGitHubRepositoryUrl(destination: string): string | null {
  let host: string | undefined;
  let pathname: string | undefined;
  // SCP remotes have a host:path pair rather than a URL pathname.
  const scp = /^(?:[^/@:]+@)?(github\.com|ssh\.github\.com):(.+)$/i.exec(destination);
  if (scp) {
    host = scp[1].toLowerCase();
    pathname = scp[2];
  } else {
    try {
      const url = new URL(destination);
      if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
      host = url.hostname.toLowerCase();
      pathname = url.pathname;
    } catch {
      return null;
    }
  }
  if ((host !== "github.com" && host !== "ssh.github.com") || !pathname) return null;
  const parts = pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) return null;
  // Build a clean web URL; never forward SSH credentials, query strings or ports.
  return `https://github.com/${parts.join("/")}`;
}

function getRemoteHostname(destination: string): string | null {
  try {
    const hostname = new URL(destination).hostname;
    if (hostname) return hostname.toLowerCase();
  } catch {
    // Git also accepts SCP syntax, e.g. git@github.com:team/project.git.
  }
  return /^(?:[^/@:]+@)?([^/:]+):.+$/.exec(destination)?.[1]?.toLowerCase() ?? null;
}
