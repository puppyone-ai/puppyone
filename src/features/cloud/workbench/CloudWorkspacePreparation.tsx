import { useLocalization } from "@puppyone/localization";
import { DataWorkspaceFrame, ExplorerTree } from "@puppyone/shared-ui";
import { CloudWorkspaceOpeningLoading } from "./CloudWorkspaceOpeningLoading";
import { useDesktopExplorerFrame } from "../../app-shell/layout/useDesktopExplorerFrame";
import { formatCloudMessage } from "../cloudPresentation";
import type { CloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";
import { CloudWorkspaceRecovery } from "./CloudWorkspaceRecovery";

const NO_NODES: never[] = [];
const NO_PATHS: ReadonlySet<string> = new Set();
const ignoreSelection = () => {};

/**
 * The destination's workbench while it opens: no provider or editor ownership.
 *
 * It stands in the same frame as the file workbench, not a drawing of one.
 * The Explorer column's width, collapse and resize handle are the window's,
 * so the user can size the column while the files are on their way and the
 * files arrive in the column they left; the tree is the file tree itself,
 * waiting for its first folder.
 */
export function CloudWorkspacePreparation({ controller, onOpenAccount }: { controller: CloudWorkspaceSwitch; onOpenAccount?: () => void }) {
  const { t } = useLocalization();
  const explorerFrame = useDesktopExplorerFrame();
  return <section className="desktop-cloud-preparation" aria-label={t("cloud.productName")}
    aria-busy={!controller.error}>
    <div className="desktop-data-workspace-wrap" data-file-workbench="true">
      <DataWorkspaceFrame {...explorerFrame} explorer={() => (
        <div className="data-explorer-layout">
          <div className="data-explorer-pane">
            <ExplorerTree nodes={NO_NODES} activePath={null} expandedPaths={NO_PATHS}
              rootLoading={!controller.error} loadingPresentation="skeleton" showRoot={false}
              loadingLabel={t("shared-ui.explorer.loadingWorkspace")} onSelectNode={ignoreSelection} />
          </div>
        </div>
      )}>
        {controller.error ? <CloudWorkspaceRecovery message={formatCloudMessage(controller.error, t)}
          title={t("cloud.opening.failedTitle")}
          onRetry={controller.recoveryAction === "retry" ? controller.retry : undefined}
          actions={<>
            <button type="button" className="desktop-dialog-button" onClick={controller.cancel}>{t("common.action.close")}</button>
            {controller.recoveryAction === "account" && onOpenAccount && <button type="button" className="desktop-dialog-button" onClick={onOpenAccount}>{t("settings.sidebar.account")}</button>}
          </>} /> : <CloudWorkspaceOpeningLoading phase={controller.openingPhase} />}
      </DataWorkspaceFrame>
    </div>
  </section>;
}
