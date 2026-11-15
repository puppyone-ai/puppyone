import { useDesktopPreference } from "../../settings";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopDataWorkspaceSurface, type DesktopDataWorkspaceSurfaceProps } from "../../app-shell/DesktopDataWorkspaceSurface";
import { resolveWorkspaceSurface } from "../../app-shell/workspace-surfaces/workspaceSurfaceRegistry";
import { formatFileOperationNotice } from "../../data-workspace/useFileClipboard";
import { DesktopCreateEntryMenu, DesktopNodeActionMenu, toDesktopNodeActionError } from "../../data-workspace/nodeActions";
import { resolveVisibleCreateNewMenuItems } from "../../../preferences";
import type { RemoteFolderWorkbench } from "../../remote-workbench";
import { getDesktopCloudWebUrl } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { workspaceResourceUrl } from "../files/workspaceResourceUrl";
import type { NativeCloudDataService } from "../files/cloudDataPort";
import { readCloudSandbox } from "../sandbox/cloudSandboxFeatures";
import type { CloudSandbox, CloudSandboxSettings } from "../files/contracts";
import { CloudScreenThumbnail, CloudScreenView } from "../sandbox/CloudComputerScreen";

const noop = () => undefined;
const dataSurface = resolveWorkspaceSurface({ capabilities: { cloudEnabled: true }, requestedId: "data",
  adapters: { data: () => ({ sidebar: null, main: null }), git: () => ({ sidebar: null, main: null }),
    cloud: () => ({ sidebar: null, main: null }), settings: () => ({ sidebar: null, main: null }) } });

export type CloudFileSurfaceProps = Pick<DesktopDataWorkspaceSurfaceProps,
  "showSaveStatus" | "viewerExtensionAdapter" | "sidebarCompanion" | "sidebarUtility" | "navigation">;

/** Bind a remote folder (a Cloud project or another computer's folder) to the existing workbench. */
export function DesktopCloudFileWorkspace({ workbench, surfaceProps, providerStateContent }: {
  workbench: RemoteFolderWorkbench;
  surfaceProps: CloudFileSurfaceProps;
  providerStateContent: ReactNode;
}) {
  return workbench.surfaceVisited
    ? <CloudFileBinding key={workbench.surfaceService.workspace.id} workbench={workbench}
        surfaceProps={surfaceProps} providerStateContent={providerStateContent} />
    : null;
}

function CloudFileBinding({ workbench, surfaceProps, providerStateContent }: {
  workbench: RemoteFolderWorkbench;
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
  // Read on every render: the row is accepted when the data port becomes ready.
  const screenEnabled = useDesktopPreference(
    s => s.experimentalSettings.enableCloudComputerScreen || s.experimentalSettings.enableComputerMode,
  );
  const cloud = surfaceService as Partial<NativeCloudDataService>;
  // Read on every render: the row is accepted when the data port becomes ready.
  // A settings change answers with the resolved view, which then wins.
  const [changedSandbox, setChangedSandbox] = useState<CloudSandbox | null>(null);
  const sandbox = changedSandbox ?? readCloudSandbox(cloud.sandbox?.());
  // The experiment gates the entry; the screen view explains anything unavailable.
  const screen = Boolean(screenEnabled && dataPort && surfaceService.workspace.projectId && cloud.screenSession);
  const [screenOpen, setScreenOpen] = useState(false);
  const showScreen = screen && screenOpen;
  const connectScreen = useCallback(() => cloud.screenSession!(), [cloud]);
  const changeSandbox = useCallback(async (settings: CloudSandboxSettings) => {
    if (cloud.setSandboxSettings) setChangedSandbox(await cloud.setSandboxSettings(settings));
  }, [cloud]);
  const openPath = (path: string | null) => { setScreenOpen(false); workbench.onActivePathChange(path); };
  const createItems = useMemo(() => {
    const items = resolveVisibleCreateNewMenuItems(createNewMenuSettings, { enablePuppyFlowFiles });
    return { main: items.main.filter((item) => item !== "slides"), submenu: items.submenu.filter((item) => item !== "slides") };
  }, [createNewMenuSettings, enablePuppyFlowFiles]);
  const workspaceState = dataPort ? undefined : workbench.error
    ? <div className="empty-preview" role="alert" dir="auto">{workbench.error}</div>
    : providerStateContent;
  return <>
    <DesktopDataWorkspaceSurface {...surfaceProps}
      sidebarCompanion={screen ? <>
        {surfaceProps.sidebarCompanion}
        <CloudScreenThumbnail active={showScreen} onOpen={() => setScreenOpen(true)} />
      </> : surfaceProps.sidebarCompanion}
      dataPort={dataPort ?? surfaceService.dataPort} documentSourceKind="cloud"
      providerStateContent={showScreen ? <CloudScreenView sandbox={sandbox} connect={connectScreen}
        onSettings={changeSandbox} onWake={() => { void workbench.resumeWorkspace(); }} /> : workspaceState}
      activeAiEditRequest={null} activeDocumentPath={editorWorkbench.activePath}
      activeExplorerPath={workbench.activeNode?.path ?? editorWorkbench.activePath}
      workspace={surfaceService.workspace} workspaceFolders={folders}
      resolveWorkspaceResource={surfaceService.resolveResource} editorWorkbench={editorWorkbench}
      externalOpen={{ open: openPath }}
      resolvedSurface={dataSurface}
      navigation={{ ...surfaceProps.navigation, activeView: "data", gitEnabled: false,
        gitIncomingCount: 0, gitOperationLoading: null, gitStatus: null, workspaceChangeCount: 0 }}
      fileClipboardController={clipboard} fileOperationNotice={formatFileOperationNotice(clipboard.notice, t)}
      onActiveDataPathChange={openPath} onActiveDataNodeChange={workbench.setActiveNode}
      onResourceMove={editorWorkbench.rebaseResource} onRemoveProject={noop}
      onCreateEntryMenu={(parent, anchor) => { if (surfaceService.writable) actions.openCreateEntryMenu(parent ?? surfaceService.folder.uri, anchor); }}
      onDismissCreateEntryMenu={() => actions.setCreateEntryDraft(null)}
      onNodeActionMenu={actions.openNodeActionMenu}
      openCreateEntryParentPath={createEntryDraft
        && createEntryDraft.anchor.placement !== "auto-end" ? createEntryDraft.parentPath : undefined}
      openNodeActionPath={nodeActionMenu?.mode === "actions"
        ? nodeActionMenu.launcherPath ?? nodeActionMenu.node.path : null}
      sidebarCreateMenuOpen={createEntryDraft?.anchor.placement === "auto-end"}
      workspaceRefreshToken={workbench.refreshToken} workspaceAtomicRefreshToken={0}
      workspaceSurfaceError={dataPort ? workbench.error : null}
      onRetryWorkspaceSurface={dataPort ? () => { void workbench.resumeWorkspace(); } : undefined} />
    {createEntryDraft && <DesktopCreateEntryMenu draft={createEntryDraft}
      mainEntries={createItems.main} submenuItemKinds={createItems.submenu}
      onCancel={() => actions.setCreateEntryDraft(null)} onSelectKind={(kind) => { void actions.createEntry(kind); }} />}
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
