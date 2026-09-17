import { useEffect, useRef, useState } from "react";
import { Blocks, Settings } from "lucide-react";
import { useLocalization, type MessageFormatter } from "@puppyone/localization";
import type { DesktopView } from "../../../components/DesktopCloudShell";
import {
  getDesktopGitNavSummary,
  getDesktopNavigationBadge,
  getDesktopNavigationLabel,
  type DesktopNavigationBadge,
  type DesktopGitNavSummary,
} from "./navigationModel";
import type { DesktopNavigationItem, DesktopNavigationRuntime } from "./types";

type NavigationItemsProps = DesktopNavigationRuntime & {
  buttonClassName: string;
  items: readonly DesktopNavigationItem[];
  labelIdOverrides?: Readonly<Partial<Record<DesktopView, string>>>;
  shellToolbar?: boolean;
  showLabel?: boolean;
};

export function DesktopNavigationItems({
  activeView,
  buttonClassName,
  items,
  gitIncomingCount,
  gitOperationLoading,
  gitStatus,
  labelIdOverrides,
  workspaceChangeCount,
  onNavigate,
  shellToolbar = false,
  showLabel = false,
}: NavigationItemsProps) {
  const { t } = useLocalization();
  return (
    <>
      {items.map((item) => {
        const badge = getDesktopNavigationBadge(item.view, gitIncomingCount, workspaceChangeCount);
        const itemLabel = t(labelIdOverrides?.[item.view] ?? item.labelId);
        const navLabel = getDesktopNavigationLabel(t, itemLabel, item.view, badge, workspaceChangeCount);
        const gitSummary = item.view === "git"
          ? getDesktopGitNavSummary(gitStatus, gitIncomingCount, gitOperationLoading)
          : null;
        return (
          <button
            key={item.view}
            className={[buttonClassName, activeView === item.view ? "active" : ""].filter(Boolean).join(" ")}
            type="button"
            aria-label={navLabel}
            aria-current={activeView === item.view ? "page" : undefined}
            data-navigation-item={item.view}
            onClick={() => onNavigate(item.view)}
          >
            <i
              className={`desktop-sidebar-nav-icon-wrap${shellToolbar ? " desktop-shell-toolbar-button-icon" : ""}`}
              aria-hidden="true"
            >
              <item.icon size={item.iconSize ?? 16} />
            </i>
            {showLabel && (
              <span className={`desktop-sidebar-nav-label${shellToolbar ? " desktop-shell-toolbar-button-label" : ""}`}>
                {itemLabel}
              </span>
            )}
            {!shellToolbar && <DesktopNavBadge badge={badge} />}
            {gitSummary && <DesktopGitNavBubble summary={gitSummary} />}
          </button>
        );
      })}
    </>
  );
}

export function DesktopSidebarSettingsButton({
  buttonClassName,
  onOpenSettings,
  settingsOpen = false,
  shellToolbar = false,
  showLabel = false,
}: {
  buttonClassName: string;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  shellToolbar?: boolean;
  showLabel?: boolean;
}) {
  const { t } = useLocalization();
  return (
    <button
      className={`${buttonClassName} ${settingsOpen ? "active" : ""}`}
      type="button"
      title={t("shell.navigation.settings")}
      aria-label={t("shell.navigation.settings")}
      aria-haspopup="dialog"
      aria-expanded={settingsOpen}
      data-navigation-item="settings"
      onClick={onOpenSettings}
    >
      <i
        className={`desktop-sidebar-nav-icon-wrap${shellToolbar ? " desktop-shell-toolbar-button-icon" : ""}`}
        aria-hidden="true"
      >
        <Settings size={16} />
      </i>
      {showLabel && (
        <span className={`desktop-sidebar-nav-label${shellToolbar ? " desktop-shell-toolbar-button-label" : ""}`}>
          {t("shell.navigation.settings")}
        </span>
      )}
    </button>
  );
}

