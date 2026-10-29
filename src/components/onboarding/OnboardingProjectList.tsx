import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";
import { Unlink } from "lucide-react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  getProjectName,
  getWorkspaceParentPathForDisplay,
  projectHomeItemLocation,
  type ProjectHomeItem,
} from "../../lib/workspaceHomeModel";
import { DesktopMenuIconButton, DesktopMenuItem } from "../DesktopMenu";
import { InlineLoading } from "../loading";
import { HomeProjectIcon } from "./HomeProjectIcon";
import { LinkedCloudProjectButton, ProjectHomeItemCaption } from "./LinkedCloudProjectButton";

type OnboardingProjectListProps = {
  items: ProjectHomeItem[];
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

  return (
    <div
      className="onboarding-project-list"
      data-po-scrollbar="menu"
      data-po-scrollbar-visibility="always"
      role="region"
      aria-label={t("onboarding.projects.title")}
      tabIndex={0}
    >
      {items.map((item) => {
        const name = getProjectName(item, t("onboarding.projects.untitled"));
        const location = projectHomeItemLocation(item);
        const removing = removingPath === item.localPath;
        const dragging = draggingPath === item.localPath;
        const linked = item.linkedCloudProject;
        return (
          <div key={item.id} className={`onboarding-project-row-wrap ${linked ? "has-cloud-project" : ""} ${removing ? "is-removing" : ""} ${dragging ? "is-dragging" : ""}`}
            data-project-location={location}
            data-cloud-project-id={item.cloudProjectId}
            data-linked-cloud-project-id={linked?.id}>
            <DesktopMenuItem
              className="onboarding-project-row"
              role="button"
              icon={<HomeProjectIcon item={item} />}
              label={<bdi>{name}</bdi>}
              detail={location === "cloud" ? <ProjectHomeItemCaption item={item} />
                : <bdi dir="ltr">{getWorkspaceParentPathForDisplay(item.localPath)}</bdi>}
              trailing={formatModificationTime(item.lastModifiedAt, t, formatRelativeTime)}
              disabled={busy}
              aria-busy={openingPath === item.localPath || undefined}
              aria-label={t(location === "cloud" ? "cloud.home.openCloud" : "cloud.home.openLocal", { project: bidiIsolate(name) })}
              draggable={!busy && Boolean(item.localPath)}
              onClick={() => location === "cloud" && item.cloudProjectId ? onOpenCloudProject?.(item.cloudProjectId) : onOpen(item.localPath)}
              onDragStart={(event) => onDragStart(event, item)}
              onDragEnd={onDragEnd}
            />
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
      })}
    </div>
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
