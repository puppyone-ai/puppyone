import type { GitStatusSnapshot } from "../../types/electron";

export type ProjectBackupProvider = "github" | "gitlab";

export const PROJECT_BACKUP_PROVIDER_LABELS: Record<ProjectBackupProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

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

function getRemoteHostname(destination: string): string | null {
  try {
    const hostname = new URL(destination).hostname;
    if (hostname) return hostname.toLowerCase();
  } catch {
    // Git also accepts SCP syntax, e.g. git@github.com:team/project.git.
  }
  return /^(?:[^/@:]+@)?([^/:]+):.+$/.exec(destination)?.[1]?.toLowerCase() ?? null;
}
