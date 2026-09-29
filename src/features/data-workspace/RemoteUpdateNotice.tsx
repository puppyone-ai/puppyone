import { useLocalization } from "@puppyone/localization";
import type { GitStatusSnapshot } from "../../types/electron";
import { GitOperationButton } from "../source-control";

type RemoteUpdateFileChangeCounts = Readonly<{
  added: number;
  modified: number;
  deleted: number;
}>;

export type RemoteUpdateNoticeModel = Readonly<{
  behind: number;
  fileCount: number;
  fileChanges: RemoteUpdateFileChangeCounts;
  updatedAt: string | null;
  canPull: boolean;
  diverged: boolean;
}>;

export function RemoteUpdateNotice({
  status,
  operationLoading,
  onPull,
}: {
  status: GitStatusSnapshot | null;
  operationLoading: string | null;
  onPull: () => Promise<boolean>;
}) {
  const { t } = useLocalization();
  const model = getRemoteUpdateNoticeModel(status);
  if (!model) return null;

  return (
    <aside
      className="desktop-remote-update-notice"
      data-diverged={model.diverged ? "true" : undefined}
      role="status"
      aria-live="polite"
    >
      <div className="desktop-remote-update-notice-heading">
        <span className="desktop-remote-update-notice-summary">
          {model.fileCount > 0
            ? t("source-control.commit.filesChanged", { count: model.fileCount })
            : t("source-control.notice.filesChanged")}
        </span>
      </div>
      <GitOperationButton
        className="desktop-remote-update-notice-pull"
        tooltip={t("source-control.notice.getChangesTitle")}
        disabled={operationLoading !== null || !model.canPull}
        icon="download"
        label={t("source-control.notice.get")}
        loadingKey="pull"
        loadingLabel={t("source-control.notice.gettingChanges")}
        operationLoading={operationLoading}
        primary
        onClick={() => void onPull()}
      />
    </aside>
  );
}

export function getRemoteUpdateNoticeModel(
  status: GitStatusSnapshot | null,
): RemoteUpdateNoticeModel | null {
  if (!status?.isRepo) return null;
  const remote = status.sourceControl.remote;
  if (remote.behind <= 0 || (remote.state !== "incoming" && remote.state !== "diverged")) {
    return null;
  }

  const previewPaths = new Set(remote.incomingPreview.map(({ path }) => path).filter(Boolean));
  const fileCount = Math.max(remote.incomingFileSummary?.total ?? 0, previewPaths.size);
  const targetRef = remote.target?.ref ?? status.effectiveHosting.ref;
  const remoteBranch = status.branches.find(
    (branch) => branch.remote && branch.name === targetRef,
  ) ?? null;

  return {
    behind: remote.behind,
    fileCount,
    fileChanges: getRemoteFileChangeCounts(remote),
    updatedAt: remoteBranch?.lastCommitDate ?? null,
    canPull: remote.canPull,
    diverged: remote.state === "diverged",
  };
}

function getRemoteFileChangeCounts(
  remote: GitStatusSnapshot["sourceControl"]["remote"],
): RemoteUpdateFileChangeCounts {
  const summary = remote.incomingFileSummary;
  if (summary) {
    return {
      added: (summary.added ?? 0) + (summary.copied ?? 0),
      modified: (summary.modified ?? 0) + (summary.changed ?? 0) + (summary.renamed ?? 0),
      deleted: summary.deleted ?? 0,
    };
  }

  return remote.incomingPreview.reduce<RemoteUpdateFileChangeCounts>((counts, file) => {
    if (file.status === "added" || file.status === "untracked" || file.status === "copied") {
      return { ...counts, added: counts.added + 1 };
    }
    if (file.status === "deleted") return { ...counts, deleted: counts.deleted + 1 };
    return { ...counts, modified: counts.modified + 1 };
  }, { added: 0, modified: 0, deleted: 0 });
}
