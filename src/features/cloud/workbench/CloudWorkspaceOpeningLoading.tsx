import { useSyncExternalStore } from "react";
import { useLocalization } from "@puppyone/localization";
import { LoadingMark } from "@puppyone/shared-ui";
import type { CloudWorkspaceOpeningPhase, CloudWorkspaceOpeningProgress } from "../files/cloudWorkspaceOpening";

const labels = {
  checking: "cloud.loading.startingWorkspace",
  connecting: "cloud.loading.startingWorkspace",
  files: "cloud.loading.files",
} as const satisfies Record<CloudWorkspaceOpeningPhase, string>;

export function CloudWorkspaceOpeningLoading({ progress, onCancel }: {
  progress: CloudWorkspaceOpeningProgress;
  onCancel?: () => void;
}) {
  const { t } = useLocalization();
  const phase = useSyncExternalStore(progress.subscribe, progress.getSnapshot);
  return <div className="desktop-cloud-opening" role="status" aria-live="polite" aria-atomic="true">
    <LoadingMark layout="area" size="md" tone="neutral" ariaHidden />
    <p className="desktop-cloud-opening-label">{t(labels[phase])}</p>
    {onCancel && <button type="button" className="desktop-dialog-button"
      onClick={onCancel}>{t("common.action.cancel")}</button>}
  </div>;
}
