import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { RightSidebarToolId, TitlebarActionId } from "../../preferences";
import type { MessageFormatter } from "@puppyone/localization";
import { AgentEntryIcon } from "./AgentEntryIcon";

const AGENT_ENTRY_LABEL = "Agent";

export type HeaderElementDefinition = {
  id: TitlebarActionId;
  label: string;
  icon: LucideIcon;
  linkedRightSidebarToolId?: RightSidebarToolId;
  isAvailable: (context: HeaderElementRenderContext) => boolean;
  render: (context: HeaderElementRenderContext) => ReactNode;
};

export type HeaderElementRenderContext = {
  t: MessageFormatter;
  placement?: "titlebar" | "toolbar";
  terminal: {
    enabled: boolean;
    onToggle: () => void;
    sidebarOpen: boolean;
  };
};

export const HEADER_ELEMENT_DEFINITIONS: readonly HeaderElementDefinition[] = [
  {
    id: "terminal",
    label: AGENT_ENTRY_LABEL,
    icon: AgentEntryIcon,
    linkedRightSidebarToolId: "terminal",
    isAvailable: (context) => context.terminal.enabled,
    render: (context) => {
      const terminal = context.terminal;
      const toolbarPlacement = context.placement === "toolbar";
      const toggleLabel = toolbarPlacement
        ? AGENT_ENTRY_LABEL
        : context.t(terminal.sidebarOpen ? "shell.titlebar.hideAgent" : "shell.titlebar.showAgent");
      return (
        <button
          className={toolbarPlacement
            ? "desktop-shell-toolbar-button desktop-shell-toolbar-terminal"
            : "desktop-titlebar-action desktop-titlebar-terminal"}
          type="button"
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-pressed={terminal.sidebarOpen}
          data-toolbar-action={toolbarPlacement ? "terminal" : undefined}
          onClick={terminal.onToggle}
        >
          {toolbarPlacement ? (
            <i
              className="desktop-shell-toolbar-button-icon"
              aria-hidden="true"
            >
              <AgentEntryIcon size={19} strokeWidth={1.8} />
            </i>
          ) : (
            <AgentEntryIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          )}
          {toolbarPlacement && (
            <span className="desktop-shell-toolbar-button-label">
              {AGENT_ENTRY_LABEL}
            </span>
          )}
        </button>
      );
    },
  },
] as const;

export function getHeaderElementDefinition(id: TitlebarActionId) {
  return HEADER_ELEMENT_DEFINITIONS.find((definition) => definition.id === id) ?? null;
}

export function getOrderedHeaderElementDefinitions(order: TitlebarActionId[]) {
  return order
    .map(getHeaderElementDefinition)
    .filter((definition): definition is HeaderElementDefinition => Boolean(definition));
}
