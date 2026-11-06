import type { DesktopView } from "../components/ProjectShell";
import type { AccountCloudWorkspace } from "../features/cloud/workbench/useAccountCloudWorkspace";
import type { DesktopCloudSession } from "../lib/cloudApi";
import type { MessageValue } from "@puppyone/localization";
import type { WorkspaceEntryKind } from "../features/app-shell/workspaceEntryBootstrap";
import type { WorkspaceSurfaceId } from "../features/app-shell/workspace-surfaces/workspaceSurfaceTypes";
import { CloudOpeningError, describeCloudOpeningFailure } from "../features/cloud/cloudOpeningFailure";
import { formatCloudDiagnostic, formatCloudMessage } from "../features/cloud/cloudPresentation";
import { useCallback, useEffect, useRef } from "react";
import { useProjectNavigation } from "../features/app-shell/window-project/useProjectNavigation";
import { closeHostFolder, hostFolderTarget, showHostFolder, useWindowProject, windowProjectStore,
  type HostFolderSelection } from "../features/app-shell/window-project/windowProjectStore";

export type ProjectDesktopView = Exclude<DesktopView, "settings" | "cloud">;

/**
 * A Cloud project can be on screen from the cached list before the session is back,
 * so being asked to open it now only means asking again once the session is known.
 */
function useKnownCloudSession(restoring: boolean, session: DesktopCloudSession | null) {
  const latest = useRef({ restoring, session });
  latest.current = { restoring, session };
  const waiting = useRef(new Set<() => void>());
  useEffect(() => {
    if (restoring) return;
    for (const resume of waiting.current) resume();
    waiting.current.clear();
  }, [restoring]);
  return useCallback(async () => {
    if (latest.current.restoring) await new Promise<void>((resume) => waiting.current.add(resume));
    return latest.current.session;
  }, []);
}

type WindowProjectNavigationInput = {
  accountCloud: AccountCloudWorkspace;
  activeCloudSession: DesktopCloudSession | null;
  cloudSessionRestoring: boolean;
  cancelAccountCloudOpen: () => void;
  cancelProjectNavigationRef: React.MutableRefObject<() => void>;
  cloudEnabled: boolean;
  cloudHeaderActive: boolean;
  drainWorkspaceNavigation: () => Promise<boolean>;
  initialCloudProject: Readonly<{ projectId: string; userId: string; }> | null;
  lastProjectViewRef: React.MutableRefObject<ProjectDesktopView>;
  navigateDesktopView: (view: WorkspaceSurfaceId) => void;
  openDroppedWorkspace: (folder: File) => Promise<void>;
  openLocalWorkspace: () => void;
  openWorkspacePath: (folderPath: string, entryKind?: WorkspaceEntryKind) => Promise<void>;
  projectEntryFlow: Readonly<{ openLauncher: () => void }>;
  restoringWorkspace: boolean;
  selectCloudProjectRef: React.MutableRefObject<(projectId: string) => Promise<void>>;
  setSwitcherOpen: (value: React.SetStateAction<boolean>) => void;
  t: (messageId: string, values?: Readonly<Record<string, MessageValue>> | undefined) => string;
};

/**
 * The one road by which this window opens a project. The Homepage, the Header
 * menu, the rail, a dropped folder, a Cloud retry and a request from another
 * window all come through here, so none of them can miss the wait or the failure.
 */
