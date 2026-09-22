import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useLocalization } from "@puppyone/localization";
import type { LocalAgentsSettings } from "../../../preferences";
import {
  AGENT_CHAT_CREATION_RECIPES,
  AGENT_CHAT_LOCAL_AGENT_IDS,
  localAgentIdForAgentChatRuntime,
} from "../../app-shell/auxiliary-workbench/agentChatCreationRecipes";
import { useLocalAgentInstallations } from "../controller/useLocalAgentInstallations";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../../desktop-terminal/model/terminalLaunchers";
import { AgentLauncherIcon } from "../../../components/brand/AgentLauncherIcon";
import { SettingsSectionHeader } from "../../settings/components";
import {
  isTerminalAgentVisible,
  setTerminalAgentVisible,
} from "../model/localAgentSelection";
import { LocalAgentHooksSettingsSection } from "./LocalAgentHooksSettingsView";
import { LocalAgentSetupSection } from "./LocalAgentSetupSection";

const terminalLauncherById = new Map<string, (typeof DESKTOP_TERMINAL_LAUNCHERS)[number]>(
  DESKTOP_TERMINAL_LAUNCHERS.map((launcher) => [launcher.id, launcher]),
);

export function LocalAgentsSettingsView({
  settings,
  onChange,
  onActivityIndicatorsEnabledChange,
}: {
  settings: LocalAgentsSettings;
  onChange: (settings: LocalAgentsSettings) => void;
  onActivityIndicatorsEnabledChange: (enabled: boolean) => void;
}) {
  const { t } = useLocalization();
  const discovery = useLocalAgentInstallations({ enabled: true });
  const {
    ids: detectedAgentIds,
    hasFailures,
    phase,
    refresh,
  } = discovery;
  const detected = useMemo(() => {
    const ids = new Set<string>(detectedAgentIds);
    return AGENT_CHAT_CREATION_RECIPES.flatMap((recipe) => {
      if (recipe.availability === "bundled") return [];
      const localAgentId = localAgentIdForAgentChatRuntime(recipe.id);
      if (!ids.has(localAgentId)) return [];
      return [{
        id: localAgentId,
        label: recipe.label,
        iconKey: recipe.iconKey,
        terminalLauncher: terminalLauncherById.get(localAgentId) ?? null,
      }];
    });
  }, [detectedAgentIds]);
  const scanning = phase === "idle" || phase === "loading";

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section desktop-local-agent-settings">
          <SettingsSectionHeader
            title={t("settings.localAgents.title")}
            detail={t("settings.localAgents.detail")}
          />
          <div className="desktop-local-agent-settings-layout">
            <section className="desktop-local-agent-settings-group">
              <header className="desktop-local-agent-group-header">
                <span className="desktop-local-agent-group-title">
                  {t("settings.localAgents.activeChat.title")}
                </span>
                <button
                  className="desktop-settings-row-action desktop-local-agent-group-action"
                  type="button"
                  aria-label={t("settings.localAgents.scan")}
                  title={t("settings.localAgents.scan")}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={12} className={scanning ? "spin" : undefined} aria-hidden="true" />
                  <span>{t("settings.localAgents.scan")}</span>
                </button>
              </header>
              <div className="desktop-settings-list desktop-local-agent-settings-table">
                {detected.map((agent) => {
                  const visible = isTerminalAgentVisible(settings, agent.id);
                  const displayName = agent.terminalLauncher
                    ? t(agent.terminalLauncher.nameMessage)
                    : agent.label;
                  return (
                    <div
                      className="desktop-settings-row desktop-settings-row-control desktop-local-agent-row"
                      key={agent.id}
                    >
                      <span className="desktop-local-agent-identity">
                        <AgentLauncherIcon launcherId={agent.id} iconKey={agent.iconKey} />
                        <span className="desktop-local-agent-row-copy">
                          <span className="desktop-local-agent-name">{displayName}</span>
                        </span>
                      </span>
                      <label
                        className="desktop-settings-switch"
                        title={t("settings.localAgents.toggle", { agent: displayName })}
                      >
                        <input
                          type="checkbox"
                          checked={visible}
                          aria-label={t("settings.localAgents.toggle", { agent: displayName })}
                          onChange={(event) => onChange(setTerminalAgentVisible(
                            settings,
                            agent.id,
                            event.target.checked,
                          ))}
                        />
                        <span aria-hidden="true" />
                      </label>
                    </div>
                  );
                })}
                {scanning && detected.length === 0 && (
                  <div className="desktop-settings-row" role="status">
                    <span>{t("settings.localAgents.scanning")}</span>
                  </div>
                )}
                {phase === "ready" && detected.length === 0 && (
                  <div className="desktop-settings-row">
                    <span>{t("settings.localAgents.empty")}</span>
                  </div>
                )}
                {(phase === "error" || (phase === "ready" && hasFailures)) && (
                  <div className="desktop-settings-row desktop-settings-row-control" role="alert">
                    <span>{t("settings.localAgents.error")}</span>
                    <button className="desktop-settings-row-action" type="button" onClick={() => void refresh()}>
                      {t("settings.localAgents.retry")}
                    </button>
                  </div>
                )}
              </div>
            </section>
            <section className="desktop-local-agent-settings-group desktop-local-agent-history-section">
              <header className="desktop-local-agent-group-header">
                <span className="desktop-local-agent-group-title">
                  {t("settings.localAgents.history.title")}
                </span>
              </header>
              <div className="desktop-settings-list desktop-local-agent-settings-table">
                <div className="desktop-settings-row desktop-settings-row-control">
                  <span>{t("settings.localAgents.history.toggle")}</span>
                  <label
                    className="desktop-settings-switch"
                    title={t("settings.localAgents.history.toggle")}
                  >
                    <input
                      type="checkbox"
                      checked={settings.chatHistoryDiscoveryEnabled}
                      aria-label={t("settings.localAgents.history.toggle")}
                      onChange={(event) => onChange({
                        ...settings,
                        chatHistoryDiscoveryEnabled: event.target.checked,
                      })}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
              </div>
            </section>
            <LocalAgentHooksSettingsSection
              detectedAgentIds={detectedAgentIds}
              agentPhase={phase}
              onRefreshAgents={refresh}
              onActivityIndicatorsEnabledChange={onActivityIndicatorsEnabledChange}
            />
            <LocalAgentSetupSection
              enabled
              surface="chat"
              eligibleInstallationIds={AGENT_CHAT_LOCAL_AGENT_IDS}
              hiddenAgentIds={settings.hiddenTerminalAgentIds}
              preferences={settings.setupSuggestions}
              onPreferencesChange={(setupSuggestions) => onChange({ ...settings, setupSuggestions })}
              discovery={discovery}
              onRefresh={refresh}
              presentation="settings"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
