import { Tooltip } from "@puppyone/shared-ui";
import { Fragment, type ReactNode } from "react";
import { Share } from "lucide-react";
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
  onUpdateNow?: () => void;
  onToggleTerminal: () => void;
  onToggleGitChanges?: () => void;
  shareEnabled?: boolean;
  onShare?: () => void;
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
  onUpdateNow = () => {},
  onToggleTerminal,
  onToggleGitChanges = () => {},
  shareEnabled = false,
  onShare = () => {},
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

  if (shareEnabled && placement === "titlebar") {
    titlebarActionItems.push({
      group: "header",
      id: "share",
      node: <Tooltip content={t("shell.titlebar.share")}><button type="button" className="desktop-titlebar-action desktop-titlebar-share"
         aria-label={t("shell.titlebar.share")} onClick={onShare}>
        <Share size={16} strokeWidth={1.8} aria-hidden="true" />
      </button></Tooltip>,
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
        const separatesActionGroups = previousItem
          && (previousItem.group !== item.group || previousItem.id === "share");
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
