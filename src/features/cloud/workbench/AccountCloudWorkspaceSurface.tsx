import { useMemo } from "react";
import { Cloud, ChevronDown } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { createWorkspaceResourceUri } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../../../components/DesktopCloudShell";
import type { DesktopPreferencesController } from "../../app-shell/useDesktopPreferences";
import type { ResolvedSurfaceAppearance } from "../../appearance/AppearanceRuntime";
import { DesktopProjectLocationControls } from "../../app-shell/DesktopWorkspaceSwitcher";
import { DesktopShellLocationBar } from "../../app-shell/DesktopShellLocationBar";
import { EditorHeaderTabs } from "../../editor-workbench/header/EditorHeaderTabs";
import { DesktopCloudFileWorkspace, type CloudFileSurfaceProps } from "./DesktopCloudFileWorkspace";
import type { NativeCloudWorkbench } from "./useNativeCloudWorkbench";
import "./account-cloud-workspace.css";

const noop = () => undefined;

/** A hosted workspace never needs a local root or a local Git controller. */
export function AccountCloudWorkspaceSurface({ workbench, active, preferences, appearance, onLocal, onBrowse }: {
  workbench: NativeCloudWorkbench;
  active: boolean;
  preferences: DesktopPreferencesController;
  appearance: ResolvedSurfaceAppearance;
  onLocal: () => void;
  onBrowse: () => void;
}) {
  const { t } = useLocalization();
  const { service, editorWorkbench, actions } = workbench;
  const interaction = useMemo(() => ({ showSaveStatus: true,
    markdownBlockDragEnabled: preferences.experimentalSettings.enableMarkdownBlockDrag,
    markdownHeadingOutlineEnabled: preferences.experimentalSettings.enableMarkdownHeadingOutline,
  }), [preferences.experimentalSettings.enableMarkdownBlockDrag, preferences.experimentalSettings.enableMarkdownHeadingOutline]);
  if (!service || !workbench.visited) return null;
  const surfaceProps: CloudFileSurfaceProps = {
    preferences, editorInteractionPreferences: interaction, viewerExtensionAdapter: null,
    navigation: { activeView: "data", availableSurfaceIds: ["data"], gitEnabled: false,
      gitIncomingCount: 0, gitOperationLoading: null, gitStatus: null, workspaceChangeCount: 0,
      onNavigate: noop, onOpenPlugins: noop, onOpenSettings: noop,
      pluginsOpen: false, settingsOpen: false, showPlugins: false, showSettings: false, showWorkspaceNavigation: false },
  };
  const tabs = <EditorHeaderTabs activeEditorId={editorWorkbench.activeEditorId} editors={editorWorkbench.state.editors}
    fileIconTheme={preferences.fileIconTheme} storageIdentity={workbench.dataPort?.documentPersistence?.storageIdentity ?? null}
    onActivate={editorWorkbench.activate} onClose={workbench.closeEditor} onMove={editorWorkbench.moveTab}
    onCreate={service.writable ? (anchor) => actions.openCreateEntryMenu(service.folder.uri, anchor) : undefined} />;
  return <div className={`app-shell cloud-runtime desktop-account-cloud-workspace ${appearance.appearance.effectiveColorMode === "dark" ? "dark" : ""}`} hidden={!active}
    {...appearance.rootProps}
    style={{ ...appearance.rootProps.style, ...(!active ? { display: "none" } : {}) }} data-active-cloud-project={service.workspace.projectId}>
    <DesktopCloudShell active={active} onGoHome={onLocal} leftSidebarCollapsed={preferences.sidebarCollapsed}
      leftSidebarWidth={preferences.explorerWidth} onLeftSidebarExpand={() => preferences.setSidebarCollapsed(false)}
      titlebarSidebarSlot={<button type="button" className="desktop-titlebar-workspace-button"
        onClick={onBrowse} aria-label={t("cloud.catalog.browse")}>
        <Cloud size={16} /><bdi className="desktop-titlebar-workspace-name">{service.workspace.name}</bdi><ChevronDown size={12} />
      </button>}
      titlebarActions={<DesktopProjectLocationControls projectLocation={{ current: "cloud", localAvailable: true, cloudState: "available" }}
        cloudProject={{ id: service.workspace.projectId!, name: service.workspace.name }} onViewLocal={onLocal} onViewCloud={onBrowse} />}
      titlebarTabs={preferences.experimentalSettings.enableEditorTabsInHeader ? tabs : undefined}
      alignTitlebarTabsToExplorer={preferences.experimentalSettings.enableEditorTabsInHeader}
      locationBar={preferences.resolvedAppearance.composition.locationBar === "workspace-path-v1" ? <DesktopShellLocationBar
        path={service.resolveResource(editorWorkbench.activePath ?? workbench.activeNode?.path ?? null)?.providerPath ?? ""}
        onNavigate={async (path) => { if (path.trim()) await workbench.onActivePathChange(createWorkspaceResourceUri(service.folder.uri, path.trim())); }} /> : undefined}>
      <DesktopCloudFileWorkspace workbench={workbench} surfaceProps={surfaceProps} providerStateContent={null} />
    </DesktopCloudShell>
  </div>;
}
