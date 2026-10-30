import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";
import { Unlink } from "lucide-react";
import { useMemo, type ButtonHTMLAttributes, type DragEvent as ReactDragEvent } from "react";
import {
  getProjectName,
  getWorkspaceParentPathForDisplay,
  projectHomeItemLocation,
  type ProjectHomeItem,
} from "../../lib/workspaceHomeModel";
import type { HomepageProjectLayout } from "../../preferenceStorage";
import { DesktopMenuIconButton, DesktopMenuItem } from "../DesktopMenu";
import { InlineLoading } from "../loading";
import { HomeProjectIcon, ProjectFolder } from "./HomeProjectIcon";
import { LinkedCloudProjectButton, ProjectHomeItemCaption, useProjectHomeItemCaption } from "./LinkedCloudProjectButton";
import { DESKTOP_WIDTH } from "./projectDesktop";
import { useProjectDesktop } from "./useProjectDesktop";

type OnboardingProjectListProps = {
  items: ProjectHomeItem[];
  layout?: HomepageProjectLayout;
  onOpenCloudProject?: (projectId: string) => void;
  busy: boolean;
  openingPath: string | null;
  removingPath: string | null;
  draggingPath: string | null;
  onOpen: (path: string) => void;
  onRemove?: (item: ProjectHomeItem) => void;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>, item: ProjectHomeItem) => void;
  onDragEnd: () => void;
};

export function OnboardingProjectList({
  items,
  layout = "list",
  onOpenCloudProject,
  busy,
  openingPath,
  removingPath,
  draggingPath,
  onOpen,
  onRemove,
  onDragStart,
  onDragEnd,
}: OnboardingProjectListProps) {
  const { t, formatRelativeTime } = useLocalization();
  const grid = layout === "grid";
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const desktop = useProjectDesktop(ids, busy);

  const projects = items.map((item) => {
    const name = getProjectName(item, t("onboarding.projects.untitled"));
    const location = projectHomeItemLocation(item);
    const removing = removingPath === item.localPath;
    const dragging = draggingPath === item.localPath;
    const linked = item.linkedCloudProject;
    const modified = formatModificationTime(item.lastModifiedAt, t, formatRelativeTime);
    const open = {
      disabled: busy,
      "aria-busy": openingPath === item.localPath || undefined,
      "aria-label": t(location === "cloud" ? "cloud.home.openCloud" : "cloud.home.openLocal", { project: bidiIsolate(name) }),
      onClick: () => location === "cloud" && item.cloudProjectId ? onOpenCloudProject?.(item.cloudProjectId) : onOpen(item.localPath),
    };
    return (
      <div key={item.id} className={`onboarding-project-row-wrap ${linked ? "has-cloud-project" : ""} ${removing ? "is-removing" : ""} ${dragging ? "is-dragging" : ""} ${desktop.movingId === item.id ? "is-moving" : ""}`}
        data-project-location={location}
        data-cloud-project-id={item.cloudProjectId}
        data-linked-cloud-project-id={linked?.id}
        style={grid ? desktop.place(item.id) : undefined}>
        {grid ? <ProjectTile item={item} name={name} modified={modified} {...open} {...desktop.tile(item.id)} /> : <DesktopMenuItem
          className="onboarding-project-row"
          role="button"
          icon={<HomeProjectIcon item={item} />}
          label={<bdi>{name}</bdi>}
          detail={location === "cloud" ? <ProjectHomeItemCaption item={item} />
            : <bdi dir="ltr">{getWorkspaceParentPathForDisplay(item.localPath)}</bdi>}
          trailing={modified}
          draggable={!busy && Boolean(item.localPath)}
          onDragStart={(event) => onDragStart(event, item)}
          onDragEnd={onDragEnd}
          {...open}
        />}
        {linked && onOpenCloudProject && <LinkedCloudProjectButton project={linked} busy={busy}
          className="onboarding-project-cloud-link"
          onOpen={() => onOpenCloudProject(linked.id)} />}
        {onRemove && item.localPath && (
          <Tooltip content={t("onboarding.projects.removeHint")}><DesktopMenuIconButton
            className="onboarding-project-remove"
            disabled={busy && !removing}
            aria-busy={removing || undefined}
            label={t("onboarding.projects.removeFor", { project: bidiIsolate(name) })}
            onClick={() => onRemove(item)}
            icon={removing
              ? <InlineLoading label={null} size="xs" tone="neutral" />
              : <Unlink size={14} aria-hidden="true" />}
          /></Tooltip>
        )}
      </div>
    );
  });

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
      {grid ? (
        <div
          className={`onboarding-project-desktop ${desktop.movingId ? "is-arranging" : ""}`}
          style={{ width: DESKTOP_WIDTH, height: desktop.height }}
        >
          {projects}
        </div>
      ) : projects}
    </div>
  );
}

/** One project on the Grid: a desktop icon is its name, the rest stays one hover away. */
function ProjectTile({ item, name, modified, ...button }: {
  item: ProjectHomeItem;
  name: string;
  modified: string | null;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const caption = useProjectHomeItemCaption(item);
  const place = projectHomeItemLocation(item) === "cloud" ? caption : getWorkspaceParentPathForDisplay(item.localPath);
  return (
    <Tooltip content={[place, modified].filter(Boolean).join(" · ")}>
      <button type="button" className="onboarding-project-tile" {...button}>
        <ProjectFolder item={item} />
        <bdi className="onboarding-project-tile-name">{name}</bdi>
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
