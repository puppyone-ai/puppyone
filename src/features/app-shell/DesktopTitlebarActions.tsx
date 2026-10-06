import { useDesktopPreference } from "../../preferencesStore";
import { Tooltip } from "@puppyone/shared-ui";
import { Fragment, type ReactNode } from "react";
import { Forward } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { getOrderedHeaderElementDefinitions, type HeaderElementRenderContext } from "./headerElements";
import type { DesktopUpdateState } from "../../types/electron";
import {
  DesktopUpdateTitlebarButton,
  getDesktopUpdateTitlebarState,
  normalizeDesktopUpdateState,
} from "../updates";
import {
  EMPTY_GIT_TITLEBAR_STATUS,
  type GitTitlebarStatus,
} from "../source-control/gitTitlebarStatus";
import type { HeaderCoachmarkId } from "./headerCoachmarks";

type DesktopTitlebarActionsProps = {
  desktopUpdateState?: DesktopUpdateState | null;
  terminalSidebarOpen: boolean;
  terminalToolEnabled: boolean;
  gitChangesAvailable?: boolean;
  gitChangesOpen?: boolean;
  gitChangesStatus?: GitTitlebarStatus;
  onUpdateNow?: () => void;
  onToggleTerminal: () => void;
  onToggleGitChanges?: () => void;
  cloudEnabled?: boolean;
  shareEnabled?: boolean;
  onShare?: () => void;
  activeCoachmark?: HeaderCoachmarkId | null;
  onAcknowledgeCoachmark?: (id: HeaderCoachmarkId) => void;
  placement?: "titlebar" | "toolbar";
  visibleGroups?: readonly DesktopTitlebarActionGroup[];
};

export type DesktopTitlebarActionGroup = "app-status" | "header" | "right-sidebar";

export function DesktopTitlebarActions({
  desktopUpdateState = null,
  terminalSidebarOpen,
  terminalToolEnabled,
  gitChangesAvailable = false,
  gitChangesOpen = false,
  gitChangesStatus = EMPTY_GIT_TITLEBAR_STATUS,
  onUpdateNow = () => {},
  onToggleTerminal,
  onToggleGitChanges = () => {},
  cloudEnabled = false,
  shareEnabled = false,
  onShare = () => {},
  activeCoachmark = null,
  onAcknowledgeCoachmark = () => {},
  placement = "titlebar",
  visibleGroups,
}: DesktopTitlebarActionsProps) {
  const titlebarActionsSettings = useDesktopPreference(s => s.titlebarActionsSettings);
  const { t } = useLocalization();

  const headerElementContext: HeaderElementRenderContext = {
    t,
    placement,
    coachmark: {
      active: activeCoachmark,
      acknowledge: onAcknowledgeCoachmark,
    },
    terminal: {
      enabled: terminalToolEnabled,
      onToggle: onToggleTerminal,
      sidebarOpen: terminalSidebarOpen,
    },
    changes: {
      enabled: gitChangesAvailable,
      onToggle: onToggleGitChanges,
      sidebarOpen: gitChangesOpen,
      status: gitChangesStatus,
    },
  };

  const normalizedUpdateState = normalizeDesktopUpdateState(desktopUpdateState);
  const titlebarActionItems: Array<{
    group: DesktopTitlebarActionGroup;
    id: string;
    node: ReactNode;
  }> = [];

  if (getDesktopUpdateTitlebarState(normalizedUpdateState)) {
    titlebarActionItems.push({
      group: "app-status",
      id: "app-update",
      node: (
        <DesktopUpdateTitlebarButton
          state={normalizedUpdateState}
          onUpdateNow={onUpdateNow}
        />
      ),
    });
  }

  if (cloudEnabled && shareEnabled && placement === "titlebar") {
    const shareLabel = t("shell.titlebar.share");
    titlebarActionItems.push({
      group: "header",
      id: "share",
      node: (
        <Tooltip content={shareLabel}><button
          type="button"
          className="desktop-titlebar-action desktop-titlebar-share"
          aria-label={shareLabel}
          onClick={onShare}
        >
          <Forward size={16} strokeWidth={1.8} aria-hidden="true" />
          <span className="desktop-titlebar-share-label">{shareLabel}</span>
        </button></Tooltip>
      ),
    });
  }

  for (const definition of getOrderedHeaderElementDefinitions(titlebarActionsSettings.order)) {
    if (
      !titlebarActionsSettings.enabled[definition.id]
      || !definition.isAvailable(headerElementContext)
    ) {
      continue;
    }

    const group: DesktopTitlebarActionGroup = definition.linkedRightSidebarToolId
      ? "right-sidebar" : "header";
    const element = definition.render(headerElementContext);

    titlebarActionItems.push({
      group,
      id: definition.id,
      node: element,
    });
  }

  const placementOrderedItems = placement === "toolbar"
    ? [
        ...titlebarActionItems.filter((item) => item.id !== "terminal"),
        ...titlebarActionItems.filter((item) => item.id === "terminal"),
      ]
    : titlebarActionItems;
  const visibleTitlebarActionItems = visibleGroups
    ? placementOrderedItems.filter((item) => visibleGroups.includes(item.group))
    : placementOrderedItems;

  return (
    <>
      {visibleTitlebarActionItems.map((item, index) => {
        const previousItem = visibleTitlebarActionItems[index - 1];
        const separatesActionGroups = previousItem
          ? previousItem.group !== item.group || previousItem.id === "share"
          : false;
        return (
          <Fragment key={item.id}>
            {separatesActionGroups && (
              <span className="desktop-titlebar-action-divider" aria-hidden="true" />
            )}
            {item.node}
          </Fragment>
        );
      })}
    </>
  );
}
