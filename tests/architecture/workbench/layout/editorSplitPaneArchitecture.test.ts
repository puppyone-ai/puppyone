import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../../../../src/App.tsx", import.meta.url), "utf8");
const surfaceSource = readFileSync(
  new URL("../../../../src/features/app-shell/DesktopDataWorkspaceSurface.tsx", import.meta.url),
  "utf8",
);
const splitSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/layout/DesktopEditorSplitView.tsx", import.meta.url),
  "utf8",
);
const workbenchControllerSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench.ts", import.meta.url),
  "utf8",
);
const resizeSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/layout/EditorSplitResizeHandle.tsx", import.meta.url),
  "utf8",
);
const paneShellSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/layout/EditorPaneShell.tsx", import.meta.url),
  "utf8",
);
const paneChromeSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/layout/EditorPaneChrome.tsx", import.meta.url),
  "utf8",
);
const paneActionsMenuSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/layout/EditorPaneActionsMenu.tsx", import.meta.url),
  "utf8",
);
const paneChromeRevealSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/layout/useEditorPaneChromeReveal.ts", import.meta.url),
  "utf8",
);
const paneRuntimeSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/runtime/EditorPaneRuntime.tsx", import.meta.url),
  "utf8",
);
const paneDocumentRuntimeSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime.tsx", import.meta.url),
  "utf8",
);
const paneSourceLifecycle = readFileSync(
  new URL("../../../../src/features/editor-workbench/runtime/useEditorPaneSource.ts", import.meta.url),
  "utf8",
);
const dataWorkspaceSource = readFileSync(
  new URL("../../../../packages/shared-ui/src/data/DataWorkspace.tsx", import.meta.url),
  "utf8",
);
const viewerTypesSource = readFileSync(
  new URL("../../../../packages/shared-ui/src/editor/registry/viewerTypes.ts", import.meta.url),
  "utf8",
);
const resizeGestureSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/interactions/useSplitResizeGesture.ts", import.meta.url),
  "utf8",
);
const persistenceSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/persistence/editorWorkbenchPersistence.ts", import.meta.url),
  "utf8",
);
const paneMoveSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/drag-and-drop/usePaneMoveDrag.ts", import.meta.url),
  "utf8",
);
const paneMovePreviewSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/drag-and-drop/paneMovePreview.ts", import.meta.url),
  "utf8",
);
const fileDropSource = readFileSync(
  new URL("../../../../src/features/editor-workbench/drag-and-drop/useExplorerFileDrop.ts", import.meta.url),
  "utf8",
);
const dropGeometrySource = readFileSync(
  new URL("../../../../src/features/editor-workbench/drag-and-drop/paneDropGeometry.ts", import.meta.url),
  "utf8",
);
const splitStyles = readFileSync(
  new URL("../../../../src/features/editor-workbench/layout/desktop-editor-split-view.css", import.meta.url),
  "utf8",
);
const menuStyles = readFileSync(
  new URL("../../../../src/styles/menus.css", import.meta.url),
  "utf8",
);
const desktopMenuSource = readFileSync(
  new URL("../../../../src/components/DesktopMenu.tsx", import.meta.url),
  "utf8",
);
const dataShellStyles = readFileSync(
  new URL("../../../../src/features/data-workspace/data-shell.css", import.meta.url),
  "utf8",
);
const sharedDataWorkspaceStyles = readFileSync(
  new URL("../../../../packages/shared-ui/src/styles/data-workspace.css", import.meta.url),
  "utf8",
);
const layoutStyles = readFileSync(
  new URL("../../../../src/styles/layout.css", import.meta.url),
  "utf8",
);
const tokens = readFileSync(
  new URL("../../../../src/styles/tokens.css", import.meta.url),
  "utf8",
);
const headerStyles = readFileSync(
  new URL("../../../../src/features/app-shell/header-editor-columns.css", import.meta.url),
  "utf8",
);

