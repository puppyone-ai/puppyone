import { useEffect, useRef, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import { DataWorkspaceFrame, ExplorerTree, type DataWorkspaceExplorerFrame } from "@puppyone/shared-ui";
import { useNativeSurfaceOcclusionLease } from "../../native-surfaces";

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
 *
 * Focus waits here, and returns to the entry that opened the project if the
 * open fails or is cancelled. Once the project is open that entry is gone and
 * focus belongs to the workbench.
 */
export function ProjectPreparation({ explorerFrame, onCancel, children }: {
  /** The window's Explorer column, supplied by the shell that owns it. */
  explorerFrame: DataWorkspaceExplorerFrame;
  /** Absent while the open cannot be abandoned. */
  onCancel?: () => void;
  /** What stands in the editor's place. */
  children: ReactNode;
}) {
  const { t } = useLocalization();
  // A native preview in the project being left draws above the page.
  useNativeSurfaceOcclusionLease();
  const surfaceRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef(document.activeElement);
  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    surfaceRef.current?.focus({ preventScroll: true });
    return () => {
      if (!(previousFocus instanceof HTMLElement)) return;
      queueMicrotask(() => {
        if (previousFocus.isConnected && document.activeElement === document.body) {
          previousFocus.focus({ preventScroll: true });
        }
      });
    };
  }, []);
  return <section ref={surfaceRef} className="desktop-project-preparation"
    aria-label={t("onboarding.status.loadingProject")}
    aria-busy tabIndex={-1} onKeyDown={(event) => {
      if (event.key !== "Escape" || !onCancel) return;
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
        {children}
      </DataWorkspaceFrame>
    </div>
  </section>;
}
