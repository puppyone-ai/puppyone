import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { closeDocumentWorkingCopiesUnderResource } from "@puppyone/shared-ui";
import { ProjectWindow } from "./ProjectWindow";
import { useAccountCloudWorkspacePresentation } from "./AccountCloudWorkspaceSurface";
import type { ResolvedSurfaceAppearance } from "../features/appearance";
import type { DesktopCloudSession } from "../lib/cloudApi";
import type { HostFolderCapability, HostLauncher } from "../../shared/host-contract/types";
import { useDesktopPreference } from "../features/settings";
import { createPendingCloudDataService } from "../features/cloud/workbench/pendingCloudDataService";
import { useRemoteFolderWorkbench, type RemoteFolderService } from "../features/remote-workbench";
import type { HostFolderSelection } from "../features/hosts";
import { createDeviceDataService, type DeviceDataService, type DeviceFolderAvailability } from "../features/hosts/data/deviceDataPort";
import { RemoteTerminalPanel } from "../features/hosts/ui/RemoteTerminalPanel";
import { RemoteGitPanel } from "../features/hosts/ui/RemoteGitPanel";

const AGENT_LAUNCHERS: readonly HostLauncher[] = ["claude", "codex", "cursor", "opencode", "pi", "hermes"];
type Tool = "terminal" | "agent" | "git";

/**
 * Another computer's folder in the same workbench as a Cloud project: explorer,
 * editors, tabs and node actions are shared; what it lives on is a property of
 * the folder. Terminal, Agent and Git appear only when that computer allows them
 * for this folder, and they run there. No reveal, open-with or local Git here.
 */