export function useWindowProjectNavigation({
  accountCloud, activeCloudSession, cloudSessionRestoring, cancelAccountCloudOpen, cancelProjectNavigationRef, cloudEnabled,
  cloudHeaderActive, drainWorkspaceNavigation, initialCloudProject, lastProjectViewRef, navigateDesktopView,
  openDroppedWorkspace, openLocalWorkspace, openWorkspacePath, projectEntryFlow, restoringWorkspace,
  selectCloudProjectRef, setSwitcherOpen, t,
}: WindowProjectNavigationInput) {
  const projectOpenFailure = useWindowProject((project) => project.failure);
  const dismissProjectOpenFailure = () => windowProjectStore.setState({ failure: null });
  const knownCloudSession = useKnownCloudSession(cloudSessionRestoring, activeCloudSession);
  const projectNavigation = useProjectNavigation({
    async open(target, isCurrent) {
      windowProjectStore.setState({ failure: null });
      if (target.kind === "host") {
        // Local folders stay mounted behind it; the folder surface owns reachability.
        const session = await knownCloudSession();
        if (!isCurrent()) return;
        if (!session || session.user_id !== target.selection.ref.accountId) {
          throw new CloudOpeningError(describeCloudOpeningFailure({ status: 401 }));
        }
        if (cloudHeaderActive) openLocalWorkspace();
        showHostFolder(target.selection);
        return;
      }
      if (target.kind === "cloud") {
        const session = await knownCloudSession();
        if (!isCurrent()) return;
        if (!session) throw new CloudOpeningError(describeCloudOpeningFailure({ status: 401 }));
        await accountCloud.openTarget({ kind: "project_root", project_id: target.projectId }, isCurrent, true);
        if (isCurrent()) closeHostFolder();
        return;
      }
      const projectView = lastProjectViewRef.current;
      if (!await drainWorkspaceNavigation() || !isCurrent()) return;
      // Keep the displayed provider until the local target has opened. Failed
      // Cloud -> Local navigation must leave the original Cloud project visible.
      // Main serializes local opens. Reconcile an acknowledged transaction
      // before draining the next intent so its composition and this Renderer
      // cannot disagree when the following target is Cloud.
      if (target.kind === "dropped") await openDroppedWorkspace(target.folder);
      else await openWorkspacePath(target.path, "switched");
      if (isCurrent()) {
        if (cloudHeaderActive) openLocalWorkspace();
        closeHostFolder();
        navigateDesktopView(projectView);
      }
    },
    onError(error, target) {
      const failure = target.kind === "cloud" ? describeCloudOpeningFailure(error) : null;
      const message = error instanceof Error ? error.message : String(error);
      windowProjectStore.setState({ failure: { target, recovery: failure?.action ?? "retry",
        message: failure ? formatCloudMessage(failure.message, t) : message,
        diagnostic: failure ? formatCloudDiagnostic(failure.message, t) : null } });
    },
  });
  cancelProjectNavigationRef.current = projectNavigation.cancel;
  const selectProjectTarget = projectNavigation.select;
  const cancelProjectNavigation = projectNavigation.cancel;
  const showProjectLauncher = projectEntryFlow.openLauncher;
  const openProjectLauncher = useCallback(() => {
    cancelProjectNavigation();
    cancelAccountCloudOpen();
    showProjectLauncher();
  }, [cancelProjectNavigation, cancelAccountCloudOpen, showProjectLauncher]);
  const selectProject = useCallback((path: string) => {
    setSwitcherOpen(false);
    return selectProjectTarget({ kind: "local", path });
  }, [selectProjectTarget, setSwitcherOpen]);
  const selectCloudProject = useCallback((projectId: string) => {
    setSwitcherOpen(false);
    return selectProjectTarget({ kind: "cloud", projectId });
  }, [selectProjectTarget, setSwitcherOpen]);
  selectCloudProjectRef.current = selectCloudProject;
  const openDroppedProject = useCallback((folder: File) => selectProjectTarget({ kind: "dropped", folder }), [selectProjectTarget]);
  const selectHostFolder = useCallback((selection: HostFolderSelection) => {
    setSwitcherOpen(false);
    return selectProjectTarget(hostFolderTarget(selection));
  }, [selectProjectTarget, setSwitcherOpen]);
  // Every retry is another open, so it takes the same road as the first.
  const homepageCloudController = { ...accountCloud, retry: () => {
    const target = accountCloud.lastAttemptedTarget();
    return target ? selectCloudProject(target.project_id) : undefined;
  } };
  useEffect(() => window.puppyoneDesktop?.onWorkspaceOpenRequested?.(({ rootPath }) => {
    void selectProject(rootPath);
  }), [selectProject]);
  const initialCloudProjectOpened = useRef(false);
  useEffect(() => {
    if (initialCloudProjectOpened.current || restoringWorkspace || !initialCloudProject
      || !cloudEnabled || !activeCloudSession || activeCloudSession.user_id !== initialCloudProject.userId) return;
    initialCloudProjectOpened.current = true;
    void selectCloudProject(initialCloudProject.projectId);
  }, [selectCloudProject, activeCloudSession, cloudEnabled, initialCloudProject, restoringWorkspace]);
  return {
    dismissProjectOpenFailure, homepageCloudController, openDroppedProject, openProjectLauncher,
    projectNavigation, projectOpenFailure, selectCloudProject, selectHostFolder, selectProject,
  };
}
