import { Fragment, type ReactNode } from "react";
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

type DesktopTitlebarActionsProps = {
  desktopUpdateState?: DesktopUpdateState | null;
  titlebarActionsSettings: TitlebarActionsSettings;
  terminalSidebarOpen: boolean;
  terminalToolEnabled: boolean;
  gitChangesAvailable?: boolean;
  gitChangesOpen?: boolean;
  gitChangesStatus?: GitTitlebarStatus;
  gitHistoryAvailable?: boolean;
  gitHistoryOpen?: boolean;
  onUpdateNow?: () => void;
  onToggleTerminal: () => void;
  onToggleGitChanges?: () => void;
  onToggleGitHistory?: () => void;
  placement?: "titlebar" | "toolbar";
  visibleGroups?: readonly DesktopTitlebarActionGroup[];
};

export type DesktopTitlebarActionGroup = "app-status" | "header" | "right-sidebar";

export function DesktopTitlebarActions({
  desktopUpdateState = null,
  titlebarActionsSettings,
  terminalSidebarOpen,
  terminalToolEnabled,
  gitChangesAvailable = false,
  gitChangesOpen = false,
  gitChangesStatus = EMPTY_GIT_TITLEBAR_STATUS,
  gitHistoryAvailable = false,
  gitHistoryOpen = false,
  onUpdateNow = () => {},
  onToggleTerminal,
  onToggleGitChanges = () => {},
  onToggleGitHistory = () => {},
  placement = "titlebar",
  visibleGroups,
}: DesktopTitlebarActionsProps) {
  const { t } = useLocalization();

  const headerElementContext: HeaderElementRenderContext = {
    t,
    placement,
    terminal: {
      enabled: terminalToolEnabled,
      onToggle: onToggleTerminal,
      sidebarOpen: terminalSidebarOpen,
    },
    history: {
      enabled: gitHistoryAvailable,
      onToggle: onToggleGitHistory,
      sidebarOpen: gitHistoryOpen,
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

  for (const definition of getOrderedHeaderElementDefinitions(titlebarActionsSettings.order)) {
    if (
      !titlebarActionsSettings.enabled[definition.id]
      || !definition.isAvailable(headerElementContext)
    ) {
      continue;
    }

    const group = definition.linkedRightSidebarToolId ? "right-sidebar" as const : "header" as const;
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
        return (
          <Fragment key={item.id}>
            {previousItem && previousItem.group !== item.group && (
              <span className="desktop-titlebar-action-divider" aria-hidden="true" />
            )}
            {item.node}
          </Fragment>
        );
      })}
    </>
  );
}
