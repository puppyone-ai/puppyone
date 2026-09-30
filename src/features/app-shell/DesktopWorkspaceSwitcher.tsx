import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Tooltip,
  createWorkspaceFolder,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Cloud,
  Copy,
  Folder,
  FolderPlus,
  Laptop,
} from "lucide-react";
import { DesktopMenuIconButton, DesktopMenuItem } from "../../components/DesktopMenu";
import { writeClipboardText } from "../../lib/clipboard";
import { DesktopTitlebarMenuLayer } from "./DesktopTitlebarMenuLayer";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  ProjectContextAssetMark,
  resolveProjectContextAssetKind,
} from "./ProjectContextAssetMark";
import { getWorkspaceParentPathForDisplay, getWorkspacePathForDisplay } from "./workspaceHomeModel";

type DesktopWorkspaceSwitcherProps = {
  open: boolean;
  refObject: RefObject<HTMLDivElement>;
  titlebarLabel: string;
  menuAlignment?: "start" | "center";
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  multiRootWorkspacesEnabled: boolean;
  projectLocation?: DesktopProjectLocation;
  availableProjects?: readonly Workspace[];
  onAddExistingProject?: (folderPath: string) => void;
  onOpenFolder?: () => void;
  onClose: () => void;
  onShare?: () => void;
  onToggle: () => void;
};

export type DesktopProjectLocation = Readonly<{
  current: "local" | "cloud";
  localAvailable: boolean;
  cloudState: "unavailable" | "available" | "signed-out" | "resolving" | "attention";
}>;

