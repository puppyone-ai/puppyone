import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Tooltip,
  RENDERER_ASSET_PATHS,
  createWorkspaceFolder,
  resolveRendererPublicAssetUrl,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CirclePlus,
  Cloud,
  ExternalLink,
  FolderPlus,
  Laptop,
} from "lucide-react";
import { DesktopMenuItem } from "../../components/DesktopMenu";
import { ImportSourceMark } from "../../components/onboarding/ImportSourceMark";
import {
  PROJECT_BACKUP_PROVIDER_LABELS,
  getProjectBackupSnapshot,
  type ProjectBackupDestination,
  type ProjectBackupProvider,
} from "./projectBackupProviders";
import type { GitStatusSnapshot } from "../../types/electron";
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
  cloudProject?: DesktopProjectCloudCopy;
  backupProviders?: readonly ProjectBackupProvider[];
  backupStatus?: GitStatusSnapshot | null;
  availableProjects?: readonly Workspace[];
  onAddExistingProject?: (folderPath: string) => void;
  onOpenFolder?: () => void;
  onClose: () => void;
  onShare?: () => void;
  onViewCloud?: () => void;
  onToggle: () => void;
};

export type DesktopProjectLocation = Readonly<{
  current: "local" | "cloud";
  localAvailable: boolean;
  cloudState: "unavailable" | "available" | "signed-out" | "resolving" | "attention";
}>;

export type DesktopProjectCloudCopy = Readonly<{ id: string; name?: string | null }>;

