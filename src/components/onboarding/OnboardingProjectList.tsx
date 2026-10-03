import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";
import { Cloud, Folder, Unlink } from "lucide-react";
import { Fragment, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import {
  getHomeProjectGroup as projectGroup,
  getProjectName,
  getWorkspaceParentPathForDisplay,
  type ProjectHomeItem,
} from "../../features/app-shell/workspaceHomeModel";
import { DesktopMenuIconButton, DesktopMenuItem } from "../DesktopMenu";
import { InlineLoading } from "../loading";

type OnboardingProjectListProps = {
  items: ProjectHomeItem[];
  grouped?: boolean;
  status?: ReactNode;
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
  grouped = false,
  status,
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
    <div className="onboarding-project-list" data-po-scrollbar="menu">
      {status}
      {items.map((item, index) => {
        const name = getProjectName(item, t("onboarding.projects.untitled"));
        const parentPath = getWorkspaceParentPathForDisplay(item.localPath);
        const removing = removingPath === item.localPath;
        const dragging = draggingPath === item.localPath;
        const group = projectGroup(item);
        return (
          <Fragment key={item.id}>
          {grouped && (index === 0 || projectGroup(items[index - 1]!) !== group) && (
            <h2 className="onboarding-project-group">{t(`cloud.home.group.${group}`)}</h2>
          )}
          <div className={`onboarding-project-row-wrap ${item.cloudProjectId && item.localPath ? "has-cloud" : ""} ${removing ? "is-removing" : ""} ${dragging ? "is-dragging" : ""}`}
            data-project-group={group} data-cloud-project-id={item.cloudProjectId}>
            <DesktopMenuItem
              className="onboarding-project-row"
              role="button"
              icon={item.localPath ? <Folder size={14} strokeWidth={1.85} /> : <Cloud size={14} strokeWidth={1.85} />}
              label={<bdi>{name}</bdi>}
              detail={parentPath ? <Tooltip content={item.localPath} overflowOnly><bdi dir="ltr">{parentPath}</bdi></Tooltip>
                : item.cloudProjectId ? <Tooltip content={item.cloudProjectId}><bdi>{item.cloudProjectId.slice(0, 8)}</bdi></Tooltip> : undefined}
              trailing={openingPath === item.localPath
                ? <InlineLoading label={t("onboarding.status.opening")} size="xs" tone="neutral" />
                : !item.localPath && !item.lastOpenedAt ? null : formatRecentWorkspaceTime(item.lastOpenedAt, t, formatRelativeTime)}
              disabled={busy}
              aria-busy={openingPath === item.localPath || undefined}
              aria-label={t(item.cloudProjectId ? item.localPath ? "cloud.home.openLocal" : "cloud.home.openCloud" : "onboarding.projects.open", { project: bidiIsolate(name) })}
              draggable={!busy && Boolean(item.localPath)}
              onClick={() => item.localPath ? onOpen(item.localPath) : item.cloudProjectId && onOpenCloudProject?.(item.cloudProjectId)}
              onDragStart={(event) => onDragStart(event, item)}
              onDragEnd={onDragEnd}
            />
            {item.localPath && item.cloudProjectId && onOpenCloudProject && <button type="button"
              className="onboarding-project-cloud desktop-cloud-row-action" disabled={busy}
              aria-label={t("cloud.home.openCloud", { project: bidiIsolate(name) })}
              onClick={() => onOpenCloudProject(item.cloudProjectId!)}><Cloud size={12} />{t("cloud.home.cloud")}</button>}
            {onRemove && item.localPath && (
              <DesktopMenuIconButton
                className="onboarding-project-remove"
                disabled={busy && !removing}
                aria-busy={removing || undefined}
                label={t("onboarding.projects.removeFor", { project: bidiIsolate(name) })}
                tooltip={t("onboarding.projects.removeHint")}
                onClick={() => onRemove(item)}
                icon={removing
                  ? <InlineLoading label={null} size="xs" tone="neutral" />
                  : <Unlink size={14} aria-hidden="true" />}
              />
            )}
          </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function formatRecentWorkspaceTime(
  value: string | null | undefined,
  t: MessageFormatter,
  formatRelativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string,
) {
  if (!value) return t("onboarding.time.previouslyOpened");
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return t("onboarding.time.previouslyOpened");
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return t("onboarding.time.justNow");
  if (elapsed < hour) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / minute)), "minute", { numeric: "always" });
  if (elapsed < day) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / hour)), "hour", { numeric: "always" });
  return formatRelativeTime(-Math.max(1, Math.floor(elapsed / day)), "day", { numeric: "always" });
}
