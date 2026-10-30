import { useEffect, useRef } from "react";
import { useLocalization } from "@puppyone/localization";
import { DataWorkspaceFrame, ExplorerTree, type DataWorkspaceExplorerFrame } from "@puppyone/shared-ui";
import { CloudWorkspaceOpeningLoading } from "./CloudWorkspaceOpeningLoading";
import type { CloudWorkspaceOpeningProgress } from "../files/cloudWorkspaceOpening";

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
export function CloudWorkspacePreparation({ progress, explorerFrame, onCancel }: {
  progress: CloudWorkspaceOpeningProgress;
  /** The window's Explorer column, supplied by the shell that owns it. */
  explorerFrame: DataWorkspaceExplorerFrame;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const surfaceRef = useRef<HTMLElement>(null);
  useEffect(() => { surfaceRef.current?.focus({ preventScroll: true }); }, []);
  return <section ref={surfaceRef} className="desktop-cloud-preparation" aria-label={t("cloud.productName")}
    aria-busy tabIndex={-1} onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }}>
    <div className="desktop-data-workspace-wrap" data-file-workbench="true">
      <DataWorkspaceFrame {...explorerFrame} explorer={() => (
        <div className="data-explorer-layout">
          <div className="data-explorer-pane">
            <ExplorerTree nodes={NO_NODES} activePath={null} expandedPaths={NO_PATHS}
              rootLoading loadingPresentation="skeleton" showRoot={false}
              loadingLabel={t("shared-ui.explorer.loadingWorkspace")} onSelectNode={ignoreSelection} />
          </div>
        </div>
      )}>
        <CloudWorkspaceOpeningLoading progress={progress} onCancel={onCancel} />
      </DataWorkspaceFrame>
    </div>
  </section>;
}
