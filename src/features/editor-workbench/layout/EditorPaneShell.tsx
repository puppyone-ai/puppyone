import { useRef, type ReactNode } from "react";
import { PanelBottom, PanelLeft, PanelRight, PanelTop } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type {
  EditorFindCommand,
  EditorPaneLayoutLeaf,
  EditorPaneMenuContribution,
  EditorPaneSplitOptions,
  EditorSplitDirection,
} from "@puppyone/shared-ui";
import { ProjectOpeningLoading } from "../../../components/loading";
import type { EditorFileDropController } from "../drag-and-drop/useExplorerFileDrop";
import type { PaneMoveDragController } from "../drag-and-drop/usePaneMoveDrag";
import type { PaneDropEdge } from "../drag-and-drop/paneDropGeometry";
import { EditorPaneChrome } from "./EditorPaneChrome";
import { useEditorPaneChromeReveal } from "./useEditorPaneChromeReveal";
import {
  AgentFilePresence,
  desktopAgentActivityStore,
} from "../../desktop-agent-presence";

const FILE_SPLIT_CARDS = [
  { edge: "left", Icon: PanelLeft, label: "editor.panes.splitLeft" },
  { edge: "right", Icon: PanelRight, label: "editor.panes.splitRight" },
  { edge: "top", Icon: PanelTop, label: "editor.panes.splitUp" },
  { edge: "bottom", Icon: PanelBottom, label: "editor.panes.splitDown" },
] as const;

function resolveDropKind(
  insertIntent: boolean,
  fileEdge: PaneDropEdge | null,
  paneEdge: PaneDropEdge | null,
): "insert" | "file" | "pane" | undefined {
  if (insertIntent) return "insert";
  if (fileEdge) return "file";
  if (paneEdge) return "pane";
  return undefined;
}

export type EditorPaneShellProps = Readonly<{
  active: boolean;
  actionsOpen: boolean;
  agentPresencePath: string | null;
  children: ReactNode;
  /** `opening` is a pane the project's first document has not reached yet. */
  contentState: "empty" | "opening" | "document";
  editorLabel: string | null;
  fileDrop: EditorFileDropController;
  findCommand: EditorFindCommand | null;
  menuContribution: EditorPaneMenuContribution | null;
  pane: EditorPaneLayoutLeaf;
  paneCount: number;
  paneMove: PaneMoveDragController;
  onActionsPaneChange: (paneId: string | null) => void;
  onActivate: () => void;
  onReview?: () => void;
  onClose: () => void;
  onOpenExternal: (() => void | Promise<void>) | null;
  onSplit: (
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
}>;

/** Lightweight interaction chrome around a memoized Viewer runtime. */
export function EditorPaneShell({
  active,
  actionsOpen,
  agentPresencePath,
  children,
  contentState,
  editorLabel,
  fileDrop,
  findCommand,
  menuContribution,
  pane,
  paneCount,
  paneMove,
  onActionsPaneChange,
  onActivate,
  onReview,
  onClose,
  onOpenExternal,
  onSplit,
}: EditorPaneShellProps) {
  const { t } = useLocalization();
  const paneRef = useRef<HTMLElement>(null);
  const chromeReveal = useEditorPaneChromeReveal(paneRef, actionsOpen);
  const paneMoveEdge = paneMove.dropIntent?.targetPaneId === pane.id
    ? paneMove.dropIntent.edge
    : null;
  const fileDropEdge = fileDrop.dropIntent?.targetPaneId === pane.id
    ? fileDrop.dropIntent.edge
    : null;
  const dropEdge = fileDropEdge ?? paneMoveEdge;

  const emptyContent = contentState === "opening" ? (
    <div className="desktop-editor-pane-empty">
      <ProjectOpeningLoading ariaLabel={t("editor.loadingFile")} />
    </div>
  ) : (
    <div className="desktop-editor-pane-empty" role="status">
      <span>{t("shared-ui.preview.selectFile")}</span>
    </div>
  );

  return (
    <section
      ref={paneRef}
      className="desktop-editor-pane"
      data-editor-pane-id={pane.id}
      data-active={active ? "true" : undefined}
      data-content-state={contentState}
      data-empty={contentState === "empty" ? "true" : undefined}
      data-handle-hot={chromeReveal.revealed ? "true" : undefined}
      data-pane-menu-open={actionsOpen ? "true" : undefined}
      data-drop-target={dropEdge ?? undefined}
      data-drop-kind={resolveDropKind(
        fileDrop.insertTargetPaneId === pane.id,
        fileDropEdge,
        paneMoveEdge,
      )}
      aria-label={editorLabel
        ? t("editor.panes.label", { name: editorLabel })
        : t("editor.panes.empty")}
      onFocusCapture={onActivate}
      onPointerMove={chromeReveal.onPointerMove}
      onPointerLeave={chromeReveal.onPointerLeave}
      onPointerUp={(event) => {
        // Focusable editors activate through focus after native caret placement.
        // Pointer-up covers non-focusable previews after selection handling.
        if (event.button === 0) { onReview?.(); onActivate(); }
      }}
      onDragEnterCapture={(event) => fileDrop.over(event, pane.id)}
      onDragOverCapture={(event) => fileDrop.over(event, pane.id)}
      onDragLeaveCapture={(event) => fileDrop.leave(event, pane.id)}
      onDropCapture={(event) => fileDrop.drop(event, pane.id)}
    >
      {agentPresencePath && (
        <AgentFilePresence path={agentPresencePath} store={desktopAgentActivityStore} />
      )}
      <EditorPaneChrome
        actionsOpen={actionsOpen}
        editorLabel={editorLabel}
        findCommand={findCommand}
        menuContribution={menuContribution}
        pane={pane}
        paneCount={paneCount}
        paneMove={paneMove}
        paneRef={paneRef}
        onActionsPaneChange={onActionsPaneChange}
        onClose={onClose}
        onOpenExternal={onOpenExternal}
        onSplit={onSplit}
      />
      <div className="desktop-editor-pane-content">
        {contentState === "document" ? children : emptyContent}
      </div>
      {fileDrop.splitTargetPaneId === pane.id && (
        <div className="desktop-editor-file-split-targets" data-file-split-targets aria-hidden="true">
          {FILE_SPLIT_CARDS.map(({ edge, Icon, label }) => (
            <div key={edge} className="desktop-editor-file-split-card" data-file-split-edge={edge}
              data-active={fileDropEdge === edge ? "true" : undefined}>
              <Icon size={20} />
              <span>{t(label)}</span>
            </div>
          ))}
        </div>
      )}
      {dropEdge && <div className="desktop-editor-drop-preview" data-edge={dropEdge} />}
      <div className="desktop-editor-pane-interaction-frame" aria-hidden="true" />
    </section>
  );
}
