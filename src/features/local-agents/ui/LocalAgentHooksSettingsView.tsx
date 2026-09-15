import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalization, type MessageFormatter } from "@puppyone/localization";
import type {
  AgentActivityEnrollmentSnapshot,
  AgentActivityProviderStatus,
} from "../../../../shared/agent-activity-contract/types";
import type { LocalAgentInstallationDiscoveryPhase } from "../model/localAgentInstallationAvailability";
import {
  DESKTOP_TERMINAL_LAUNCHERS,
  type DesktopTerminalLauncherId,
} from "../../desktop-terminal/model/terminalLaunchers";
import { AgentLauncherIcon } from "../../../components/brand/AgentLauncherIcon";

type EnrollmentPhase = "loading" | "ready" | "error";

export function LocalAgentHooksSettingsSection({
  detectedAgentIds,
  agentPhase,
  onRefreshAgents,
  onActivityIndicatorsEnabledChange,
}: {
  detectedAgentIds: readonly string[];
  agentPhase: LocalAgentInstallationDiscoveryPhase;
  onRefreshAgents: () => Promise<void>;
  onActivityIndicatorsEnabledChange: (enabled: boolean) => void;
}) {
  const { t } = useLocalization();
  const [providers, setProviders] = useState<readonly AgentActivityProviderStatus[]>([]);
  const [phase, setPhase] = useState<EnrollmentPhase>("loading");
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const detected = useMemo(() => new Set<string>(detectedAgentIds), [detectedAgentIds]);

  const readEnrollment = useCallback(async () => {
    const getEnrollment = window.puppyoneDesktop?.getAgentActivityEnrollment;
    if (!getEnrollment) throw new Error("AGENT_ACTIVITY_ENROLLMENT_UNAVAILABLE");
    const snapshot = await getEnrollment();
    setProviders(snapshot.providers);
    return snapshot;
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    setMutationError(null);
    try {
      await readEnrollment();
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [readEnrollment]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setPhase("loading");
    setMutationError(null);
    try {
      await Promise.all([onRefreshAgents(), readEnrollment()]);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [onRefreshAgents, readEnrollment]);

  const setEnabled = useCallback(async (providerId: string, enabled: boolean) => {
    const setEnrollment = window.puppyoneDesktop?.setAgentActivityEnrollment;
    if (!setEnrollment || pendingProviderId) return;
    setPendingProviderId(providerId);
    setMutationError(null);
    try {
      await setEnrollment({ providerId, enabled });
      const snapshot = await readEnrollment();
      onActivityIndicatorsEnabledChange(hasEnabledHook(snapshot));
    } catch {
      setMutationError(providerId);
    } finally {
      setPendingProviderId(null);
    }
  }, [onActivityIndicatorsEnabledChange, pendingProviderId, readEnrollment]);

  const loading = phase === "loading" || agentPhase === "idle" || agentPhase === "loading";
  const selectableProviders = useMemo(() => providers.filter((provider) => (
    provider.configurable
      && (
        detected.has(provider.providerId)
        || provider.enrollment === "enabled"
        || provider.enrollment === "needs-repair"
      )
  )), [detected, providers]);
  return (
    <section className="desktop-local-agent-settings-group desktop-local-agent-hooks-section">
      <header className="desktop-local-agent-group-header">
        <span className="desktop-local-agent-group-title">
          {t("settings.localAgentHooks.title")}
        </span>
        <button
          className="desktop-settings-row-action desktop-local-agent-group-action"
          type="button"
          aria-label={t("settings.localAgentHooks.refresh")}
          title={t("settings.localAgentHooks.refresh")}
          disabled={loading || pendingProviderId !== null}
          onClick={() => void refresh()}
        >
          <RefreshCw size={12} className={loading ? "spin" : undefined} aria-hidden="true" />
          <span>{t("settings.localAgentHooks.refresh")}</span>
        </button>
      </header>
      <div className="desktop-settings-list desktop-local-agent-settings-table">
        {selectableProviders.map((provider) => {
          const agentDetected = detected.has(provider.providerId);
          const installed = provider.enrollment === "enabled";
          const providerPending = pendingProviderId === provider.providerId;
          const providerError = mutationError === provider.providerId;
          const status = providerError
            ? t("settings.localAgentHooks.status.error")
            : hookStatus(provider, agentDetected, t);
          return (
            <label
              className="desktop-settings-row desktop-settings-row-control desktop-local-agent-row desktop-local-agent-hook-option"
              key={provider.providerId}
            >
              <span className="desktop-local-agent-identity">
                <AgentLauncherIcon launcherId={providerLauncherId(provider.providerId)} />
                <span className="desktop-local-agent-row-copy">
                  <span className="desktop-local-agent-name">{provider.displayName}</span>
                </span>
              </span>
              <input
                className="desktop-local-agent-hook-checkbox"
                type="checkbox"
                checked={installed}
                disabled={providerPending}
                aria-label={t("settings.localAgentHooks.toggle", { agent: provider.displayName })}
                aria-description={status}
                onChange={(event) => void setEnabled(provider.providerId, event.target.checked)}
              />
            </label>
          );
        })}
        {loading && selectableProviders.length === 0 && (
          <div className="desktop-settings-row" role="status">
            <span>{t("settings.localAgentHooks.loading")}</span>
          </div>
        )}
        {phase === "ready" && !loading && selectableProviders.length === 0 && (
          <div className="desktop-settings-row">
            <span>{t("settings.localAgentHooks.empty")}</span>
          </div>
        )}
        {phase === "error" && (
          <div className="desktop-settings-row desktop-settings-row-control" role="alert">
            <span>{t("settings.localAgentHooks.error")}</span>
            <button className="desktop-settings-row-action" type="button" onClick={() => void refresh()}>
              {t("settings.localAgentHooks.retry")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function providerLauncherId(providerId: string): DesktopTerminalLauncherId | null {
  return DESKTOP_TERMINAL_LAUNCHERS.find(
    (launcher) => launcher.id !== "shell" && launcher.id === providerId,
  )?.id ?? null;
}

function hasEnabledHook(snapshot: AgentActivityEnrollmentSnapshot) {
  return snapshot.providers.some((provider) => provider.enrollment === "enabled");
}

function hookStatus(
  provider: AgentActivityProviderStatus,
  agentDetected: boolean,
  t: MessageFormatter,
) {
  if (provider.enrollment === "enabled") return t("settings.localAgentHooks.status.installed");
  if (provider.enrollment === "needs-repair") return t("settings.localAgentHooks.status.needsRepair");
  if (!agentDetected) return t("settings.localAgentHooks.status.agentMissing");
  if (provider.enrollment === "basic-only") return t("settings.localAgentHooks.status.manual");
  return t("settings.localAgentHooks.status.notInstalled");
}
