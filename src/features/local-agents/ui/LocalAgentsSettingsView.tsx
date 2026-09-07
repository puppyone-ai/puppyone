import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useLocalization } from "@puppyone/localization";
import type { LocalAgentsSettings } from "../../../preferences";
import { AGENT_CHAT_LOCAL_AGENT_IDS } from "../../app-shell/auxiliary-workbench/agentChatCreationRecipes";
import { useTerminalAgentLocator } from "../../desktop-terminal/controller/useTerminalAgentLocator";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../../desktop-terminal/model/terminalLaunchers";
import { AgentLauncherIcon } from "../../../components/brand/AgentLauncherIcon";
import { SettingsSectionHeader } from "../../settings/components";
import {
  isTerminalAgentVisible,
  setTerminalAgentVisible,
} from "../model/localAgentSelection";
import { LocalAgentHooksSettingsSection } from "./LocalAgentHooksSettingsView";

const activeChatLocalAgentIds = new Set<string>(AGENT_CHAT_LOCAL_AGENT_IDS);

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
  const {
    ids: detectedAgentIds,
    phase,
    refresh,
  } = useTerminalAgentLocator({ enabled: true });
  const detected = useMemo(() => {
    const ids = new Set(detectedAgentIds);
    return DESKTOP_TERMINAL_LAUNCHERS.filter(
      (launcher) => (
        launcher.id !== "shell"
        && activeChatLocalAgentIds.has(launcher.id)
        && ids.has(launcher.id)
      ),
    );
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
                  disabled={scanning}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={12} className={scanning ? "spin" : undefined} aria-hidden="true" />
                  <span>{t("settings.localAgents.scan")}</span>
                </button>
              </header>
              <div className="desktop-settings-list desktop-local-agent-settings-table">
                {detected.map((launcher) => {
                  const visible = isTerminalAgentVisible(settings, launcher.id);
                  const displayName = t(launcher.nameMessage);
                  return (
                    <div
                      className="desktop-settings-row desktop-settings-row-control desktop-local-agent-row"
                      key={launcher.id}
                    >
                      <span className="desktop-local-agent-identity">
                        <AgentLauncherIcon launcherId={launcher.id} />
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
                            launcher.id,
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
                {phase === "error" && (
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
          </div>
        </div>
      </div>
    </section>
  );
}
