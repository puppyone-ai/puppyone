import { CloudIcon, LoadingMark, LocalIcon, Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";
import { useRef, useState, type ButtonHTMLAttributes, type DragEvent as ReactDragEvent } from "react";
import {
  getProjectName,
  getWorkspaceParentPathForDisplay,
  projectHomeItemLocation,
  type ProjectHomeItem,
} from "../../lib/workspaceHomeModel";
import type { HomepageProjectLayout } from "../../preferenceStorage";
import { ProjectRowActions, type ProjectActionSurface, type ProjectMoveTarget } from "../ProjectRowActions";
import { DesktopMenuItem } from "../DesktopMenu";
import { ProjectFolderGlyph } from "./ProjectFolderGlyph";
import { LinkedCloudProjectButton, ProjectHomeItemCaption, useProjectHomeItemCaption } from "./LinkedCloudProjectButton";
import { useProjectListNavigation } from "./useProjectListNavigation";

type ProjectChanges = {
  onRename?: (path: string, name: string) => Promise<void>;
  onRemove?: (path: string) => Promise<void>;
  onRenameCloudProject?: (projectId: string, name: string) => Promise<void>;
  onDeleteCloudProject?: (projectId: string) => Promise<void>;
};

/** Which of this computer's folders its owner's other computers can open, and where that is changed. */
export type ProjectListSharing = Readonly<{
  sharedFolderIds: ReadonlySet<string>;
  onSharingSettings: (folder: Readonly<{ folderId: string; name: string; rootPath: string }>) => void;
  /** Keeps the folder to this computer again, as moving it to On this computer. */
  onStopSharing?: (folder: Readonly<{ folderId: string; rootPath: string }>) => void;
}>;

type OnboardingProjectListProps = ProjectChanges & {
  sharing?: ProjectListSharing;
  /** The other groups each project can be moved to from its menu. */
  moveTargets?: (item: ProjectHomeItem) => readonly ProjectMoveTarget[];
  /** The rows are not settled yet, so the mark stands in for them. */
  held?: boolean;
  items: ProjectHomeItem[];
  layout?: HomepageProjectLayout;
  onOpenCloudProject?: (projectId: string) => void;
  busy: boolean;
  openingPath: string | null;
  draggingPath: string | null;
  onOpen: (path: string) => void;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>, item: ProjectHomeItem) => void;
  onDragEnd: () => void;
};

