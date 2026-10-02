import { useMemo, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopDataWorkspaceSurface, type DesktopDataWorkspaceSurfaceProps } from "../../app-shell/DesktopDataWorkspaceSurface";
import { resolveWorkspaceSurface } from "../../app-shell/workspace-surfaces/workspaceSurfaceRegistry";
import { formatFileOperationNotice } from "../../data-workspace/useFileClipboard";
import { DesktopCreateEntryDialog, DesktopCreateEntryMenu, DesktopNodeActionMenu } from "../../data-workspace/nodeActions";
import { resolveVisibleCreateNewMenuItems } from "../../../preferences";
import type { NativeCloudWorkbench } from "./useNativeCloudWorkbench";

const noop = () => undefined;
const dataSurface = resolveWorkspaceSurface({ capabilities: { cloudEnabled: true }, requestedId: "data",
  adapters: { data: () => ({ sidebar: null, main: null }), git: () => ({ sidebar: null, main: null }),
    cloud: () => ({ sidebar: null, main: null }), settings: () => ({ sidebar: null, main: null }) } });

/** Bind Cloud data/actions to the existing workbench; no alternate file UI. */
export function DesktopCloudFileWorkspace({ workbench, surfaceProps, providerStateContent }: {
  workbench: NativeCloudWorkbench;
  surfaceProps: DesktopDataWorkspaceSurfaceProps;
  providerStateContent: ReactNode;
}) {
  return workbench.surfaceVisited
    ? <CloudFileBinding key={workbench.surfaceService.workspace.id} workbench={workbench}
        surfaceProps={surfaceProps} providerStateContent={providerStateContent} />
    : null;
}

function CloudFileBinding({ workbench, surfaceProps, providerStateContent }: {
  workbench: NativeCloudWorkbench;
  surfaceProps: DesktopDataWorkspaceSurfaceProps;
  providerStateContent: ReactNode;
}) {
  const { t } = useLocalization();
  const { surfaceService, dataPort, editorWorkbench, actions } = workbench;
  const { createEntryDraft, nodeActionMenu, fileClipboardController: clipboard } = actions;
  const { preferences } = surfaceProps;
  const folders = useMemo(() => [surfaceService.folder], [surfaceService]);
  const createItems = useMemo(() => {
    const items = resolveVisibleCreateNewMenuItems(preferences.createNewMenuSettings, preferences.experimentalSettings);
    return { main: items.main.filter((item) => item !== "slides"), submenu: items.submenu.filter((item) => item !== "slides") };
  }, [preferences.createNewMenuSettings, preferences.experimentalSettings]);
  return <>
    <DesktopDataWorkspaceSurface {...surfaceProps}
      dataPort={dataPort ?? surfaceService.dataPort} documentSourceKind="cloud"
      providerStateContent={dataPort ? undefined : workbench.error
        ? <div className="empty-preview" role="alert" dir="auto">{workbench.error}</div>
        : providerStateContent}
      activeAiEditRequest={null} activeDocumentPath={editorWorkbench.activePath}
      activeExplorerPath={workbench.activeNode?.path ?? editorWorkbench.activePath}
      workspace={surfaceService.workspace} workspaceFolders={folders}
      resolveWorkspaceResource={surfaceService.resolveResource} editorWorkbench={editorWorkbench}
      externalOpen={{ open: (path) => workbench.onActivePathChange(path) }}
      resolvedSurface={dataSurface}
      navigation={{ ...surfaceProps.navigation, activeView: "data", gitEnabled: false,
        gitIncomingCount: 0, gitOperationLoading: null, gitStatus: null, workspaceChangeCount: 0 }}
      fileClipboardController={clipboard} fileOperationNotice={formatFileOperationNotice(clipboard.notice, t)}
      onActiveDataPathChange={workbench.onActivePathChange} onActiveDataNodeChange={workbench.setActiveNode}
      onResourceMove={editorWorkbench.rebaseResource} onRemoveProject={noop}
      onCreateEntryMenu={(parent, anchor) => { if (surfaceService.writable) actions.openCreateEntryMenu(parent ?? surfaceService.folder.uri, anchor); }}
      onDismissCreateEntryMenu={() => actions.setCreateEntryDraft(null)}
      onNodeActionMenu={actions.openNodeActionMenu}
      openCreateEntryParentPath={createEntryDraft?.parentPath} openNodeActionPath={nodeActionMenu?.node.path ?? null}
      sidebarCreateMenuOpen={Boolean(createEntryDraft && !createEntryDraft.selectedKind)}
      workspaceRefreshToken={workbench.refreshToken} workspaceAtomicRefreshToken={0}
      workspaceSurfaceError={dataPort ? workbench.error : null} />
    {createEntryDraft && (createEntryDraft.selectedKind
      ? <DesktopCreateEntryDialog draft={createEntryDraft} fileIconTheme={preferences.fileIconTheme}
          onChange={actions.setCreateEntryDraft} onCancel={() => actions.setCreateEntryDraft(null)} onCreate={actions.createEntryFromMenu} />
      : <DesktopCreateEntryMenu draft={createEntryDraft} mainEntries={createItems.main} submenuItemKinds={createItems.submenu}
          fileIconTheme={preferences.fileIconTheme} onCancel={() => actions.setCreateEntryDraft(null)} onSelectKind={actions.selectCreateEntryKind} />)}
    {nodeActionMenu && <DesktopNodeActionMenu draft={nodeActionMenu} experimentalSettings={preferences.experimentalSettings}
      showRevealInFinder={false} showOpenInDefaultApp={false} canCopy={clipboard.canCopy} canCut={clipboard.canCut}
      canPaste={nodeActionMenu.node.type === "folder" && clipboard.canPasteInto(nodeActionMenu.node.path)} canDuplicate={clipboard.canDuplicate}
      onChange={actions.setNodeActionMenu} onCancel={() => actions.setNodeActionMenu(null)}
      onCopy={() => { clipboard.copyNodes(nodeActionMenu.nodes); actions.setNodeActionMenu(null); }}
      onCut={() => { clipboard.cutNodes(nodeActionMenu.nodes); actions.setNodeActionMenu(null); }}
      onPaste={() => { actions.setNodeActionMenu(null); void clipboard.pasteNodes(nodeActionMenu.node.path); }}
      onDuplicate={noop} onCreateInside={() => actions.openCreateEntryMenu(nodeActionMenu.node.path, nodeActionMenu.anchor)}
      onRename={actions.renameNodeFromMenu} onDelete={actions.deleteNodeFromMenu}
      onOpenInDefaultApp={noop} onRevealInFinder={noop} />}
  </>;
}
