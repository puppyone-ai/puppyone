import { Tooltip } from "@puppyone/shared-ui";
import { Fragment, type ReactNode, type RefObject } from "react";
import { Forward } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { getOrderedHeaderElementDefinitions, type HeaderElementRenderContext } from "./headerElements";
import type { TitlebarActionsSettings } from "../../preferences";
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
import { GIT_HEADER_CARD_ID } from "./DesktopGitHeaderCard";

type DesktopTitlebarActionsProps = {
  desktopUpdateState?: DesktopUpdateState | null;
  titlebarActionsSettings: TitlebarActionsSettings;
  terminalSidebarOpen: boolean;
  terminalToolEnabled: boolean;
  gitChangesAvailable?: boolean;
  gitChangesOpen?: boolean;
  gitChangesStatus?: GitTitlebarStatus;
  gitCardEnabled?: boolean;
  gitAnchorRef?: RefObject<HTMLDivElement>;
  onUpdateNow?: () => void;
  onToggleTerminal: () => void;
  onToggleGitChanges?: () => void;
  cloudEnabled?: boolean;
  shareEnabled?: boolean;
  onShare?: () => void;
  activeCoachmark?: HeaderCoachmarkId | null;
  onAcknowledgeCoachmark?: (id: HeaderCoachmarkId) => void;
  placement?: "titlebar" | "toolbar";
  changesInProjectContext?: boolean;
  visibleGroups?: readonly DesktopTitlebarActionGroup[];
};

export type DesktopTitlebarActionGroup = "app-status" | "project" | "header" | "right-sidebar";

export function DesktopTitlebarActions({
  desktopUpdateState = null,
  titlebarActionsSettings,
  terminalSidebarOpen,
  terminalToolEnabled,
  gitChangesAvailable = false,
  gitChangesOpen = false,
  gitChangesStatus = EMPTY_GIT_TITLEBAR_STATUS,
  gitCardEnabled = false,
  gitAnchorRef,
  onUpdateNow = () => {},
  onToggleTerminal,
  onToggleGitChanges = () => {},
  cloudEnabled = false,
  shareEnabled = false,
  onShare = () => {},
  activeCoachmark = null,
  onAcknowledgeCoachmark = () => {},
  placement = "titlebar",
  changesInProjectContext = false,
  visibleGroups,
}: DesktopTitlebarActionsProps) {
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
      cardId: gitCardEnabled && placement === "titlebar" ? GIT_HEADER_CARD_ID : undefined,
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

    const group: DesktopTitlebarActionGroup = changesInProjectContext
      && placement === "titlebar"
      && definition.id === "changes"
      ? "project"
      : definition.linkedRightSidebarToolId ? "right-sidebar" : "header";
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
          : item.group === "project";
        return (
          <Fragment key={item.id}>
            {separatesActionGroups && (
              <span className="desktop-titlebar-action-divider" aria-hidden="true" />
            )}
            {item.id === "changes" && gitCardEnabled && placement === "titlebar" ? (
              <div className="desktop-titlebar-git-card-anchor" ref={gitAnchorRef}>
                {item.node}
              </div>
            ) : item.node}
          </Fragment>
        );
      })}
    </>
  );
}