export function DesktopWorkspaceSwitcher({
  open,
  refObject,
  titlebarLabel,
  menuAlignment = "start",
  workspace,
  workspaceFolders,
  multiRootWorkspacesEnabled,
  projectLocation,
  availableProjects = [],
  onAddExistingProject,
  onOpenFolder,
  onClose,
  onShare,
  onToggle,
}: DesktopWorkspaceSwitcherProps) {
  const { t } = useLocalization();
  const [view, setView] = useState<"projects" | "add">("projects");
  const workspaceContextAssetKind = resolveProjectContextAssetKind(workspace);
  const currentProjectLocationKind = projectLocation?.current ?? workspaceContextAssetKind;
  const workspaceContextAssetLabel = t(currentProjectLocationKind === "cloud"
    ? "shell.workspaceSwitcher.location.cloud"
    : "shell.workspaceSwitcher.location.thisMac");
  const attachedFolders = useMemo(
    () => workspaceFolders.length > 0
      ? workspaceFolders
      : [createWorkspaceFolder(workspace)],
    [workspace, workspaceFolders],
  );
  const unattachedProjects = useMemo(() => {
    const attachedPaths = new Set(attachedFolders.map((folder) => folder.workspace.path));
    return availableProjects.filter((project) => !attachedPaths.has(project.path));
  }, [attachedFolders, availableProjects]);
  useEffect(() => {
    if (!open || (view === "add" && !multiRootWorkspacesEnabled)) setView("projects");
  }, [multiRootWorkspacesEnabled, open, view]);
  return (
    <div className="desktop-titlebar-workspace-wrap" ref={refObject}>
      <Tooltip content={t("shell.workspaceSwitcher.projectTitle", {
          project: bidiIsolate(workspace.name),
        }) + ` · ${workspaceContextAssetLabel}`}><button
        className="desktop-titlebar-workspace-button local"
        type="button"
        aria-label={t("shell.workspaceSwitcher.openMenu", {
          workspace: bidiIsolate(workspace.name),
        }) + ` · ${workspaceContextAssetLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        <ProjectLocationMark
          className="desktop-titlebar-workspace-mark"
          kind={currentProjectLocationKind}
          size={16}
        />
        <bdi className="desktop-titlebar-workspace-name">{titlebarLabel}</bdi>
      </button></Tooltip>

      <DesktopTitlebarMenuLayer
        anchorRef={refObject}
        className="desktop-project-menu"
        gap={4}
        onDismiss={onClose}
        open={open}
        preferredMaxHeight={520}
        preferredWidth={view === "projects" ? 224 : 240}
        alignment={menuAlignment}
      >
        {view === "projects" ? (
          <>
            <div
              className="desktop-project-overview"
              data-workspace-menu-layout="workspace-composition-v1"
            >
              <div className="desktop-project-location-card">
                <DesktopCurrentProjectLocation
                  fallbackKind={workspaceContextAssetKind}
                  location={projectLocation}
                  path={workspace.path}
                />
              </div>
            </div>
            {(attachedFolders.length > 1 || multiRootWorkspacesEnabled) && (
              <div className="desktop-project-list" data-po-scrollbar="menu">
                {attachedFolders.slice(1).map((folder) => (
                <DesktopProjectRow
                  key={folder.id}
                  folder={folder}
                />
                ))}
                {multiRootWorkspacesEnabled && (
                  <DesktopMenuItem
                    className="desktop-project-add desktop-project-add-folder"
                    disabled={!onAddExistingProject && !onOpenFolder}
                    icon={<FolderPlus size={15} strokeWidth={1.8} />}
                    label={t("shell.workspaceSwitcher.addProject")}
                    onClick={() => setView("add")}
                  />
                )}
              </div>
            )}
            {projectLocation && (
              <div className="desktop-project-location-actions">
                <DesktopMenuItem
                  className="desktop-project-location-action"
                  data-location-action="share"
                  disabled={!onShare}
                  icon={<Cloud size={24} strokeWidth={1.5} absoluteStrokeWidth />}
                  label={t("shell.workspaceSwitcher.shareToAgents")}
                  trailing={<ChevronRight className="po-directional-icon" size={12} aria-hidden="true" />}
                  onClick={() => {
                    if (!onShare) return;
                    onClose();
                    onShare();
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="desktop-project-back-group">
              <DesktopMenuItem
                className="desktop-project-add"
                icon={<ArrowLeft className="po-directional-icon" size={15} strokeWidth={1.9} />}
                label={t("shell.workspaceSwitcher.projects")}
                onClick={() => setView("projects")}
              />
            </div>
            <div className="desktop-project-list" data-po-scrollbar="menu">
              {unattachedProjects.map((project) => (
                <DesktopMenuItem
                  className="desktop-project-add"
                  detail={(
                    <Tooltip content={project.path} overflowOnly>
                      <bdi dir="ltr">{getWorkspaceParentPathForDisplay(project.path)}</bdi>
                    </Tooltip>
                  )}
                  icon={(
                    <ProjectContextAssetMark
                      className="desktop-project-mark"
                      kind={resolveProjectContextAssetKind(project)}
                    />
                  )}
                  key={project.id}
                  label={<bdi>{project.name}</bdi>}
                  onClick={() => onAddExistingProject?.(project.path)}
                />
              ))}
              <DesktopMenuItem
                className="desktop-project-add desktop-project-add-folder"
                disabled={!onOpenFolder}
                icon={<FolderPlus size={15} strokeWidth={1.8} />}
                label={t("shell.workspaceSwitcher.openFolder")}
                onClick={onOpenFolder}
              />
            </div>
          </>
        )}
      </DesktopTitlebarMenuLayer>
    </div>
  );
}

function DesktopProjectRow({
  folder,
}: {
  folder: WorkspaceFolder;
}) {
  const detail = getWorkspaceParentPathForDisplay(folder.workspace.path);
  return (
    <div className="desktop-project-option-row">
      <div
        className="desktop-menu-item desktop-project-option"
        role="menuitem"
        aria-disabled="true"
      >
        <span className="desktop-menu-item-icon">
          <ProjectContextAssetMark
            className="desktop-project-mark"
            kind={resolveProjectContextAssetKind(folder.workspace)}
          />
        </span>
        <span className="desktop-menu-item-body">
          <bdi className="desktop-menu-item-label">{folder.name}</bdi>
          {detail ? (
            <Tooltip content={folder.workspace.path} overflowOnly><bdi
              className="desktop-menu-item-detail"
              dir="ltr"
            >
              {detail}
            </bdi></Tooltip>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function DesktopCurrentProjectLocation({
  fallbackKind,
  location,
  path,
}: {
  fallbackKind: "local" | "cloud";
  location?: DesktopProjectLocation;
  path: string;
}) {
  const { t } = useLocalization();
  const kind = location?.current ?? fallbackKind;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    setCopyState("idle");
  }, [path]);
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1_500);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const copyLabel = t(copyState === "copied" ? "common.action.copied"
    : copyState === "failed" ? "shell.workspaceSwitcher.copyPathFailed"
      : "shell.workspaceSwitcher.copyPath");
  const copyPath = async () => {
    try {
      await writeClipboardText(path);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <div
      className="desktop-project-current-location"
      data-project-location={kind}
    >
      <div
        className="desktop-project-location-visual"
        role="img"
        aria-label={t(kind === "local" ? "shell.workspaceSwitcher.location.thisMac" : "shell.workspaceSwitcher.location.cloud")}
      >
        <ProjectLocationMark
          className="desktop-project-current-location-mark"
          kind={kind}
          size={24}
          strokeWidth={1.5}
          absoluteStrokeWidth
        />
      </div>
      {kind === "local" && (
        <div className="desktop-project-path-row">
          <Folder className="desktop-project-path-mark" size={24} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
          <DesktopProjectPath path={path} />
          <DesktopMenuIconButton
            className="desktop-project-copy-path"
            icon={copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
            label={copyLabel}
            onClick={() => void copyPath()}
          />
        </div>
      )}
    </div>
  );
}

function DesktopProjectPath({ path }: { path: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const stop = () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  const reset = () => {
    stop();
    if (viewport.current) viewport.current.scrollLeft = 0;
  };
  const reveal = () => {
    stop();
    const element = viewport.current;
    if (!element || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const distance = element.scrollWidth - element.clientWidth;
    if (distance <= 0) return;
    const startedAt = performance.now();
    const from = element.scrollLeft;
    const scroll = (time: number) => {
      element.scrollLeft = Math.min(distance, from + Math.max(0, time - startedAt - 500) * 0.035);
      if (element.scrollLeft < distance) frame.current = window.requestAnimationFrame(scroll);
      else frame.current = null;
    };
    frame.current = window.requestAnimationFrame(scroll);
  };
  useEffect(() => () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
  }, [path]);
  return (
    <div
      ref={viewport}
      className="desktop-project-current-location-path"
      dir="ltr"
      role="region"
      tabIndex={0}
      aria-label={path}
      onMouseEnter={reveal}
      onMouseLeave={reset}
      onFocus={reveal}
      onBlur={reset}
      onWheel={stop}
      onKeyDown={stop}
    >
      <bdi>{getWorkspacePathForDisplay(path)}</bdi>
    </div>
  );
}

function ProjectLocationMark({
  className,
  kind,
  size = 15,
  strokeWidth = 1.75,
  absoluteStrokeWidth = false,
}: {
  className: string;
  kind: DesktopProjectLocation["current"];
  size?: number;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
}) {
  const Icon = kind === "cloud" ? Cloud : Laptop;
  return (
    <span
      className={`desktop-project-location-mark ${className}`}
      data-project-location={kind}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={strokeWidth} absoluteStrokeWidth={absoluteStrokeWidth} />
    </span>
  );
}
