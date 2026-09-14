import type { GitStatusEntry, GitStatusSnapshot } from "../../types/electron";

export type GitTitlebarStatus = Readonly<{
  conflicts: number;
  incoming: number;
  localChanges: number;
  outgoing: number;
}>;

export const EMPTY_GIT_TITLEBAR_STATUS: GitTitlebarStatus = Object.freeze({
  conflicts: 0,
  incoming: 0,
  localChanges: 0,
  outgoing: 0,
});

export function getGitTitlebarStatus(
  status: GitStatusSnapshot | null,
): GitTitlebarStatus {
  if (!status?.isRepo) return EMPTY_GIT_TITLEBAR_STATUS;

  const entries = uniqueEntries([
    ...status.entries,
    ...status.stagedEntries,
    ...status.unstagedEntries,
    ...status.untrackedEntries,
  ]);

  return {
    conflicts: entries.filter((entry) => entry.conflict === true).length,
    incoming: Math.max(0, status.sourceControl.remote.behind),
    localChanges: entries.length,
    outgoing: Math.max(0, status.sourceControl.remote.ahead),
  };
}

function uniqueEntries(entries: readonly GitStatusEntry[]) {
  const byPath = new Map<string, GitStatusEntry>();
  for (const entry of entries) {
    const current = byPath.get(entry.path);
    byPath.set(entry.path, current?.conflict ? current : entry);
  }
  return [...byPath.values()];
}
