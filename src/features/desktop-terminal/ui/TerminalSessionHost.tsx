import type {
  AuxiliaryWorkbenchCreationRecipe,
  AuxiliaryWorkbenchHistoryContribution,
  AuxiliaryWorkbenchHistoryTarget,
} from "../../app-shell/auxiliary-workbench/types";
import type { LocalAgentInstallationId } from "../../../../shared/local-agent-installation/types";
import type { LocalAgentInstallationDiscoveryPhase } from "../../local-agents/model/localAgentInstallationAvailability";
import type { DesktopTerminalLauncherId } from "../model/terminalLaunchers";
import type { DesktopTerminalSession } from "../model/terminalSessions";
import type { TerminalRuntimeHandle } from "../runtime/terminalRuntime";
import {
  TerminalLauncher,
  type TerminalLauncherAgentMode,
} from "./TerminalLauncher";
import { TerminalSessionView } from "./TerminalSessionView";

type TerminalSessionHostProps = {
  agentMode: TerminalLauncherAgentMode;
  discoveryPhase: LocalAgentInstallationDiscoveryPhase;
  availableAgentIds: readonly LocalAgentInstallationId[];
  chatCreationAvailable?: boolean;
  chatPreparing?: boolean;
  chatRecipes?: readonly AuxiliaryWorkbenchCreationRecipe[];
  history?: AuxiliaryWorkbenchHistoryContribution | null;
  historyRootId?: string;
  excludedHistoryResourceIds?: readonly string[];
  focused: boolean;
  onFocus: () => void;
  presented: boolean;
  runtime: TerminalRuntimeHandle | null;
  session: DesktopTerminalSession;
  terminalEnabled?: boolean;
  workspacePath: string;
  onCreateChat?: (recipe: AuxiliaryWorkbenchCreationRecipe) => void;
  onRestoreHistoryTarget?: (target: AuxiliaryWorkbenchHistoryTarget) => Promise<boolean>;
  onLaunch: (launcherId: DesktopTerminalLauncherId) => void;
  onRefresh: () => void;
};

/** Keeps one Session component mounted while Group slots reparent its host. */
export function TerminalSessionHost({
  agentMode,
  discoveryPhase,
  availableAgentIds,
  chatCreationAvailable = true,
  chatPreparing = false,
  chatRecipes = [],
  history = null,
  historyRootId = "",
  excludedHistoryResourceIds = [],
  focused,
  onFocus,
  onCreateChat,
  onRestoreHistoryTarget,
  onLaunch,
  onRefresh,
  presented,
  runtime,
  session,
  terminalEnabled = true,
  workspacePath,
}: TerminalSessionHostProps) {
  if (session.status === "selecting") {
    return (
      <div
        className="desktop-terminal-session-host-content is-launcher"
        aria-hidden={!presented}
      >
        <div className="desktop-terminal-launcher-tab" hidden={!presented}>
          <TerminalLauncher
            agentMode={agentMode}
            discoveryPhase={discoveryPhase}
            availableAgentIds={availableAgentIds}
            chatCreationAvailable={chatCreationAvailable}
            chatPreparing={chatPreparing}
            chatRecipes={chatRecipes}
            history={history}
            historyRootId={historyRootId}
            historyRootPath={workspacePath}
            excludedHistoryResourceIds={excludedHistoryResourceIds}
            launchError={session.launchError}
            onCreateChat={onCreateChat}
            onRestoreHistoryTarget={onRestoreHistoryTarget}
            onLaunch={onLaunch}
            onRefresh={onRefresh}
            terminalEnabled={terminalEnabled}
            titleId={`desktop-terminal-launcher-title-${session.id}`}
          />
        </div>
      </div>
    );
  }

  if (!runtime) return null;
  const starting = session.status === "starting";
  return (
    <div
      className="desktop-terminal-session-host-content"
      aria-hidden={!presented}
    >
      <TerminalSessionView
        focused={focused && !starting}
        onFocus={onFocus}
        presented={presented}
        runtime={runtime}
        workspacePath={workspacePath}
      />
      {starting && (
        <div className="desktop-terminal-launcher-tab" hidden={!presented}>
          <TerminalLauncher
            agentMode={agentMode}
            discoveryPhase={discoveryPhase}
            availableAgentIds={availableAgentIds}
            chatCreationAvailable={false}
            chatRecipes={chatRecipes}
            launchError={session.launchError}
            launching
            onCreateChat={onCreateChat}
            onLaunch={onLaunch}
            onRefresh={onRefresh}
            terminalEnabled={terminalEnabled}
            titleId={`desktop-terminal-launcher-title-${session.id}`}
          />
        </div>
      )}
    </div>
  );
}
