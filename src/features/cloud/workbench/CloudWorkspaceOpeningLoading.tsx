import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocalization } from "@puppyone/localization";
import { LoadingMark } from "@puppyone/shared-ui";
import type { CloudWorkspaceOpeningPhase, CloudWorkspaceOpeningProgress } from "../files/cloudWorkspaceOpening";

const labels = {
  checking: "cloud.loading.startingWorkspace",
  connecting: "cloud.loading.startingWorkspace",
  files: "cloud.loading.files",
} as const satisfies Record<CloudWorkspaceOpeningPhase, string>;

const hints = {
  checking: "cloud.loading.startingWorkspaceHint",
  connecting: "cloud.loading.startingWorkspaceHint",
  files: "cloud.loading.filesHint",
} as const satisfies Record<CloudWorkspaceOpeningPhase, string>;

/** A running project opens sooner than this; only a real wait explains itself. */
const HINT_DELAY_MS = 3_000;

export function CloudWorkspaceOpeningLoading({ progress, onCancel }: {
  progress: CloudWorkspaceOpeningProgress;
  onCancel?: () => void;
}) {
  const { t } = useLocalization();
  const phase = useSyncExternalStore(progress.subscribe, progress.getSnapshot);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(true), HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return <div className="desktop-cloud-opening" role="status" aria-live="polite" aria-atomic="true">
    <LoadingMark layout="area" size="md" tone="neutral" ariaHidden />
    <p className="desktop-cloud-opening-label">{t(labels[phase])}</p>
    {waiting && <p className="desktop-cloud-opening-hint">{t(hints[phase])}</p>}
    {onCancel && <button type="button" className="desktop-dialog-button"
      onClick={onCancel}>{t("common.action.cancel")}</button>}
  </div>;
}
