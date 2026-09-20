import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";
import { Folder, Unlink } from "lucide-react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  getProjectName,
  getWorkspaceParentPathForDisplay,
  type ProjectHomeItem,
} from "../../features/app-shell/workspaceHomeModel";
import { DesktopMenuIconButton, DesktopMenuItem } from "../DesktopMenu";
import { InlineLoading } from "../loading";

type OnboardingProjectListProps = {
  items: ProjectHomeItem[];
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
      {items.map((item) => {
        const name = getProjectName(item, t("onboarding.projects.untitled"));
        const parentPath = getWorkspaceParentPathForDisplay(item.localPath);
        const removing = removingPath === item.localPath;
        const dragging = draggingPath === item.localPath;
        return (
          <div className={`onboarding-project-row-wrap ${removing ? "is-removing" : ""} ${dragging ? "is-dragging" : ""}`} key={item.id}>
            <DesktopMenuItem
              className="onboarding-project-row"
              role="button"
              icon={<Folder size={14} strokeWidth={1.85} />}
              label={<bdi>{name}</bdi>}
              detail={parentPath ? <bdi dir="ltr" title={item.localPath}>{parentPath}</bdi> : undefined}
              trailing={openingPath === item.localPath
                ? <InlineLoading label={t("onboarding.status.opening")} size="xs" tone="neutral" />
                : formatRecentWorkspaceTime(item.lastOpenedAt, t, formatRelativeTime)}
              disabled={busy}
              aria-busy={openingPath === item.localPath || undefined}
              aria-label={t("onboarding.projects.open", { project: bidiIsolate(name) })}
              title={item.localPath}
              draggable={!busy}
              onClick={() => onOpen(item.localPath)}
              onDragStart={(event) => onDragStart(event, item)}
              onDragEnd={onDragEnd}
            />
            {onRemove && (
              <DesktopMenuIconButton
                className="onboarding-project-remove"
                disabled={busy && !removing}
                aria-busy={removing || undefined}
                label={t("onboarding.projects.removeFor", { project: bidiIsolate(name) })}
                title={t("onboarding.projects.removeHint")}
                onClick={() => onRemove(item)}
                icon={removing
                  ? <InlineLoading label={null} size="xs" tone="neutral" />
                  : <Unlink size={14} aria-hidden="true" />}
              />
            )}
          </div>
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