export function DesktopSidebarPluginsButton({
  buttonClassName,
  onOpenPlugins,
  pluginsOpen = false,
  shellToolbar = false,
  showLabel = false,
}: {
  buttonClassName: string;
  onOpenPlugins: () => void;
  pluginsOpen?: boolean;
  shellToolbar?: boolean;
  showLabel?: boolean;
}) {
  const { t } = useLocalization();
  return (
    <button
      className={`${buttonClassName} ${pluginsOpen ? "active" : ""}`}
      type="button"
      title={t("shell.navigation.plugins")}
      aria-label={t("shell.navigation.plugins")}
      aria-haspopup="dialog"
      aria-expanded={pluginsOpen}
      data-navigation-item="plugins"
      onClick={onOpenPlugins}
    >
      <i
        className={`desktop-sidebar-nav-icon-wrap${shellToolbar ? " desktop-shell-toolbar-button-icon" : ""}`}
        aria-hidden="true"
      >
        <Blocks size={16} />
      </i>
      {showLabel && (
        <span className={`desktop-sidebar-nav-label${shellToolbar ? " desktop-shell-toolbar-button-label" : ""}`}>
          {t("shell.navigation.plugins")}
        </span>
      )}
    </button>
  );
}

function DesktopNavBadge({
  badge,
}: {
  badge: DesktopNavigationBadge;
}) {
  if (badge.kind === "none") return null;
  return (
    <em
      className={`desktop-sidebar-nav-badge ${badge.tone}`}
      aria-hidden="true"
    >
      {badge.kind === "remote" ? (badge.count > 99 ? "99+" : badge.count) : null}
    </em>
  );
}

function DesktopGitNavBubble({ summary }: { summary: DesktopGitNavSummary }) {
  const { t } = useLocalization();
  const bubble = useTransientGitNavBubble(summary, t);
  if (!bubble) return null;
  return (
    <span key={bubble.id} className="desktop-sidebar-nav-popover is-visible" role="status">
      {bubble.label}
    </span>
  );
}

const DESKTOP_GIT_NAV_BUBBLE_ENABLED = false;

function useTransientGitNavBubble(summary: DesktopGitNavSummary, t: MessageFormatter) {
  const [bubble, setBubble] = useState<{ id: number; label: string } | null>(null);
  const previousSignatureRef = useRef<string | null>(null);
  const bubbleIdRef = useRef(0);
  const initializedRef = useRef(false);
  const operationActiveRef = useRef(false);
  const signature = getDesktopGitNavSignature(summary);
  const bubbleLabel = getDesktopGitNavBubbleLabel(summary, t);

  useEffect(() => {
    if (!DESKTOP_GIT_NAV_BUBBLE_ENABLED) return undefined;
    const previousSignature = previousSignatureRef.current;
    const wasOperationActive = operationActiveRef.current;
    operationActiveRef.current = summary.operationActive;

    if (!initializedRef.current) {
      if (!summary.operationActive && summary.snapshotReady) {
        previousSignatureRef.current = signature;
        initializedRef.current = true;
      }
      return undefined;
    }
    if (summary.operationActive) return undefined;
    previousSignatureRef.current = signature;
    if (previousSignature === null) return undefined;
    if (!wasOperationActive && (!summary.active || previousSignature === signature)) return undefined;

    bubbleIdRef.current += 1;
    setBubble({ id: bubbleIdRef.current, label: bubbleLabel });
    const timeout = window.setTimeout(() => setBubble(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [bubbleLabel, signature, summary.active, summary.operationActive, summary.snapshotReady]);

  return DESKTOP_GIT_NAV_BUBBLE_ENABLED ? bubble : null;
}

function getDesktopGitNavBubbleLabel(summary: DesktopGitNavSummary, t: MessageFormatter): string {
  const labels: string[] = [];
  if (summary.conflicts > 0) labels.push(t("shell.gitBubble.conflicts"));
  if (summary.remoteIncoming > 0) labels.push(t("shell.gitBubble.incoming"));
  if (summary.committed > 0) labels.push(t("shell.gitBubble.committed"));
  if (summary.staged > 0) labels.push(t("shell.gitBubble.staged"));
  if (summary.unstaged > 0) labels.push(t("shell.gitBubble.unstaged"));
  if (labels.length === 0) return t("shell.gitBubble.changed");
  if (labels.length === 1) return labels[0];
  return t("shell.gitBubble.more", { first: labels[0] });
}

function getDesktopGitNavSignature(summary: DesktopGitNavSummary): string {
  return [
    summary.conflicts,
    summary.unstaged,
    summary.staged,
    summary.committed,
    summary.remoteIncoming,
  ].join(":");
}
