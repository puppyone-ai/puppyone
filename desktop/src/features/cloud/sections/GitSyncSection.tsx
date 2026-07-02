import { Check } from "lucide-react";
import { FilePreviewIcon, type Workspace } from "@puppyone/shared-ui";
import type { DesktopCloudRepoIdentity } from "../../../lib/cloudApi";
import type { GitStatusSnapshot } from "../../../types/electron";
import type { getPuppyoneRemote } from "../../source-control/remotes";
import { maskRemoteUrl } from "../../source-control/remotes";
import {
  CloudAuthorityCell,
  CloudSectionLabel,
  CloudWebEmpty,
  CloudWebPage,
} from "../components/shared";
import { formatGitSyncState, shortCommit, statusLabel } from "../utils";

export function CloudGitSyncSection({
  workspace,
  status,
  identity,
  cloudRemote,
  accountConnected,
  onOpenGitSettings,
}: {
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  identity: DesktopCloudRepoIdentity | null;
  cloudRemote: ReturnType<typeof getPuppyoneRemote>;
  accountConnected: boolean;
  onOpenGitSettings: () => void;
  onRefresh: () => void;
}) {
  const changeCount = status?.entries.length ?? 0;
  const branchName = status?.branch ?? "No branch";
  const remoteDisplay = cloudRemote?.info.displayId ?? (identity?.url ? maskRemoteUrl(identity.url) : "Missing");
  const syncState = status?.sourceControl.remote.state ?? "no-remote";
  const canSync = Boolean(status?.sourceControl.remote.canSync || status?.sourceControl.remote.canPull || status?.sourceControl.remote.canPush);

  return (
    <CloudWebPage
      title="Git Sync"
      count={changeCount}
      action={<button className="desktop-cloud-row-action primary" type="button" onClick={onOpenGitSettings}>Open Git Sync</button>}
    >
      <div className="desktop-cloud-sync-layout">
        <section className="desktop-cloud-sync-panel primary">
          <div className="desktop-cloud-sync-panel-header">
            <span className="desktop-cloud-web-status-dot ready" aria-hidden="true" />
            <div>
              <strong>PuppyOne Cloud</strong>
              <small>Source of truth</small>
            </div>
          </div>
          <div className="desktop-cloud-sync-panel-body">
            <CloudAuthorityCell label="Remote" value={remoteDisplay} tone={cloudRemote || identity?.url ? "ready" : "warning"} mono />
            <CloudAuthorityCell label="Branch" value={branchName} />
            <CloudAuthorityCell label="Sync state" value={formatGitSyncState(syncState)} tone={canSync ? "warning" : "ready"} />
          </div>
        </section>
        <section className="desktop-cloud-sync-panel">
          <div className="desktop-cloud-sync-panel-header">
            <span className={`desktop-cloud-web-status-dot ${changeCount > 0 ? "warning" : "ready"}`} aria-hidden="true" />
            <div>
              <strong>{workspace.name}</strong>
              <small>Desktop working copy</small>
            </div>
          </div>
          <div className="desktop-cloud-sync-panel-body">
            <CloudAuthorityCell label="Account" value={accountConnected ? "Signed in" : "Required"} tone={accountConnected ? "ready" : "warning"} />
            <CloudAuthorityCell label="Local changes" value={String(changeCount)} tone={changeCount > 0 ? "warning" : "ready"} />
            <CloudAuthorityCell label="Head" value={status?.headCommitId ? shortCommit(status.headCommitId) : "No commit"} mono />
          </div>
        </section>
      </div>

      <div className="desktop-cloud-web-detail-block">
        <CloudSectionLabel right={<button className="desktop-cloud-row-action" type="button" onClick={onOpenGitSettings}>Review changes</button>}>
          Working copy
        </CloudSectionLabel>
        {changeCount === 0 ? (
          <CloudWebEmpty icon={Check} title="Working tree clean" detail="Cloud and desktop are ready for the next change." />
        ) : (
          <div className="desktop-cloud-file-change-list">
            {(status?.entries ?? []).slice(0, 12).map((entry) => (
              <div className="desktop-cloud-file-change-row" key={`${entry.path}:${entry.status}`}>
                <span className="desktop-cloud-file-change-icon">
                  <FilePreviewIcon name={entry.path} type={entry.path.includes(".") ? "file" : "folder"} size={22} />
                </span>
                <div>
                  <strong title={entry.path}>{entry.path}</strong>
                  <small>{statusLabel(entry.status)}</small>
                </div>
                <em>{entry.staged ? "staged" : entry.unstaged || entry.status}</em>
              </div>
            ))}
          </div>
        )}
      </div>
    </CloudWebPage>
  );
}
