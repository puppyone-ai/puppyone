import { AlertCircle, History, RefreshCw } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { WorkbenchLauncherState } from "../../app-shell/auxiliary-workbench/WorkbenchLauncherState";
import { useLocalization } from "@puppyone/localization/react";
import type {
  AuxiliaryWorkbenchCreationRecipe,
  AuxiliaryWorkbenchHistoryContribution,
  AuxiliaryWorkbenchHistoryTarget,
} from "../../app-shell/auxiliary-workbench/types";
import type { LocalAgentInstallationId } from "../../../../shared/local-agent-installation/types";
import type { LocalAgentInstallationDiscoveryPhase } from "../../local-agents/model/localAgentInstallationAvailability";
import {
  DESKTOP_TERMINAL_LAUNCHERS,
  getDesktopTerminalLauncher,
  type DesktopTerminalLauncherId,
} from "../model/terminalLaunchers";
import { TerminalActivityGrid } from "./TerminalActivityGrid";
import { DiscoveryAgentRow, LauncherDiscoveryFeedback, useDelayedDiscoveryFeedback, type LauncherDiscoveryProgress } from "./LauncherDiscoveryFeedback";
import { WorkbenchLauncherIcon } from "../../app-shell/auxiliary-workbench/layout/WorkbenchLauncherIcon";
import "../../app-shell/auxiliary-workbench/auxiliary-workbench-launcher.css";

export type TerminalLauncherAgentMode = "chat" | "terminal";
type TerminalAgentLauncherDefinition = Exclude<
  (typeof DESKTOP_TERMINAL_LAUNCHERS)[number],
  { id: "shell" }
>;

type TerminalLauncherProps = {
  state?: WorkbenchLauncherState;
  presented?: boolean;
  agentMode: TerminalLauncherAgentMode;
  discoveryPhase: LocalAgentInstallationDiscoveryPhase;
  discoveryProgress?: LauncherDiscoveryProgress | null;
  discoveryHasFailures?: boolean;
  discoveryRefreshing?: boolean;
  discoveryHasInstallations?: boolean;
  availableAgentIds: readonly LocalAgentInstallationId[];
  agentSetup?: ReactNode;
  chatCreationAvailable?: boolean;
  chatPreparing?: boolean;
  chatRecipes?: readonly AuxiliaryWorkbenchCreationRecipe[];
  launchError?: string | null;
  launching?: boolean;
  terminalEnabled?: boolean;
  titleId?: string;
  history?: AuxiliaryWorkbenchHistoryContribution | null;
  historyRootId?: string;
  historyRootPath?: string;
  excludedHistoryResourceIds?: readonly string[];
  onCreateChat?: (recipe: AuxiliaryWorkbenchCreationRecipe) => void;
  onOpenHistory?: () => void;
  onRestoreHistoryTarget?: (target: AuxiliaryWorkbenchHistoryTarget) => Promise<boolean>;
  onLaunch: (launcherId: DesktopTerminalLauncherId) => void;
  onRefresh: () => void;
};

/**
 * The neutral Workbench launcher shown before an Item chooses its runtime.
 * The composition layer explicitly chooses whether Agent rows create Chat
 * Items or launch detected Terminal CLIs. Shell always resolves to a Terminal.
 */