export function DeviceFolderWorkbenchSurface({ selection, session, apiBase, appearance, onClose, onOpenSettings }: {
  selection: HostFolderSelection; session: DesktopCloudSession; apiBase: string;
  appearance: ResolvedSurfaceAppearance; onClose: () => void | Promise<void>; onOpenSettings: () => void;
}) {
  const { t } = useLocalization();
  const filesVisibilitySettings = useDesktopPreference((s) => s.filesVisibilitySettings);
  const rightSidebarWidth = useDesktopPreference((s) => s.rightSidebarWidth);
  const setRightSidebarWidth = useDesktopPreference((s) => s.setRightSidebarWidth);
  const [capabilities, setCapabilities] = useState<readonly HostFolderCapability[]>(
    selection.capabilities ?? (selection.writable ? ["folder.read", "folder.write"] : ["folder.read"]));
  const writable = capabilities.includes("folder.write");
  const describe = useCallback((availability: DeviceFolderAvailability) => {
    if (availability === "offline") return t("hosts.folder.offline", { host: selection.hostName });
    return availability === "revoked" ? t("hosts.folder.revoked") : t("hosts.folder.denied");
  }, [selection.hostName, t]);
  const serviceKey = JSON.stringify([apiBase, session.user_id, session.session_generation, selection.ref, writable]);
  const created = useRef<DeviceDataService | null>(null);
  const createService = useCallback((isCurrent: () => boolean) => {
    created.current = createDeviceDataService({ ref: selection.ref, name: selection.name, writable, session, apiBase,
      isCurrent, describeAvailability: describe });
    return created.current;
  // The key is the folder's full authority contract.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceKey]);
  const pendingService = useMemo(() => createPendingCloudDataService(null, selection.name), [selection.name]);
  const workbench = useRemoteFolderWorkbench<RemoteFolderService>({ serviceKey, createService, pendingService,
    active: true, filesVisibilitySettings });
  useEffect(() => () => created.current?.dispose(), [serviceKey]);
  const presentation = useAccountCloudWorkspacePresentation({ workbench, onOpenSettings });

  // What this folder allows can change on its computer at any time; read it fresh.
  useEffect(() => {
    let current = true;
    void window.puppyoneDesktop?.listHostDevices({ userId: session.user_id, generation: session.session_generation })
      .then((catalog) => {
        const folder = catalog?.devices.find((device) => device.id === selection.ref.deviceId)
          ?.folders.find((item) => item.id === selection.ref.folderId);
        if (current && folder) setCapabilities(folder.capabilities);
      }).catch(() => {});
    void window.puppyoneDesktop?.recordRecentHostFolder?.({ deviceId: selection.ref.deviceId,
      folderId: selection.ref.folderId, name: selection.name, hostName: selection.hostName, writable,
      expectedSession: { userId: session.user_id, generation: session.session_generation } }).catch(() => {});
    return () => { current = false; };
  }, [selection, session.user_id, session.session_generation, writable]);

  const tools = useMemo(() => ([
    capabilities.includes("folder.shell") ? "terminal" : null,
    capabilities.includes("folder.agent") ? "agent" : null,
    capabilities.includes("folder.git") ? "git" : null,
  ].filter(Boolean) as Tool[]), [capabilities]);
  const [tool, setTool] = useState<Tool | null>(null);
  const [launcher, setLauncher] = useState<HostLauncher>("claude");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const shownTool = tool && tools.includes(tool) ? tool : tools[0] ?? null;
  const [closeError, setCloseError] = useState<string | null>(null);
  const close = async () => {
    try {
      const service = workbench.service;
      if (service) await closeDocumentWorkingCopiesUnderResource(service.workspace.id, service.folder.uri);
      void window.puppyoneDesktop?.closeRecentHostFolder?.({
        expectedSession: { userId: session.user_id, generation: session.session_generation } }).catch(() => {});
      await onClose();
    } catch (cause) { setCloseError(cause instanceof Error ? cause.message : t("hosts.folder.closeFailure")); }
  };

  const titlebar = <div className="desktop-device-folder-title" data-host-folder={selection.ref.folderId}
    style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
    <button type="button" onClick={() => void close()}>← {t("hosts.folder.home")}</button>
    <strong dir="auto">{selection.name}</strong>
    <span>{t("hosts.folder.onHost", { host: selection.hostName })}</span>
    <span>{writable ? t("hosts.folder.editing") : t("hosts.folder.readOnly")}</span>
    {closeError && <span role="alert">{closeError}</span>}
  </div>;
  const titlebarActions = tools.length > 0 ? <button type="button" aria-pressed={sidebarOpen}
    onClick={() => setSidebarOpen((open) => !open)}>{t("hosts.tools.title")}</button> : null;

  return <ProjectWindow location="cloud" hosted active appearance={appearance}
    rootAttributes={{ "data-host-folder-window": selection.ref.folderId }}
    titlebarSidebarSlot={titlebar} titlebarActions={titlebarActions}
    locationBar={presentation.locationBar}
    rightSidebarOpen={sidebarOpen && Boolean(shownTool)} rightSidebarWidth={rightSidebarWidth} resizableRightSidebar
    onRightSidebarOpenChange={setSidebarOpen} onRightSidebarWidthChange={setRightSidebarWidth}
    rightSidebar={() => shownTool ? <div className="desktop-host-tools" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div role="tablist" style={{ display: "flex", gap: 6, padding: 6 }}>
        {tools.map((item) => <button key={item} type="button" role="tab" aria-selected={item === shownTool}
          onClick={() => setTool(item)}>{t(`hosts.tools.${item}`)}</button>)}
      </div>
      {shownTool === "agent" && <label style={{ display: "flex", gap: 6, padding: "0 6px" }}>
        {t("hosts.tools.agentChoice")}
        <select value={launcher} onChange={(event) => setLauncher(event.target.value as HostLauncher)}>
          {AGENT_LAUNCHERS.map((item) => <option key={item} value={item}>{t(`terminal.launcher.${item}.name`)}</option>)}
        </select>
      </label>}
      <div style={{ flex: 1, minHeight: 0 }}>
        {shownTool === "terminal" && <RemoteTerminalPanel key="shell" folderId={selection.ref.folderId} kind="shell"
          launcher="shell" session={session} hostName={selection.hostName} />}
        {shownTool === "agent" && <RemoteTerminalPanel key={`agent:${launcher}`} folderId={selection.ref.folderId} kind="agent"
          launcher={launcher} session={session} hostName={selection.hostName} />}
        {shownTool === "git" && <RemoteGitPanel folderId={selection.ref.folderId} session={session}
          hostName={selection.hostName} refreshKey={workbench.refreshToken.sequence} />}
      </div>
    </div> : null}>
    {presentation.content}
  </ProjectWindow>;
}
