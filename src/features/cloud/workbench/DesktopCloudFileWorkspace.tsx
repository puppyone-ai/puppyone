import { useDesktopPreference } from "../../settings";
import { useMemo, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopDataWorkspaceSurface, type DesktopDataWorkspaceSurfaceProps } from "../../app-shell/DesktopDataWorkspaceSurface";
import { resolveWorkspaceSurface } from "../../app-shell/workspace-surfaces/workspaceSurfaceRegistry";
import { formatFileOperationNotice } from "../../data-workspace/useFileClipboard";
import { DesktopCreateEntryDialog, DesktopCreateEntryMenu, DesktopNodeActionMenu, toDesktopNodeActionError } from "../../data-workspace/nodeActions";
import { resolveVisibleCreateNewMenuItems } from "../../../preferences";
import type { NativeCloudWorkbench } from "./useNativeCloudWorkbench";
import { getDesktopCloudWebUrl } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { workspaceResourceUrl } from "../files/workspaceResourceUrl";

const noop = () => undefined;
const dataSurface = resolveWorkspaceSurface({ capabilities: { cloudEnabled: true }, requestedId: "data",
  adapters: { data: () => ({ sidebar: null, main: null }), git: () => ({ sidebar: null, main: null }),
    cloud: () => ({ sidebar: null, main: null }), settings: () => ({ sidebar: null, main: null }) } });

export type CloudFileSurfaceProps = Pick<DesktopDataWorkspaceSurfaceProps,
  "showSaveStatus" | "viewerExtensionAdapter" | "sidebarCompanion" | "sidebarUtility" | "navigation">;

/** Bind Cloud data/actions to the existing workbench; no alternate file UI. */
export function DesktopCloudFileWorkspace({ workbench, surfaceProps, providerStateContent }: {
  workbench: NativeCloudWorkbench;
  surfaceProps: CloudFileSurfaceProps;
  providerStateContent: ReactNode;
}) {
  return workbench.surfaceVisited
    ? <CloudFileBinding key={workbench.surfaceService.workspace.id} workbench={workbench}
        surfaceProps={surfaceProps} providerStateContent={providerStateContent} />
    : null;
}

function CloudFileBinding({ workbench, surfaceProps, providerStateContent }: {
  workbench: NativeCloudWorkbench;
  surfaceProps: CloudFileSurfaceProps;
  providerStateContent: ReactNode;
}) {
  const { t } = useLocalization();
  const { surfaceService, dataPort, editorWorkbench, actions } = workbench;
  const { createEntryDraft, nodeActionMenu, fileClipboardController: clipboard } = actions;
  const copyLink = async () => {
    if (!nodeActionMenu || nodeActionMenu.operation || !surfaceService.workspace.projectId) return;
    const pending = { ...nodeActionMenu, operation: "copy-link" as const, error: null };
    actions.setNodeActionMenu(pending);
    try {
      const path = surfaceService.getPathForCopy(nodeActionMenu.node.path);
      const url = workspaceResourceUrl(getDesktopCloudWebUrl("/"), surfaceService.workspace.projectId,
        path === "." ? "" : path, nodeActionMenu.node.type === "folder");
      await writeClipboardText(url);
      actions.setNodeActionMenu(current => current === pending ? null : current);
    } catch (error) {
      actions.setNodeActionMenu(current => current === pending
        ? { ...current, operation: null, error: toDesktopNodeActionError(error) } : current);
    }
  };
  const createNewMenuSettings = useDesktopPreference(s => s.createNewMenuSettings);
  const enablePuppyFlowFiles = useDesktopPreference(s => s.experimentalSettings.enablePuppyFlowFiles);
  const folders = useMemo(() => [surfaceService.folder], [surfaceService]);
  const createItems = useMemo(() => {
    const items = resolveVisibleCreateNewMenuItems(createNewMenuSettings, { enablePuppyFlowFiles });
    return { main: items.main.filter((item) => item !== "slides"), submenu: items.submenu.filter((item) => item !== "slides") };
  }, [createNewMenuSettings, enablePuppyFlowFiles]);
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
      openCreateEntryParentPath={createEntryDraft && !createEntryDraft.selectedKind
        && createEntryDraft.anchor.placement !== "auto-end" ? createEntryDraft.parentPath : undefined}
      openNodeActionPath={nodeActionMenu?.mode === "actions"
        ? nodeActionMenu.launcherPath ?? nodeActionMenu.node.path : null}
      sidebarCreateMenuOpen={Boolean(createEntryDraft && !createEntryDraft.selectedKind)}
      workspaceRefreshToken={workbench.refreshToken} workspaceAtomicRefreshToken={0}
      workspaceSurfaceError={dataPort ? workbench.error : null}
      onRetryWorkspaceSurface={dataPort ? () => { void workbench.resumeWorkspace(); } : undefined} />
    {createEntryDraft && (createEntryDraft.selectedKind
      ? <DesktopCreateEntryDialog draft={createEntryDraft}
          onChange={actions.setCreateEntryDraft} onCancel={() => actions.setCreateEntryDraft(null)} onCreate={actions.createEntryFromMenu} />
      : <DesktopCreateEntryMenu draft={createEntryDraft} mainEntries={createItems.main} submenuItemKinds={createItems.submenu}
          onCancel={() => actions.setCreateEntryDraft(null)} onSelectKind={actions.selectCreateEntryKind} />)}
    {nodeActionMenu && <DesktopNodeActionMenu draft={nodeActionMenu}
      showRevealInFinder={false} showOpenInDefaultApp={false} canCopy={clipboard.canCopy} canCut={clipboard.canCut}
      canPaste={nodeActionMenu.node.type === "folder" && clipboard.canPasteInto(nodeActionMenu.node.path)} canDuplicate={clipboard.canDuplicate}
      onChange={actions.setNodeActionMenu} onCancel={() => actions.setNodeActionMenu(null)}
      onCopyPath={actions.copyNodePathFromMenu}
      onCopyLink={copyLink}
      onCopy={() => { clipboard.copyNodes(nodeActionMenu.nodes); actions.setNodeActionMenu(null); }}
      onCut={() => { clipboard.cutNodes(nodeActionMenu.nodes); actions.setNodeActionMenu(null); }}
      onPaste={() => { actions.setNodeActionMenu(null); void clipboard.pasteNodes(nodeActionMenu.node.path); }}
      onDuplicate={noop} onCreateInside={() => actions.openCreateEntryMenu(nodeActionMenu.node.path, nodeActionMenu.anchor)}
      onRename={actions.renameNodeFromMenu} onDelete={actions.deleteNodeFromMenu}
      onOpenInDefaultApp={noop} onRevealInFinder={noop} />}
  </>;
}