export function TerminalLauncher({
  state: ownedState,
  presented = true,
  agentMode,
  discoveryPhase,
  availableAgentIds,
  agentSetup,
  discoveryProgress = null,
  discoveryHasFailures = false,
  discoveryRefreshing = false,
  discoveryHasInstallations = availableAgentIds.length > 0,
  chatCreationAvailable = true,
  chatPreparing = false,
  chatRecipes = [],
  launchError = null,
  launching = false,
  history = null,
  historyRootId = "",
  historyRootPath = "",
  excludedHistoryResourceIds = [],
  onLaunch,
  onCreateChat,
  onOpenHistory,
  onRestoreHistoryTarget,
  onRefresh,
  terminalEnabled = true,
  titleId = "desktop-terminal-launcher-title",
}: TerminalLauncherProps) {
  const { t } = useLocalization();
  const [localState] = useState(() => new WorkbenchLauncherState());
  const state = ownedState ?? localState;
  const { historyOpen, openingTargetId, historyRevision } = useSyncExternalStore(state.subscribe, state.getSnapshot);
  const shell = getDesktopTerminalLauncher("shell");
  const scanning = discoveryPhase === "idle" || discoveryPhase === "loading";
  const feedbackVisible = useDelayedDiscoveryFeedback(scanning && presented && !historyOpen);
  const busy = launching || chatPreparing;
  const availableAgentIdSet = new Set<LocalAgentInstallationId>(availableAgentIds);
  const terminalAgentLaunchers = DESKTOP_TERMINAL_LAUNCHERS.filter(
    (launcher): launcher is TerminalAgentLauncherDefinition => (
      launcher.id !== "shell" && availableAgentIdSet.has(launcher.id)
    ),
  );
  const discoveryFailed = discoveryPhase === "error" || discoveryHasFailures;
  const discoveryEmpty = discoveryPhase === "ready" && !discoveryFailed && !discoveryHasInstallations;
  const availabilityMessage = scanning
    ? feedbackVisible ? discoveryRefreshing ? "terminal.launcher.refreshing" : "terminal.launcher.detecting" : null
    : discoveryFailed ? "terminal.launcher.detectionIncomplete"
      : discoveryEmpty ? "terminal.launcher.noneInstalled" : "terminal.launcher.detectionComplete";
  const agentRows = agentMode === "chat"
    ? chatRecipes.map((recipe) => <DiscoveryAgentRow key={recipe.id} animate={feedbackVisible && recipe.availability !== "bundled"}>
        <ChatRecipeButton
          creationAvailable={Boolean(onCreateChat && chatCreationAvailable && !busy)}
          recipe={recipe}
          onCreate={onCreateChat}
        />
      </DiscoveryAgentRow>)
    : terminalAgentLaunchers.map((launcher) => <DiscoveryAgentRow key={launcher.id} animate={feedbackVisible}>
        <TerminalAgentButton launcher={launcher} launchAvailable={terminalEnabled && !busy} onLaunch={onLaunch} />
      </DiscoveryAgentRow>);
  const bundledIndex = agentMode === "chat" ? chatRecipes.findIndex(({ availability }) => availability === "bundled") : -1;
  if (feedbackVisible || (!scanning && (discoveryFailed || discoveryEmpty))) {
    agentRows.splice(bundledIndex < 0 ? agentRows.length : bundledIndex, 0,
      <LauncherDiscoveryFeedback key="discovery-feedback" scanning={scanning} refreshing={discoveryRefreshing}
        failed={discoveryFailed} empty={discoveryEmpty} progress={discoveryProgress} busy={busy} />);
  }

  if (historyOpen && history && onRestoreHistoryTarget) {
    return (
      <section className="desktop-terminal-launcher is-history" aria-label={history.label}>
        {history.renderBrowser({
          instanceId: `${titleId}:${historyRevision}`,
          rootId: historyRootId,
          rootPath: historyRootPath,
          excludedResourceIds: excludedHistoryResourceIds,
          openingTargetId,
          onBack: () => {
            if (!openingTargetId) state.patch({ historyOpen: false });
          },
          onOpen: (target) => {
            if (state.getSnapshot().openingTargetId) return;
            state.patch({ openingTargetId: target.id });
            void onRestoreHistoryTarget(target).then((opened) => {
              if (!opened) {
                // The main process may have tombstoned a stale locator. Remount
                // the locator-only browser so its catalog projection catches up.
                state.patch({ openingTargetId: null, historyRevision: state.getSnapshot().historyRevision + 1 });
              }
            });
          },
        })}
      </section>
    );
  }

  return (
    <section className="desktop-terminal-launcher" aria-labelledby={titleId}>
      <div className="desktop-terminal-launcher-content">
        <div
          className="desktop-terminal-launcher-group is-agents"
          data-agent-mode={agentMode}
          data-discovery-phase={discoveryPhase}
          data-detected-terminal-agent-count={terminalAgentLaunchers.length}
        >
          <header className="desktop-terminal-launcher-heading">
            <h2 id={titleId}>
              {busy && (
                <TerminalActivityGrid className="desktop-terminal-launcher-spinner" />
              )}
              <span>
                {t(launching ? "terminal.launcher.launching" : "terminal.launcher.title")}
              </span>
            </h2>
            <button
              type="button"
              className="desktop-terminal-launcher-scan"
              onClick={onRefresh}
              disabled={busy || scanning}
              aria-label={t("terminal.launcher.scanAgain")}
              title={t("terminal.launcher.scanAgain")}
            >
              <RefreshCw size={12} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </header>

          {launchError && (
            <div className="desktop-terminal-launcher-error" role="alert">
              <AlertCircle size={13} strokeWidth={1.7} aria-hidden="true" />
              <span>{launchError}</span>
            </div>
          )}

          <div className="desktop-terminal-launcher-tools" role="list" aria-busy={scanning}>
            {agentRows}
          </div>

          {agentSetup}

          {terminalEnabled && (
            <>
              <div className="desktop-terminal-launcher-divider" role="separator" />
              <button
                type="button"
                className="desktop-terminal-launcher-shell"
                data-po-interaction="navigation"
                onClick={() => onLaunch(shell.id)}
                disabled={busy}
                aria-label={`${t("terminal.title")}. ${t(shell.descriptionMessage)}`}
                title={t(shell.descriptionMessage)}
              >
                <WorkbenchLauncherIcon launcherId="shell" />
                <span>{t("terminal.title")}</span>
              </button>
            </>
          )}

          <div className="desktop-terminal-launcher-availability" role="status" aria-live="polite" aria-atomic="true">
            {availabilityMessage ? t(availabilityMessage) : ""}
          </div>
        </div>

        {history && onRestoreHistoryTarget && (
          <div className="desktop-terminal-launcher-group is-history-entry">
            <header className="desktop-terminal-launcher-heading">
              <h2>
                <span>
                  {t("agent.history.continueTitle")}
                </span>
              </h2>
            </header>
            <button
              type="button"
              className="desktop-terminal-launcher-history"
              data-po-interaction="navigation"
              onClick={onOpenHistory ?? (() => state.patch({ historyOpen: true }))}
              disabled={busy}
              aria-label={history.label}
            >
              {history.iconKey
                ? <WorkbenchLauncherIcon iconKey={history.iconKey} />
                : <History size={18} strokeWidth={1.45} aria-hidden="true" />}
              <span>{history.label}</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function TerminalAgentButton({
  launcher,
  launchAvailable,
  onLaunch,
}: Readonly<{
  launcher: TerminalAgentLauncherDefinition;
  launchAvailable: boolean;
  onLaunch: (launcherId: DesktopTerminalLauncherId) => void;
}>) {
  const { t } = useLocalization();
  const label = t(launcher.nameMessage);
  const description = t(launcher.descriptionMessage);

  return (
    <button
      type="button"
      className="desktop-terminal-launcher-tool"
      data-po-interaction="navigation"
      disabled={!launchAvailable}
      aria-label={`${t("terminal.launcher.title")}: ${label}. ${description}`}
      title={description}
      onClick={() => onLaunch(launcher.id)}
    >
      <WorkbenchLauncherIcon launcherId={launcher.id} />
      <span>{label}</span>
    </button>
  );
}

function ChatRecipeButton({
  creationAvailable,
  recipe,
  onCreate,
}: Readonly<{
  creationAvailable: boolean;
  recipe: AuxiliaryWorkbenchCreationRecipe;
  onCreate?: (recipe: AuxiliaryWorkbenchCreationRecipe) => void;
}>) {
  const { t } = useLocalization();
  const available = creationAvailable && recipe.status === "available";
  const statusLabel = recipe.status === "coming-soon"
    ? t("terminal.launcher.comingSoon")
    : recipe.status === "unavailable"
      ? t("terminal.launcher.notInstalled")
      : null;
  const title = statusLabel ? `${recipe.label} — ${statusLabel}` : recipe.label;

  return (
    <button
      type="button"
      className="desktop-terminal-launcher-tool"
      data-po-interaction="navigation"
      data-status={recipe.status}
      disabled={!available}
      aria-label={`${t("terminal.launcher.title")}: ${title}`}
      title={title}
      onClick={() => onCreate?.(recipe)}
    >
      <WorkbenchLauncherIcon iconKey={recipe.iconKey} />
      <span>{recipe.label}</span>
    </button>
  );
}
