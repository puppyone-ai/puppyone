import { DesktopEntryState } from "../../components/DesktopEntryState";
import { useLocalization } from "@puppyone/localization/react";
import { VersionControlIcon } from "./VersionControlIcon";

type VersionControlSetupStateProps = {
  enabling: boolean;
  operationError: string | null;
  onEnable: () => void;
};

/**
 * Full-page entry point for a workspace that has not opted into version control.
 * It owns presentation only; repository mutation remains in the controller.
 */
export function VersionControlSetupState({
  enabling,
  operationError,
  onEnable,
}: VersionControlSetupStateProps) {
  const { t } = useLocalization();
  return (
    <DesktopEntryState
      className="desktop-version-control-setup-entry"
      ariaLabel={t("source-control.setup.ariaLabel")}
      visual={(
        <div className="desktop-version-control-mark-frame">
          <VersionControlIcon className="desktop-version-control-mark" />
        </div>
      )}
      title={t("source-control.setup.title")}
      action={(
        <button
          className="desktop-version-control-enable-button"
          type="button"
          disabled={enabling}
          onClick={onEnable}
        >
          {t(enabling ? "source-control.setup.enabling" : "source-control.setup.enable")}
        </button>
      )}
      feedback={operationError ? (
        <p className="desktop-version-control-setup-error" role="status">
          {operationError}
        </p>
      ) : undefined}
    />
  );
}
