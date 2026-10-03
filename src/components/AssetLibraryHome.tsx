import { Tooltip } from "@puppyone/shared-ui";
import { AlertTriangle, Cloud, FolderOpen, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { useWorkspaceFolderDrop } from "../features/app-shell/useWorkspaceFolderDrop";
import type { MinimalOnboardingProps } from "./MinimalOnboarding";
import type { ProjectHomeItem } from "../features/app-shell/workspaceHomeModel";
import { HomeProjectIcon } from "./onboarding/HomeProjectIcon";
import { DesktopWindowDragRegion } from "./DesktopWindowChrome";
import { InlineLoading } from "./loading";

/** Optional visual home consuming the same host-owned local/Cloud project model. */
export function AssetLibraryHome({
  onChooseWorkspace,
  onOpenWorkspacePath,
  onOpenDroppedWorkspace,
  recentWorkspaces = [],
  projectItems,
  cloudAccountStatus,
  cloudOpening = false,
  onOpenCloudProject,
  operationStatus = null,
  initialError = null,
  appearance,
}: MinimalOnboardingProps) {
  const { t, formatDate, formatRelativeTime } = useLocalization();
  const [error, setError] = useState<string | null>(initialError);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const items = useMemo<ProjectHomeItem[]>(
    () => (projectItems ?? recentWorkspaces.map(({ workspace }) => ({
      id: workspace.id,
      label: workspace.name,
      localPath: workspace.path,
      lastModifiedAt: workspace.lastModifiedAt ?? null,
    }))),
    [projectItems, recentWorkspaces],
  );

  useEffect(() => setError(initialError), [initialError]);

  const openPath = async (path: string) => {
    if (openingPath || operationStatus) return;
    setError(null);
    setOpeningPath(path);
    try {
      await onOpenWorkspacePath(path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setOpeningPath(null);
    }
  };

  const chooseFolder = async () => {
    if (openingPath || operationStatus) return;
    setError(null);
    setOpeningPath("__new__");
    try {
      await onChooseWorkspace();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setOpeningPath(null);
    }
  };

  const openDroppedFolder = async (folder: File) => {
    if (openingPath || operationStatus) return;
    setError(null);
    setOpeningPath("__drop__");
    try {
      await onOpenDroppedWorkspace(folder);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setOpeningPath(null);
    }
  };

  const busy = Boolean(openingPath) || Boolean(operationStatus) || cloudOpening;
  const folderDrop = useWorkspaceFolderDrop({
    disabled: busy,
    onDropFolder: openDroppedFolder,
    onInvalidDrop: () => setError(t("onboarding.library.error.dropLocalFolder")),
  });
  const resolvedTheme = appearance.appearance.effectiveColorMode;
  return (
    <main
      className={`onboarding-shell asset-library-home-shell ${resolvedTheme === "dark" ? "dark" : ""} ${folderDrop.dragging ? "is-dragging" : ""}`}
      data-po-scrollbar="content"
      {...appearance.rootProps}
      onDragEnter={folderDrop.onDragEnter}
      onDragOver={folderDrop.onDragOver}
      onDragLeave={folderDrop.onDragLeave}
      onDrop={folderDrop.onDrop}
    >
      <DesktopWindowDragRegion className="asset-library-home-titlebar" />
      {cloudAccountStatus}
      <section className="asset-library-home" aria-label={t("onboarding.projects.title")}>
        <header className="asset-library-home-header"><div className="asset-library-home-heading"><h1>{t("onboarding.projects.title")}</h1></div></header>

        {operationStatus && (
          <div className="asset-library-home-operation" role="status" aria-live="polite">
            <InlineLoading label={operationStatus.title} size="xs" tone="neutral" />
            {operationStatus.detail && <span>{operationStatus.detail}</span>}
          </div>
        )}
        {error && <div className="asset-library-home-alert" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}

        <div className="asset-library-home-grid">
          {items.map((item) => (
            <ProjectAssetCard
              key={item.id}
              onOpenCloud={item.cloudProjectId && onOpenCloudProject ? () => onOpenCloudProject(item.cloudProjectId!) : undefined}
              item={item}
              busy={busy}
              opening={openingPath === item.localPath}
              activity={formatActivity(item.lastModifiedAt, "", formatDate, formatRelativeTime)}
              onOpen={() => item.localPath ? void openPath(item.localPath) : item.cloudProjectId && onOpenCloudProject?.(item.cloudProjectId)}
            />
          ))}
          <div className="asset-library-new-project-wrap">
            <button className="asset-library-new-project" type="button" disabled={busy} onClick={() => void chooseFolder()}>
              <span className="asset-library-new-project-body"><Plus size={19} strokeWidth={1.7} /><span>{t("onboarding.library.newProject")}</span></span>
            </button>
          </div>
        </div>
      </section>

      {folderDrop.dragging && <div className="asset-library-home-drop-overlay" aria-hidden="true"><FolderOpen size={24} strokeWidth={1.6} /><strong>{t("onboarding.library.dropOverlay")}</strong></div>}
    </main>
  );
}

function ProjectAssetCard({
  item,
  onOpenCloud,
  busy,
  opening,
  activity,
  onOpen,
}: {
  item: ProjectHomeItem;
  onOpenCloud?: () => void;
  busy: boolean;
  opening: boolean;
  activity: string;
  onOpen: () => void;
}) {
  const { t } = useLocalization();
  const name = item.label || item.localPath.split("/").at(-1) || t("onboarding.projects.untitled");
  return (
    <article className={`asset-library-card ${opening ? "is-opening" : ""}`}>
      <button
        className="asset-library-card-main"
        type="button"
        disabled={busy}
        aria-busy={opening || undefined}
        aria-label={t(item.cloudProjectId ? item.localPath ? "cloud.home.openLocal" : "cloud.home.openCloud" : "onboarding.projects.open", { project: bidiIsolate(name) })}
        onClick={onOpen}
      >
        <span className="asset-library-card-cover" data-signature="0" aria-hidden="true"><span className="asset-library-card-monogram">{name.slice(0, 2).toUpperCase()}</span></span>
        <span className="asset-library-card-body">
          <Tooltip content={item.localPath || item.cloudProjectId} overflowOnly><bdi className="asset-library-card-title">{name}</bdi></Tooltip>
          <span className="asset-library-card-footer">
            <span className="asset-library-card-location local">
              {opening ? <InlineLoading label={t("onboarding.status.opening")} size="xs" tone="neutral" /> : <><HomeProjectIcon item={item} /><span>{t(item.localPath ? "onboarding.library.location.local" : "cloud.home.cloud")}</span></>}
            </span>
            <span className="asset-library-card-meta">{activity}</span>
          </span>
        </span>
      </button>
      {item.localPath && onOpenCloud && <button type="button" className="desktop-cloud-row-action"
        disabled={busy} aria-label={t("cloud.home.openCloud", { project: bidiIsolate(name) })}
        onClick={onOpenCloud}><Cloud size={12} />{t("cloud.home.cloud")}</button>}
    </article>
  );
}

function formatActivity(
  value: string | null | undefined,
  fallback: string,
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string,
  formatRelativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string,
) {
  if (!value) return fallback;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return fallback;
  const elapsed = Math.max(0, Date.now() - timestamp);
  const hour = 3_600_000;
  const day = 24 * hour;
  if (elapsed < hour) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / 60_000)), "minute", { numeric: "auto" });
  if (elapsed < day) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / hour)), "hour", { numeric: "auto" });
  if (elapsed < 7 * day) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / day)), "day", { numeric: "auto" });
  return formatDate(timestamp, { month: "short", day: "numeric", year: "numeric" });
}