export function DesktopWorkspaceSwitcher({
  open,
  refObject,
  titlebarLabel,
  menuAlignment = "start",
  workspace,
  workspaceFolders,
  multiRootWorkspacesEnabled,
  projectLocation,
  cloudProject,
  backupProviders = [],
  backupStatus = null,
  availableProjects = [],
  onAddExistingProject,
  onOpenFolder,
  onClose,
  onViewCloud,
  onToggle,
}: DesktopWorkspaceSwitcherProps) {
  const { t } = useLocalization();
  const [view, setView] = useState<"projects" | "add">("projects");
  // A canonical Cloud remote describes another copy, not where this open
  // working copy lives. Desktop workspaces are local unless explicitly remote.
  const currentProjectLocationKind = projectLocation?.current ?? "local";
  const cloudLinked = resolveProjectContextAssetKind(workspace) === "cloud"
    || Boolean(cloudProject?.id)
    || projectLocation?.cloudState === "available"
    || projectLocation?.cloudState === "signed-out";
  const canSetUpCloudVersions = !cloudLinked && currentProjectLocationKind === "local"
    && Boolean(projectLocation || onViewCloud);
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
  useEffect(() => {
    setView("projects");
  }, [workspace.path]);
  const cloudEdition = (cloudLinked || currentProjectLocationKind === "cloud") && (
    <DesktopProjectBackupDetails
      provider="puppyone-cloud" status={backupStatus}
      cloudProjectId={cloudProject?.id ?? workspace.puppyoneGitRemote?.projectId}
      cloudOrigin={workspace.puppyoneGitRemote?.origin}
      current={currentProjectLocationKind === "cloud"}
      navigationPending={projectLocation?.cloudState === "resolving"}
      onClose={onClose}
      onViewCloud={onViewCloud}
    />
  );
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
        onClick={() => {
          setView("projects");
          onToggle();
        }}
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
        preferredWidth={view === "add" ? 240 : 248}
        alignment={menuAlignment}
      >
        {view !== "add" ? (
          <>
            <div
              className="desktop-project-overview"
              data-workspace-menu-layout="workspace-composition-v1"
            >
              <div className="desktop-project-location-card">
                {currentProjectLocationKind === "cloud" ? (
                  <div className="desktop-project-current-location" data-project-location="cloud" aria-current="true">
                    {cloudEdition}
                  </div>
                ) : <DesktopCurrentProjectLocation path={workspace.path} />}
              </div>
            </div>
            {((cloudLinked && currentProjectLocationKind !== "cloud") || canSetUpCloudVersions || backupProviders.length > 0) && (
              <div className="desktop-project-remote-copies" role="group"
                aria-label={t("shell.workspaceSwitcher.remoteCopies")}>
                {currentProjectLocationKind !== "cloud" && cloudEdition}
                {canSetUpCloudVersions && (
                  <div className="desktop-project-location-actions">
                    <DesktopMenuItem
                      className="desktop-project-location-action desktop-project-backup-heading"
                      data-location-action="enable-cloud-versions"
                      disabled={!onViewCloud || projectLocation?.cloudState === "resolving"}
                      icon={<CirclePlus size={14} strokeWidth={1.65} />}
                      label={t("shell.workspaceSwitcher.enableCloudVersions")}
                      trailing={<ChevronRight className="po-directional-icon" size={12} aria-hidden="true" />}
                      onClick={() => {
                        if (!onViewCloud) return;
                        onClose();
                        onViewCloud();
                      }}
                    />
                  </div>
                )}
                {backupProviders.length > 0 && (
                  <div className="desktop-project-secondary-copies">
                    {backupProviders.map((provider) => <DesktopProjectBackupDetails
                      key={provider} provider={provider} status={backupStatus}
                      onClose={onClose}
                    />)}
                  </div>
                )}
              </div>
            )}
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

function BackupMark({ provider }: { provider: ProjectBackupDestination }) {
  if (provider === "github") {
    // Mask the canonical SVG so its silhouette follows the surrounding text,
    // including hover states, without inverting the mark to pure white.
    const maskImage = `url("${resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.integrations.github)}")`;
    return <span className="desktop-project-github-mark" aria-hidden="true" style={{ maskImage, WebkitMaskImage: maskImage }} />;
  }
  return provider === "puppyone-cloud" ? <Cloud size={16} strokeWidth={1.75} aria-hidden="true" />
    : <ImportSourceMark brand={provider} decorative />;
}

function DesktopProjectBackupDetails({ provider, status, cloudProjectId, cloudOrigin, current = false, navigationPending = false, onClose, onViewCloud }: {
  provider: ProjectBackupDestination;
  status: GitStatusSnapshot | null;
  cloudProjectId?: string;
  cloudOrigin?: string;
  current?: boolean;
  navigationPending?: boolean;
  onClose: () => void;
  onViewCloud?: () => void;
}) {
  const { t, formatDate } = useLocalization();
  const label = provider === "puppyone-cloud" ? t("shell.workspaceSwitcher.cloudVersion")
    : t("shell.workspaceSwitcher.providerVersionCopy", { provider: PROJECT_BACKUP_PROVIDER_LABELS[provider] });
  const snapshot = getProjectBackupSnapshot(status, provider, cloudProjectId, cloudOrigin);
  const lastChangeDate = snapshot.lastChangeAt ? new Date(snapshot.lastChangeAt) : null;
  const fullChangeLabel = lastChangeDate ? t("shell.workspaceSwitcher.lastChange", { time: bidiIsolate(formatDate(lastChangeDate, {
      year: lastChangeDate.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    })) }) : undefined;
  const detail = lastChangeDate ? <Tooltip content={fullChangeLabel!}><time dateTime={snapshot.lastChangeAt ?? undefined} aria-label={fullChangeLabel}>
    {t("shell.workspaceSwitcher.lastChange", { time: bidiIsolate(formatDate(lastChangeDate, {
      year: lastChangeDate.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      month: "short", day: "numeric",
    })) })}
  </time></Tooltip> : undefined;
  return <div className={`desktop-project-backup-details${provider === "puppyone-cloud" ? " desktop-project-cloud-edition" : ""}${current ? " desktop-project-location-visual" : ""}`}
    data-backup-details={provider}
    role={current ? "group" : undefined}
    aria-label={current ? t("shell.workspaceSwitcher.location.cloud") : undefined}>
    {snapshot.repositoryUrl ? (
      <a className="desktop-menu-item desktop-project-backup-heading desktop-project-backup-link"
        href={snapshot.repositoryUrl} target="_blank" rel="noopener noreferrer"
        aria-label={t("shell.workspaceSwitcher.openGitHubRepository")}
        onClick={onClose}>
        <span className="desktop-menu-item-icon" aria-hidden="true"><BackupMark provider={provider} /></span>
        <span className="desktop-menu-item-body">
          <span className="desktop-menu-item-label">{label}</span>
          {detail && <span className="desktop-menu-item-detail">{detail}</span>}
        </span>
        <span className="desktop-menu-item-trailing" aria-hidden="true"><ExternalLink size={12} /></span>
      </a>
    ) : provider === "puppyone-cloud" && onViewCloud && !current ? (
      <DesktopMenuItem
        className="desktop-project-backup-heading desktop-project-backup-link"
        aria-label={t("shell.workspaceSwitcher.viewCloudCopy")}
        disabled={navigationPending}
        icon={<Tooltip content={t("shell.workspaceSwitcher.location.onCloud")}><span className="desktop-project-version-mark"><BackupMark provider={provider} /></span></Tooltip>}
        label={label}
        detail={detail}
        trailing={<span className="desktop-project-backup-view">{t("shell.workspaceSwitcher.switch")}</span>}
        onClick={() => {
          onClose();
          onViewCloud();
        }}
      />
    ) : (
      <div className="desktop-project-backup-heading">
        <span className="desktop-menu-item-icon" aria-hidden="true"><BackupMark provider={provider} /></span>
        <span className="desktop-menu-item-body">
          <span className="desktop-menu-item-label">{label}</span>
          {detail && <span className="desktop-menu-item-detail">{detail}</span>}
        </span>
        {current && <DesktopProjectCurrentBadge />}
      </div>
    )}
  </div>;
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

function DesktopProjectCurrentBadge() {
  const { t } = useLocalization();
  return <span className="desktop-menu-item-trailing desktop-project-edition-current">
    <Check size={11} strokeWidth={2} aria-hidden="true" />
    {t("shell.workspaceSwitcher.current")}
  </span>;
}

function DesktopCurrentProjectLocation({ path }: { path: string }) {
  const { t } = useLocalization();
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
      data-project-location="local"
      aria-current="true"
    >
      <div
        className="desktop-project-location-visual"
        role="group"
        aria-label={t("shell.workspaceSwitcher.location.thisMac")}
      >
        <div className="desktop-project-location-device">
          <ProjectLocationMark
            className="desktop-project-current-location-mark"
            kind="local"
            size={16}
          />
          <div className="desktop-project-location-label">
            <span className="desktop-project-location-title">{t("shell.workspaceSwitcher.location.onThisMac")}</span>
            <DesktopProjectPath
              path={path}
              copyLabel={copyLabel}
              feedbackState={copyState}
              onCopy={() => void copyPath()}
            />
          </div>
          <DesktopProjectCurrentBadge />
        </div>
      </div>
    </div>
  );
}

function DesktopProjectPath({ path, copyLabel, feedbackState, onCopy }: {
  path: string;
  copyLabel: string;
  feedbackState: "idle" | "copied" | "failed";
  onCopy: () => void;
}) {
  const feedback = feedbackState === "idle" ? null : copyLabel;
  const viewport = useRef<HTMLElement>(null);
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
    <>
      <Tooltip content={copyLabel}><button
        className="desktop-project-current-location-path"
        type="button"
        dir="ltr"
        aria-label={path}
        aria-description={copyLabel}
        data-copy-feedback={feedbackState === "idle" ? undefined : feedbackState}
        onClick={() => { reset(); onCopy(); }}
        onMouseEnter={reveal}
        onMouseLeave={reset}
        onFocus={reveal}
        onBlur={reset}
        onWheel={stop}
        onKeyDown={stop}
      >
        {feedback ? (
          <span className="desktop-project-path-feedback">
            {feedbackState === "copied" && <Check size={14} aria-hidden="true" />}
            {feedback}
          </span>
        ) : (
          <bdi className="desktop-project-path-text" ref={viewport}>{getWorkspacePathForDisplay(path)}</bdi>
        )}
      </button></Tooltip>
      <span className="sr-only" role="status">{feedback}</span>
    </>
  );
}

function ProjectLocationMark({
  className,
  kind,
  size = 15,
  strokeWidth = 1.75,
}: {
  className: string;
  kind: DesktopProjectLocation["current"];
  size?: number;
  strokeWidth?: number;
}) {
  const Icon = kind === "cloud" ? Cloud : Laptop;
  return (
    <span
      className={`desktop-project-location-mark ${className}`}
      data-project-location={kind}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={strokeWidth} />
    </span>
  );
}