describe("editor split-pane architecture", () => {
  it("keeps file selection out of the Header", () => {
    expect(appSource).not.toContain("DesktopEditorTabs");
    expect(appSource).not.toContain("titlebarEditorSlot");
    // The project rail may conditionally own this slot; the fallback remains sidebar chrome.
    expect(appSource).toMatch(/titlebarSidebarSlot=\{[^}]*\btitlebarSidebarSlot\b[^}]*\}/);
  });

  it("projects the pane tree inside the Data editor region", () => {
    expect(surfaceSource).toContain('mainSlot={resolvedSurface.id === "data"');
    expect(surfaceSource).toContain("<DesktopEditorSplitView");
    expect(surfaceSource).toContain("layout={editorWorkbench.paneLayout}");
    expect(surfaceSource).toContain('loadActiveFileSource={resolvedSurface.id !== "data"}');
    expect(splitSource).toContain('data-direction={split.direction}');
    expect(splitSource).toContain("touchesBlockEnd");
    expect(splitSource).toContain(
      'touchesBlockEnd={split.direction === "horizontal" && props.touchesBlockEnd}',
    );
    expect(splitSource).toContain("touchesBlockEnd={props.touchesBlockEnd}");
    expect(resizeSource).toContain('role="separator"');
    expect(paneChromeSource).toContain('className="desktop-editor-pane-handle"');
    expect(paneShellSource).not.toContain("paneCount > 1 &&");
    expect(splitSource).toContain("onOpenAtPaneEdge");
    expect(splitSource).toContain("onMovePane");
    expect(splitSource).toContain("onSplitPane");
    expect(paneActionsMenuSource).not.toContain('t("editor.panes.splitLeft")');
    expect(paneActionsMenuSource).not.toContain('t("editor.panes.splitRight")');
    expect(paneActionsMenuSource).not.toContain('t("editor.panes.splitUp")');
    expect(paneActionsMenuSource).not.toContain('t("editor.panes.splitDown")');
    expect(workbenchControllerSource).toContain("const splitPane = useCallback");
    expect(workbenchControllerSource).toContain("editorId: null");
    expect(paneShellSource).toContain('contentState: "empty" | "document"');
    expect(paneShellSource).toContain('data-content-state={contentState}');
    expect(paneDocumentRuntimeSource).not.toContain("if (invalidTreeNode) return null");
    expect(paneDocumentRuntimeSource).toContain('import { PageLoading } from "../../../components/loading"');
    expect(paneDocumentRuntimeSource).toContain('label={null}');
    expect(sharedDataWorkspaceStyles).not.toContain(".document-surface-pending::after");
    expect(sharedDataWorkspaceStyles).not.toContain("po-document-surface-spin");
    expect(paneShellSource).toContain('className="desktop-editor-drop-preview"');
    expect(dropGeometrySource).toContain("closestPaneDropEdge");
    expect(fileDropSource).toContain("classifyReferenceDataTransfer");
    expect(fileDropSource).toContain("claimEditorDropDocument");
    expect(fileDropSource).toContain("onOpenAtPaneEdge");
    expect(paneMoveSource).toContain("onMovePane");
  });

  it("fills the editor region and uses overlay handles with dedicated resize lanes", () => {
    expect(splitStyles).toContain("--desktop-editor-divider-size: var(--po-pane-resizer-line-size, 1px);");
    expect(splitStyles).toContain("--desktop-editor-resize-hit-size: var(--po-pane-resizer-hit-size, 8px);");
    expect(splitStyles).toContain("var(--desktop-editor-divider-size)");
    expect(splitStyles).toContain(".desktop-editor-splitter::before");
    expect(resizeGestureSource).toContain("const dividerSize");
    expect(splitStyles).toContain("flex: 1 1 0;");
    expect(splitStyles).toContain(".desktop-editor-pane-handle-shell");
    expect(splitStyles).toContain(".desktop-editor-pane[data-handle-hot]");
    const handleShellRule = readCssBlock(splitStyles, ".desktop-editor-pane-handle-shell");
    expect(handleShellRule).toContain("pointer-events: none;");
    expect(splitStyles).toContain("pointer-events: auto;");
    expect(splitStyles).toContain(".desktop-editor-drop-preview");
    expect(splitStyles).toContain(".desktop-editor-pane-move-preview");
    expect(splitStyles).toContain(".desktop-editor-pane[data-move-source]");
    const movePreviewRule = readCssBlock(splitStyles, ".desktop-editor-pane-move-preview");
    expect(movePreviewRule).toContain("border: 0;");
    expect(movePreviewRule).toContain("border-radius: 2px;");
    expect(movePreviewRule).not.toContain("0 18px 40px");
    const handleRule = readCssBlock(splitStyles, ".desktop-editor-pane-handle");
    expect(handleRule).toContain("border: 0;");
    expect(handleRule).toContain("background: transparent;");
    expect(handleRule).toContain("var(--po-text-muted) 68%");
    expect(handleRule).toContain("gap: 2px;");
    expect(handleRule).not.toContain("box-shadow:");
    expect(handleRule).not.toContain("border-radius:");
    const handleDotRule = readCssBlock(splitStyles, ".desktop-editor-pane-handle > i");
    expect(handleDotRule).toContain("width: 2px;");
    expect(handleDotRule).toContain("height: 2px;");
    expect(handleDotRule).toContain("border-radius: 0;");
    expect(handleDotRule).toContain("background: currentColor;");
    const menuPrimaryActionRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane-menu-primary-action.desktop-menu-icon-button",
    );
    expect(menuPrimaryActionRule).toContain("width: var(--desktop-editor-pane-menu-action-size);");
    expect(menuPrimaryActionRule).toContain("height: var(--desktop-editor-pane-menu-action-size);");
    expect(menuPrimaryActionRule).toContain("border-radius: var(--desktop-toolbar-action-radius);");
    const paneMenuRule = readCssBlock(splitStyles, ".desktop-editor-pane-menu");
    expect(paneMenuRule).toContain(
      "--desktop-editor-pane-menu-action-size: var(--desktop-titlebar-control-height);",
    );
    expect(paneMenuRule).toContain("position: fixed;");
    expect(paneMenuRule).toContain("overflow-y: auto;");
    expect(paneMenuRule).not.toContain("box-shadow:");
    expect(splitStyles).not.toContain('.desktop-editor-pane-menu[data-has-secondary="true"]');
    const closeActionRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane-menu-close-action.desktop-menu-icon-button",
    );
    expect(closeActionRule).toContain("color: var(--po-danger);");
    const endActionsRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane-menu-end-actions",
    );
    expect(endActionsRule).toContain("display: flex;");
    expect(endActionsRule).not.toContain("margin-inline-start: auto;");
    const segmentedEndActionsRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane-menu-segmented-control + .desktop-editor-pane-menu-end-actions",
    );
    expect(segmentedEndActionsRule).toContain("margin-inline-start: auto;");
    const externalDividerRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane-menu-action-divider",
    );
    expect(externalDividerRule).toContain("width: 1px;");
    expect(externalDividerRule).toContain("height: 18px;");
    expect(externalDividerRule).toContain("flex: 0 0 1px;");
    expect(externalDividerRule).toContain("margin-inline: 3px;");
    expect(externalDividerRule).toContain("background: var(--po-divider);");
    expect(externalDividerRule).toContain("pointer-events: none;");
    expect(splitStyles).not.toContain(".desktop-editor-pane-menu-action-divider::before");
    expect(paneActionsMenuSource).toContain('elevation="compact"');
    expect(desktopMenuSource).toContain('elevation?: "default" | "compact";');
    expect(desktopMenuSource).toContain(
      'data-menu-elevation={elevation === "compact" ? elevation : undefined}',
    );
    const compactMenuElevationRule = readCssBlock(
      menuStyles,
      '.desktop-menu-surface[data-menu-elevation="compact"]',
    );
    expect(compactMenuElevationRule).toContain(
      "--interface-menu-box-shadow: var(--po-menu-shadow-compact);",
    );
    expect(compactMenuElevationRule).toContain("box-shadow: var(--po-menu-shadow-compact);");
    expect(tokens).toContain("--po-menu-shadow-compact: var(--po-elevation-low);");
    expect(paneActionsMenuSource).toContain("PANE_DIVIDER_WIDTH = 1");
    expect(paneActionsMenuSource).toContain("PANE_DIVIDER_INLINE_MARGIN = 3");
    expect(paneActionsMenuSource).toContain(
      'className="desktop-editor-pane-menu-primary-action desktop-editor-pane-menu-close-action"',
    );
    const findActionIndex = paneActionsMenuSource.indexOf(
      "desktop-editor-pane-menu-find-action",
    );
    const externalActionIndex = paneActionsMenuSource.indexOf(
      "desktop-editor-pane-menu-external-action",
    );
    const closeActionIndex = paneActionsMenuSource.indexOf(
      "desktop-editor-pane-menu-close-action",
    );
    expect(findActionIndex).toBeGreaterThan(0);
    expect(externalActionIndex).toBeGreaterThan(findActionIndex);
    expect(closeActionIndex).toBeGreaterThan(externalActionIndex);
    expect(paneActionsMenuSource).not.toContain("PanelLeft");
    expect(paneActionsMenuSource).not.toContain("PanelRight");
    expect(paneActionsMenuSource).not.toContain("PanelTop");
    expect(paneActionsMenuSource).not.toContain("PanelBottom");
    expect(paneActionsMenuSource).toContain(
      "segmentedControl && <PaneMenuSegmentedControl item={segmentedControl}",
    );
    expect(paneActionsMenuSource).toContain("resolvePaneActionsMenuWidth({");
    expect(paneActionsMenuSource).toContain("PANE_ACTION_SLOT_SIZE = 25");
    expect(splitSource).toContain("editorResource: editor?.resource ?? null");
    expect(splitSource).toContain(
      "menuContribution?.editorResource === editor?.resource",
    );
    expect(splitSource).not.toContain(
      "menuContribution?.documentId === editor?.resource",
    );
    const segmentedControlRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane-menu-segmented-control",
    );
    expect(segmentedControlRule).toContain(
      "grid-auto-columns: var(--desktop-editor-pane-menu-action-size);",
    );
    expect(segmentedControlRule).toContain(
      "height: var(--desktop-editor-pane-menu-action-size);",
    );
    expect(segmentedControlRule).toContain("flex: 0 0 auto;");
    expect(segmentedControlRule).toContain("padding: 0;");
    expect(segmentedControlRule).toContain("border: 0;");
    expect(segmentedControlRule).toContain("background: transparent;");
    expect(segmentedControlRule).toContain("box-shadow: none;");
    const selectedSegmentRule = readCssBlock(
      splitStyles,
      '.desktop-editor-pane-menu-segment[aria-checked="true"]',
    );
    expect(selectedSegmentRule).toContain(
      "background: var(--desktop-titlebar-active, var(--po-selected));",
    );
    expect(selectedSegmentRule).toContain(
      "color: var(--desktop-titlebar-text, var(--po-text));",
    );
    const paneRule = readCssBlock(splitStyles, ".desktop-editor-pane");
    const paneFrameRule = readCssBlock(
      splitStyles,
      ".desktop-editor-pane-interaction-frame",
    );
    expect(paneRule).toContain("position: relative;");
    expect(paneRule).toContain("box-sizing: border-box;");
    expect(paneRule).not.toContain("border: 1px solid transparent;");
    expect(paneFrameRule).toContain("position: absolute;");
    expect(paneFrameRule).toContain("inset: 0;");
    expect(paneFrameRule).toContain("transition: color 90ms ease;");
    expect(splitStyles).toContain(
      ".desktop-editor-pane[data-handle-hot]:not([data-move-source])",
    );
    expect(splitStyles).toContain("color: var(--po-divider);");
    expect(splitStyles).not.toContain(".desktop-editor-pane::after");
    expect(splitStyles).not.toContain("@keyframes desktop-editor-pane-activate");
    expect(splitStyles).toContain("var(--po-pane-resizer-active-color)");
    expect(splitStyles).not.toContain(".desktop-editor-pane-bar");
    expect(splitStyles).not.toContain("border-radius: 7px 7px 0 0");
    expect(splitStyles).not.toContain("tablist");
  });

  it("isolates editor focus, overlay, and drag gesture state by scope", () => {
    expect(splitSource).toContain("openActionsPaneId");
    expect(paneShellSource).toContain("onFocusCapture={onActivate}");
    expect(paneShellSource).toContain("<EditorPaneChrome");
    expect(paneShellSource).toContain("useEditorPaneChromeReveal");
    expect(paneChromeRevealSource).toContain("PANE_HANDLE_REVEAL_RATIO = 1 / 3");
    expect(paneShellSource).toContain('data-handle-hot={chromeReveal.revealed ? "true" : undefined}');
    expect(paneShellSource).toContain("onPointerMove={chromeReveal.onPointerMove}");
    expect(paneChromeSource).toContain("onPointerEnter={() =>");
    expect(paneChromeSource).toContain("paneMove.prepare(paneRef.current, pane.id)");
    expect(paneChromeSource).toContain("onPointerUp={(event)");
    expect(paneShellSource).not.toContain("onPointerDownCapture");
    expect(paneChromeSource).not.toContain("consumeDraggedClick");
    expect(paneActionsMenuSource).toContain("<DesktopOverlayLayer>");
    expect(paneActionsMenuSource).toContain("useAnchoredOverlayPosition");
    expect(paneActionsMenuSource).toContain('alignment: "center"');
    expect(paneActionsMenuSource).toContain('placementPreference: "below"');
    expect(splitSource).not.toContain("key={layout.root.id}");
    expect(splitSource).toContain("key={split.first.id}");
    expect(splitSource).toContain("key={split.second.id}");
    expect(splitSource).toContain("key={split.id}");
    expect(splitSource).toContain("createEditorNodeIndex(editorTree)");
    expect(surfaceSource).toContain("editorTree={state.tree}");
    expect(surfaceSource).toContain("markdownEnvironment={state.markdownEnvironment}");
    expect(splitSource).not.toContain("DataWorkspaceState");
    expect(splitSource).not.toContain("state: DataWorkspaceState");
    expect(splitSource).toContain("<EditorPaneRuntime");
    expect(paneRuntimeSource).toContain("memo(function EditorPaneRuntime");
    expect(paneRuntimeSource).toContain("<EditorPaneDocumentRuntime");
    expect(paneDocumentRuntimeSource).toContain("memo(function EditorPaneDocumentRuntime");
    expect(paneDocumentRuntimeSource).toContain("useEditorPaneSource(sourceNode");
    expect(paneDocumentRuntimeSource).toContain("samePaneEnvironment");
    expect(paneDocumentRuntimeSource).toContain("getEditorProviderPolicy");
    expect(paneDocumentRuntimeSource).not.toContain("isMarkdownDocumentDescriptor");
    expect(dataWorkspaceSource).toContain("useStableEventCallback");
    expect(dataWorkspaceSource).toContain("markdownEnvironment: MarkdownWorkspaceEnvironment");
    expect(viewerTypesSource).toContain("export type MarkdownLinkCommands");
    expect(viewerTypesSource).toContain("export type MarkdownWorkspaceEnvironment");
    const graphContract = viewerTypesSource.slice(
      viewerTypesSource.indexOf("export type MarkdownLinkGraph ="),
      viewerTypesSource.indexOf("export type MarkdownLinkCommands ="),
    );
    expect(graphContract).toContain("revision: number");
    expect(graphContract).not.toContain("openWikiLink");
    expect(graphContract).not.toContain("openExternalUrl");
    expect(paneSourceLifecycle).toContain("useDocumentInput");
    expect(paneMoveSource).toContain("createPaneMovePreview");
    expect(paneMoveSource).toContain("destroyPaneMovePreview");
    expect(paneMoveSource).toContain("samePaneDropIntent");
    expect(paneMoveSource).toContain("PREPARED_SNAPSHOT_MAX_AGE_MS = 1_000");
    expect(paneMoveSource).toContain("PANE_MOVE_THRESHOLD_PX = 3");
    expect(paneMoveSource.indexOf("capturePaneMovePreview(sourcePane)"))
      .toBeLessThan(paneMoveSource.indexOf("distance < PANE_MOVE_THRESHOLD_PX"));
    expect(paneMovePreviewSource).toContain("capturePanePreview");
    expect(paneMovePreviewSource).toContain('getElementById("desktop-overlay-root")');
    expect(paneMovePreviewSource).not.toContain("cloneNode");
    expect(paneMovePreviewSource).not.toContain('querySelectorAll("*")');
    expect(paneMoveSource.indexOf('distance < PANE_MOVE_THRESHOLD_PX'))
      .toBeLessThan(paneMoveSource.indexOf('classList.add("desktop-editor-pane-dragging")'));
    expect(splitStyles).not.toContain(
      ".desktop-editor-pane-dragging .desktop-editor-pane-handle-shell",
    );
  });

  it("previews split resize outside React and commits durable metadata once", () => {
    expect(splitSource).toContain('"--desktop-editor-first-track"');
    expect(splitSource).toContain('"--desktop-editor-second-track"');
    expect(resizeGestureSource).toContain("requestAnimationFrame");
    expect(resizeGestureSource).toContain('finish("commit")');
    expect(resizeGestureSource).toContain('finish("cancel")');
    expect(resizeGestureSource).toContain('window.addEventListener("mouseup"');
    expect(resizeGestureSource).toContain(
      "session.onCommit(session.splitId, session.previewRatio)",
    );
    expect(resizeSource).toContain("useSplitResizeGesture");
  });

  it("coalesces Workbench metadata persistence behind an explicit flush boundary", () => {
    expect(persistenceSource).toContain("EDITOR_WORKBENCH_PERSISTENCE_DELAY_MS = 200");
    expect(persistenceSource).toContain("class EditorWorkbenchPersistenceScheduler");
    expect(persistenceSource).toContain("schedule(storageKey");
    expect(persistenceSource).toContain("flush(): void");
  });

  it("keeps one Sidebar and Editor layout boundary under an overlay sash", () => {
    const explorerRule = readCssBlock(sharedDataWorkspaceStyles, ".explorer-column");
    const resizerRule = readCssBlock(sharedDataWorkspaceStyles, ".data-explorer-resizer");


    expect(explorerRule).toContain(
      "border-inline-end: 1px solid var(--po-sidebar-divider, var(--po-divider));",
    );
    expect(resizerRule).toContain("background: transparent;");
    expect(resizerRule).toContain("inset-inline-start: auto;");
    expect(resizerRule).toContain(
      "inset-inline-end: calc(1px - var(--po-pane-resizer-hit-size, 8px));",
    );
    expect(sharedDataWorkspaceStyles).not.toContain(".data-explorer-resizer::after");
    expect(sharedDataWorkspaceStyles).not.toContain("grid-column: 3;");
    expect(sharedDataWorkspaceStyles).not.toMatch(
      /grid-template-columns:[^}]*var\(--po-pane-resizer-hit-size/s,
    );
    expect(dataShellStyles).not.toContain(".data-explorer-resizer");
    expect(splitStyles).not.toContain(
      "inset-inline-start: calc(-1 * var(--po-pane-resizer-hit-size, 8px));",
    );
    expect(splitStyles).toContain(
      "z-index: calc(var(--po-pane-resizer-z-index, 35) + 1);",
    );
    expect(surfaceSource).toContain("useNativeSurfacePointerRoutingRegion");
    expect(surfaceSource).toContain("explorerResizeHandleRef={setExplorerResizeHandle}");
  });

  it("does not project the Sidebar divider through the Header", () => {
    expect(headerStyles).not.toContain(".desktop-titlebar::before");
    expect(headerStyles).not.toContain("--desktop-titlebar-sidebar-width) - 1px");
  });

  it("lets Header context grow independently without nested flex-shrink phases", () => {
    const leadingContext = readCssBlock(
      headerStyles,
      ".desktop-titlebar-left:has(.desktop-titlebar-sidebar-context)",
    );
    const sidebarContext = readCssBlock(headerStyles, ".desktop-titlebar-sidebar-context");
    const expandedContext = readCssBlock(
      headerStyles,
      '.desktop-titlebar-sidebar-context[data-sidebar-state="expanded"]',
    );

    expect(leadingContext).toContain("min-width: 0;");
    expect(leadingContext).toContain("overflow: hidden;");
    expect(leadingContext).not.toContain("flex:");
    expect(sidebarContext).toContain("--desktop-titlebar-context-max-width: 440px;");
    expect(sidebarContext).toContain("max-width: 100%;");
    expect(sidebarContext).toContain("overflow: hidden;");
    expect(expandedContext).toContain("width: fit-content;");
    expect(expandedContext).toContain(
      "max-width: min(var(--desktop-titlebar-context-max-width), 100%);",
    );
    expect(expandedContext).not.toContain("flex:");
    expect(headerStyles).not.toContain("--desktop-titlebar-sidebar-width");
    expect(headerStyles).not.toContain("+ .desktop-titlebar-drag-fill");
  });

  it("shares neutral, hover, and active resize-boundary states across panes", () => {
    expect(tokens).toContain("--po-pane-resizer-blue: light-dark(#3b82f6, #60a5fa);");
    expect(tokens).toContain("--po-pane-resizer-hover-color:");
    expect(tokens).toContain("--po-pane-resizer-active-color:");
    expect(tokens).toContain("--po-pane-resizer-active-ring:");
    expect(tokens).not.toMatch(/--po-pane-resizer-(?:hover-color|active-color|active-ring):[^;]*--po-accent/);
    for (const styles of [readFileSync(new URL("../../../../packages/shared-ui/src/styles/sidebar-primitives.css", import.meta.url), "utf8"), splitStyles]) {
      expect(styles).toContain("var(--po-pane-resizer-hover-color)");
      expect(styles).toContain("var(--po-pane-resizer-active-color)");
      expect(styles).toContain("var(--po-pane-resizer-active-ring)");
    }
    expect(layoutStyles).toContain("body.desktop-right-sidebar-resizing");
    expect(readCssBlock(
      layoutStyles,
      "body.desktop-right-sidebar-resizing .desktop-right-sidebar.po-collapsible-pane-frame",
    )).toContain("transition: none !important;");
  });
});

function readCssBlock(css: string, selector: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}