export function OnboardingProjectList({
  held = false,
  items,
  layout = "grid",
  onOpenCloudProject,
  busy,
  openingPath,
  draggingPath,
  onOpen,
  onDragStart,
  onDragEnd,
  sharing,
  moveTargets,
  ...changes
}: OnboardingProjectListProps) {
  const { t, formatRelativeTime } = useLocalization();
  const [actions, setActions] = useState<{ id: string; surface: ProjectActionSurface } | null>(null);
  const navigation = useProjectListNavigation(items.map((item) => item.id), layout);

  if (held) return (
    <div className="onboarding-project-list-wait">
      <LoadingMark className="onboarding-project-list-loading" layout="area"
        ariaLabel={t("common.status.loading")} size="md" tone="neutral" />
    </div>
  );

  return (
    <ul
      ref={navigation.listRef}
      role="list"
      className="onboarding-project-list"
      data-project-layout={layout}
      data-po-scrollbar="menu"
      data-po-scrollbar-visibility="always"
      aria-label={t("onboarding.projects.title")}
      onKeyDown={navigation.onKeyDown}
    >
      {items.map((item) => {
        const name = getProjectName(item, t("onboarding.projects.untitled"));
        const location = projectHomeItemLocation(item);
        const surface = actions?.id === item.id ? actions.surface : null;
        const dragging = draggingPath === item.localPath;
        const linked = item.linkedCloudProject;
        const modified = formatModificationTime(item.lastModifiedAt, t, formatRelativeTime);
        const sharedId = item.localPath && item.hostFolderId && sharing?.sharedFolderIds.has(item.hostFolderId)
          ? item.hostFolderId : null;
        const tabIndex = item.id === navigation.stopId ? 0 : -1;
        const open = {
          "data-project-open": true,
          tabIndex,
          disabled: busy,
          "aria-busy": openingPath === item.localPath || undefined,
          "aria-label": t(location === "cloud" ? "cloud.home.openCloud" : "cloud.home.openLocal", { project: bidiIsolate(name) }),
          draggable: !busy && Boolean(item.localPath),
          onClick: () => location === "cloud" && item.cloudProjectId ? onOpenCloudProject?.(item.cloudProjectId) : onOpen(item.localPath),
          onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => onDragStart(event, item),
          onDragEnd,
        };
        return (
          <li key={item.id} className={`onboarding-project-row-wrap ${linked ? "has-cloud-project" : ""} ${dragging ? "is-dragging" : ""}`}
            data-menu-open={surface === "menu" ? "true" : undefined}
            data-project-location={location}
            data-cloud-project-id={item.cloudProjectId}
            data-linked-cloud-project-id={linked?.id}
            onFocus={() => navigation.setFocusedId(item.id)}>
            {layout === "grid" ? <ProjectTile item={item} name={name} modified={modified} shared={Boolean(sharedId)} {...open} /> : <DesktopMenuItem
              className="onboarding-project-row"
              role="button"
              icon={<span className="onboarding-project-icon" aria-hidden="true"><ProjectFolderGlyph /></span>}
              label={<><bdi>{name}</bdi><ProjectPlaceMark cloud={location === "cloud"} /></>}
              detail={location === "cloud" ? <ProjectHomeItemCaption item={item} />
                : <bdi dir="ltr">{getWorkspaceParentPathForDisplay(item.localPath)}</bdi>}
              trailing={modified}
              {...open}
            />}
            {linked && onOpenCloudProject && <LinkedCloudProjectButton project={linked} busy={busy}
              className="onboarding-project-cloud-link" tabIndex={tabIndex}
              onOpen={() => onOpenCloudProject(linked.id)} />}
            <ProjectActions item={item} name={name} busy={busy} surface={surface} tabIndex={tabIndex} {...changes}
              moveTargets={moveTargets?.(item)}
              onSharingSettings={sharedId && sharing
                ? () => sharing.onSharingSettings({ folderId: sharedId, name, rootPath: item.localPath }) : undefined}
              onSurfaceChange={(next) => {
                if (!next) navigation.handOffFocusIfGone(item.id);
                setActions(next && { id: item.id, surface: next });
              }} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What can be done to one entry. A folder and its Cloud project are two projects
 * (ADR-001), so each menu speaks for its own entry: a folder is only ever unlinked
 * from this app, and only a Cloud project can be deleted.
 */
function offeredProjectChanges({ localPath, cloudProjectId, cloudActions }: ProjectHomeItem, changes: ProjectChanges) {
  const { onRename, onRemove, onRenameCloudProject, onDeleteCloudProject } = changes;
  if (localPath) return {
    onRename: onRename && ((name: string) => onRename(localPath, name)),
    onUnlink: onRemove && (() => onRemove(localPath)),
  };
  if (!cloudProjectId) return {};
  return {
    onRename: cloudActions?.rename && onRenameCloudProject ? (name: string) => onRenameCloudProject(cloudProjectId, name) : undefined,
    onDelete: cloudActions?.delete && onDeleteCloudProject ? () => onDeleteCloudProject(cloudProjectId) : undefined,
  };
}

/** Nothing is offered that this account may not do; an entry with nothing to offer has no trigger. */
function ProjectActions({ item, name, busy, surface, tabIndex, onSurfaceChange, onSharingSettings, moveTargets, ...changes }: ProjectChanges & {
  item: ProjectHomeItem;
  onSharingSettings?: () => void;
  moveTargets?: readonly ProjectMoveTarget[];
  name: string;
  busy: boolean;
  surface: ProjectActionSurface;
  tabIndex: number;
  onSurfaceChange: (surface: ProjectActionSurface) => void;
}) {
  const offered = { ...offeredProjectChanges(item, changes), onSharingSettings };
  if (!Object.values(offered).some(Boolean) && !moveTargets?.length) return null;
  return (
    <ProjectRowActions
      project={{ name, path: item.localPath || undefined }}
      surface={surface}
      onSurfaceChange={onSurfaceChange}
      disabled={busy}
      triggerClassName="desktop-menu-icon-button onboarding-project-actions"
      triggerTabIndex={tabIndex}
      menuPlacement="beside"
      moveTargets={moveTargets}
      {...offered}
    />
  );
}

/**
 * Where a shared project lives, as one small mark after its name: the Cloud, or a
 * computer. Shown only in the shared groups; the local group needs no mark.
 */
export function ProjectPlaceMark({ cloud }: { cloud: boolean }) {
  const Icon = cloud ? CloudIcon : LocalIcon;
  return <span className="onboarding-project-place-mark" aria-hidden="true"><Icon size={12} strokeWidth={1.85} /></span>;
}

/**
 * One project on the Grid: a folder and one line of name. Every project is the same
 * folder. The tooltip adds where it lives and when it last changed, and the name
 * itself only when the line has cut it.
 */
function ProjectTile({ item, name, modified, shared, ...button }: {
  item: ProjectHomeItem;
  name: string;
  modified: string | null;
  shared: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { t } = useLocalization();
  const caption = useProjectHomeItemCaption(item);
  const place = projectHomeItemLocation(item) === "cloud" ? caption : getWorkspaceParentPathForDisplay(item.localPath);
  const nameRef = useRef<HTMLElement>(null);
  const [nameCut, setNameCut] = useState(false);
  const measureName = () => {
    const shown = nameRef.current;
    setNameCut(Boolean(shown && shown.scrollWidth > shown.clientWidth));
  };
  return (
    <Tooltip content={[nameCut && name, place, shared && t("hosts.home.shared"), modified].filter(Boolean).join(" · ")}>
      <button type="button" className="onboarding-project-tile" onPointerEnter={measureName} onFocus={measureName} {...button}>
        <span className="onboarding-project-folder" aria-hidden="true"><ProjectFolderGlyph /></span>
        <span className="onboarding-project-tile-label">
          <bdi ref={nameRef} className="onboarding-project-tile-name">{name}</bdi>
          <ProjectPlaceMark cloud={projectHomeItemLocation(item) === "cloud"} />
        </span>
      </button>
    </Tooltip>
  );
}

function formatModificationTime(
  value: string | null | undefined,
  t: MessageFormatter,
  formatRelativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string,
) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return t("onboarding.time.justNow");
  if (elapsed < hour) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / minute)), "minute", { numeric: "always" });
  if (elapsed < day) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / hour)), "hour", { numeric: "always" });
  return formatRelativeTime(-Math.max(1, Math.floor(elapsed / day)), "day", { numeric: "always" });
}
