import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Asterisk,
  History,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  TITLEBAR_ACTION_IDS,
  type RightSidebarToolId,
  type TitlebarActionId,
} from "../../preferences";
import type { MessageFormatter } from "@puppyone/localization";
import { AgentEntryIcon } from "./AgentEntryIcon";
import { VersionControlIcon } from "../source-control/VersionControlIcon";
import type { GitTitlebarStatus } from "../source-control/gitTitlebarStatus";

const AGENT_ENTRY_LABEL = "Agent";

export type HeaderElementDefinition = {
  id: TitlebarActionId;
  label: string;
  icon: LucideIcon | typeof VersionControlIcon;
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
  history: {
    enabled: boolean;
    onToggle: () => void;
    sidebarOpen: boolean;
  };
  changes: {
    enabled: boolean;
    onToggle: () => void;
    sidebarOpen: boolean;
    status: GitTitlebarStatus;
  };
};

export const HEADER_ELEMENT_DEFINITIONS: readonly HeaderElementDefinition[] = [
  {
    id: "changes",
    label: "Changes",
    icon: VersionControlIcon,
    isAvailable: (context) => context.changes.enabled,
    render: (context) => {
      const changes = context.changes;
      const toolbarPlacement = context.placement === "toolbar";
      const label = context.t("source-control.label.changes");
      const statusLabel = getGitStatusLabel(context.t, label, changes.status);
      const hasStatus = Object.values(changes.status).some((count) => count > 0);
      return (
        <button
          className={toolbarPlacement
            ? "desktop-shell-toolbar-button desktop-shell-toolbar-changes"
            : "desktop-titlebar-action desktop-titlebar-changes"}
          type="button"
          title={statusLabel}
          aria-label={statusLabel}
          aria-pressed={changes.sidebarOpen}
          data-has-git-status={hasStatus ? "true" : undefined}
          data-toolbar-action={toolbarPlacement ? "changes" : undefined}
          onClick={changes.onToggle}
        >
          {toolbarPlacement && (
            <i className="desktop-shell-toolbar-button-icon" aria-hidden="true">
              <VersionControlIcon size={19} />
            </i>
          )}
          {toolbarPlacement && (
            <span className="desktop-shell-toolbar-button-label">{label}</span>
          )}
          <GitTitlebarStatusIndicators
            status={changes.status}
            showIdleEntry={!toolbarPlacement}
          />
        </button>
      );
    },
  },
  {
    id: "history",
    label: "History",
    icon: History,
    isAvailable: (context) => context.history.enabled,
    render: (context) => {
      const history = context.history;
      const toolbarPlacement = context.placement === "toolbar";
      const label = context.t("source-control.history.title");
      return (
        <button
          className={toolbarPlacement
            ? "desktop-shell-toolbar-button desktop-shell-toolbar-history"
            : "desktop-titlebar-action desktop-titlebar-history"}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={history.sidebarOpen}
          data-toolbar-action={toolbarPlacement ? "history" : undefined}
          onClick={history.onToggle}
        >
          {toolbarPlacement ? (
            <i className="desktop-shell-toolbar-button-icon" aria-hidden="true">
              <History size={19} strokeWidth={1.8} />
            </i>
          ) : (
            <History size={15} strokeWidth={1.8} aria-hidden="true" />
          )}
          {toolbarPlacement && (
            <span className="desktop-shell-toolbar-button-label">{label}</span>
          )}
        </button>
      );
    },
  },
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
  const requestedIds = new Set(order);
  return TITLEBAR_ACTION_IDS.flatMap((id) => {
    if (!requestedIds.has(id)) return [];
    const definition = getHeaderElementDefinition(id);
    return definition ? [definition] : [];
  });
}

function GitTitlebarStatusIndicators({
  showIdleEntry = false,
  status,
}: {
  showIdleEntry?: boolean;
  status: GitTitlebarStatus;
}) {
  if (status.conflicts > 0) {
    return (
      <span className="desktop-titlebar-git-status" aria-hidden="true">
        <GitTitlebarStatusIndicator kind="conflict" count={status.conflicts}>
          <TriangleAlert size={15} strokeWidth={1.9} />
        </GitTitlebarStatusIndicator>
      </span>
    );
  }

  if (status.localChanges === 0 && status.incoming === 0 && status.outgoing === 0) {
    return showIdleEntry ? (
      <span className="desktop-titlebar-git-status" aria-hidden="true">
        <span className="desktop-titlebar-git-indicator local idle">
          <Asterisk size={15} strokeWidth={1.9} />
          <span>0</span>
        </span>
      </span>
    ) : null;
  }

  return (
    <span className="desktop-titlebar-git-status" aria-hidden="true">
      {status.incoming > 0 && (
        <GitTitlebarStatusIndicator kind="incoming" count={status.incoming}>
          <ArrowDown size={15} strokeWidth={2} />
        </GitTitlebarStatusIndicator>
      )}
      {status.outgoing > 0 && (
        <GitTitlebarStatusIndicator kind="outgoing" count={status.outgoing}>
          <ArrowUp size={15} strokeWidth={2} />
        </GitTitlebarStatusIndicator>
      )}
      {status.localChanges > 0 && (
        <GitTitlebarStatusIndicator kind="local" count={status.localChanges}>
          <Asterisk size={15} strokeWidth={1.9} />
        </GitTitlebarStatusIndicator>
      )}
    </span>
  );
}

function GitTitlebarStatusIndicator({
  children = null,
  count,
  kind,
}: {
  children?: ReactNode;
  count: number;
  kind: "conflict" | "incoming" | "local" | "outgoing";
}) {
  return (
    <span className={`desktop-titlebar-git-indicator ${kind}`}>
      {children}
      <span>{formatHeaderCount(count)}</span>
    </span>
  );
}

function getGitStatusLabel(
  t: MessageFormatter,
  label: string,
  status: GitTitlebarStatus,
) {
  const details = [
    status.conflicts > 0
      ? t("source-control.commit.conflicts", { count: status.conflicts })
      : null,
    status.localChanges > 0
      ? t("source-control.commit.files", { count: status.localChanges })
      : null,
    status.incoming > 0
      ? t("source-control.sync.pullCount", { count: status.incoming })
      : null,
    status.outgoing > 0
      ? t("source-control.sync.localWaiting", { count: status.outgoing })
      : null,
  ].filter(Boolean);
  return [label, ...details].join(", ");
}

function formatHeaderCount(count: number) {
  return count > 99 ? "99+" : String(count);
}
