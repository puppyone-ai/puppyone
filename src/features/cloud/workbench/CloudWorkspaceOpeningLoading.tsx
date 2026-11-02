import { useSyncExternalStore } from "react";
import { useLocalization } from "@puppyone/localization";
import { ProjectOpeningLoading } from "../../../components/loading";
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
  return <ProjectOpeningLoading label={t(labels[phase])}>
    {onCancel && <button type="button" className="desktop-dialog-button"
      onClick={onCancel}>{t("common.action.cancel")}</button>}
  </ProjectOpeningLoading>;
}
