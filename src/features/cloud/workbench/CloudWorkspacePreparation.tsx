import { RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { ExplorerTreeSkeleton } from "@puppyone/shared-ui";
import { PageLoading } from "../../../components/loading";
import { formatCloudMessage } from "../cloudPresentation";
import type { CloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";

/** Presentation for the requested destination; no provider or editor ownership. */
export function CloudWorkspacePreparation({ controller }: { controller: CloudWorkspaceSwitch }) {
  const { t } = useLocalization();
  return <section className="desktop-cloud-preparation" aria-label={t("cloud.productName")}
    aria-busy={!controller.error}>
    <aside className="explorer-column desktop-cloud-preparation-rail">
      {/* The tree shell owns row geometry; the list owns its outer gutters. */}
      <div className="explorer-tree-shell no-root">
        <div className="explorer-tree-scroll" data-po-scrollbar="sidebar">
          <div className="explorer-tree-list">
            {!controller.error && <ExplorerTreeSkeleton loadingLabel={t("shared-ui.explorer.loadingWorkspace")} />}
          </div>
        </div>
      </div>
    </aside>
    <main className="browser-column desktop-editor-panel">
      {controller.error ? <div className="editor-state editor-state--stacked">
        <p role="alert">{formatCloudMessage(controller.error, t)}</p>
        <button type="button" className="desktop-cloud-row-action" onClick={controller.retry}>
          <RefreshCw size={13} /><span>{t("cloud.common.retry")}</span>
        </button>
      </div> : <PageLoading variant="fill" label={null} ariaLabel={t("cloud.loading.project")} />}
    </main>
  </section>;
}
