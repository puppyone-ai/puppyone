import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";
import { useRef, useState, type ButtonHTMLAttributes, type DragEvent as ReactDragEvent } from "react";
import {
  getProjectName,
  getWorkspaceParentPathForDisplay,
  projectHomeItemLocation,
  type ProjectHomeItem,
} from "../../lib/workspaceHomeModel";
import type { HomepageProjectLayout } from "../../preferenceStorage";
import { ProjectRowActions, type ProjectActionSurface } from "../../features/app-shell/ProjectRowActions";
import { DesktopMenuItem } from "../DesktopMenu";
import { HomeProjectIcon, ProjectFolder } from "./HomeProjectIcon";
import { LinkedCloudProjectButton, ProjectHomeItemCaption, useProjectHomeItemCaption } from "./LinkedCloudProjectButton";

type ProjectChanges = {
  onRename?: (path: string, name: string) => Promise<void>;
  onRemove?: (path: string) => Promise<void>;
  onRenameCloudProject?: (projectId: string, name: string) => Promise<void>;
  onDeleteCloudProject?: (projectId: string) => Promise<void>;
};

type OnboardingProjectListProps = ProjectChanges & {
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
  items,
  layout = "grid",
  onOpenCloudProject,
  busy,
  openingPath,
  draggingPath,
  onOpen,
  onDragStart,
  onDragEnd,
  ...changes
}: OnboardingProjectListProps) {
  const { t, formatRelativeTime } = useLocalization();
  const [actions, setActions] = useState<{ id: string; surface: ProjectActionSurface } | null>(null);

  return (
    <div
      className="onboarding-project-list"
      data-project-layout={layout}
      data-po-scrollbar="menu"
      data-po-scrollbar-visibility="always"
      role="region"
      aria-label={t("onboarding.projects.title")}
      tabIndex={0}
    >
      {items.map((item) => {
        const name = getProjectName(item, t("onboarding.projects.untitled"));
        const location = projectHomeItemLocation(item);
        const surface = actions?.id === item.id ? actions.surface : null;
        const dragging = draggingPath === item.localPath;
        const linked = item.linkedCloudProject;
        const modified = formatModificationTime(item.lastModifiedAt, t, formatRelativeTime);
        const open = {
          disabled: busy,
          "aria-busy": openingPath === item.localPath || undefined,
          "aria-label": t(location === "cloud" ? "cloud.home.openCloud" : "cloud.home.openLocal", { project: bidiIsolate(name) }),
          draggable: !busy && Boolean(item.localPath),
          onClick: () => location === "cloud" && item.cloudProjectId ? onOpenCloudProject?.(item.cloudProjectId) : onOpen(item.localPath),
          onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => onDragStart(event, item),
          onDragEnd,
        };
        return (
          <div key={item.id} className={`onboarding-project-row-wrap ${linked ? "has-cloud-project" : ""} ${dragging ? "is-dragging" : ""}`}
            data-menu-open={surface === "menu" ? "true" : undefined}
            data-project-location={location}
            data-cloud-project-id={item.cloudProjectId}
            data-linked-cloud-project-id={linked?.id}>
            {layout === "grid" ? <ProjectTile item={item} name={name} modified={modified} {...open} /> : <DesktopMenuItem
              className="onboarding-project-row"
              role="button"
              icon={<HomeProjectIcon item={item} filled />}
              label={<bdi>{name}</bdi>}
              detail={location === "cloud" ? <ProjectHomeItemCaption item={item} />
                : <bdi dir="ltr">{getWorkspaceParentPathForDisplay(item.localPath)}</bdi>}
              trailing={modified}
              {...open}
            />}
            {linked && onOpenCloudProject && <LinkedCloudProjectButton project={linked} busy={busy}
              className="onboarding-project-cloud-link"
              onOpen={() => onOpenCloudProject(linked.id)} />}
            <ProjectActions item={item} name={name} busy={busy} surface={surface} {...changes}
              onSurfaceChange={(next) => setActions(next && { id: item.id, surface: next })} />
          </div>
        );
      })}
    </div>
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
function ProjectActions({ item, name, busy, surface, onSurfaceChange, ...changes }: ProjectChanges & {
  item: ProjectHomeItem;
  name: string;
  busy: boolean;
  surface: ProjectActionSurface;
  onSurfaceChange: (surface: ProjectActionSurface) => void;
}) {
  const offered = offeredProjectChanges(item, changes);
  if (!Object.values(offered).some(Boolean)) return null;
  return (
    <ProjectRowActions
      project={{ name, path: item.localPath || undefined }}
      surface={surface}
      onSurfaceChange={onSurfaceChange}
      disabled={busy}
      triggerClassName="desktop-menu-icon-button onboarding-project-actions"
      menuPlacement="beside"
      {...offered}
    />
  );
}

/**
 * One project on the Grid: a folder and one line of name. The tooltip adds where it
 * lives and when it last changed, and the name itself only when the line has cut it.
 */
function ProjectTile({ item, name, modified, ...button }: {
  item: ProjectHomeItem;
  name: string;
  modified: string | null;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const caption = useProjectHomeItemCaption(item);
  const place = projectHomeItemLocation(item) === "cloud" ? caption : getWorkspaceParentPathForDisplay(item.localPath);
  const nameRef = useRef<HTMLElement>(null);
  const [nameCut, setNameCut] = useState(false);
  const measureName = () => {
    const shown = nameRef.current;
    setNameCut(Boolean(shown && shown.scrollWidth > shown.clientWidth));
  };
  return (
    <Tooltip content={[nameCut && name, place, modified].filter(Boolean).join(" · ")}>
      <button type="button" className="onboarding-project-tile" onPointerEnter={measureName} onFocus={measureName} {...button}>
        <ProjectFolder item={item} />
        <bdi ref={nameRef} className="onboarding-project-tile-name">{name}</bdi>
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
