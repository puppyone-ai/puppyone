import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { LocalAgentSetupPreferences } from "../../../../shared/local-agent-installation/setup-types";
import { isActivationActive } from "../../../../shared/local-agent-activation/schema.mjs";
import { AgentLauncherIcon } from "../../../components/brand/AgentLauncherIcon";
import type { LocalAgentInstallationStoreSnapshot } from "../application/LocalAgentInstallationStore";
import { useLocalAgentSetup } from "../controller/useLocalAgentSetup";
import { normalizeSetupPreferences } from "../model/localAgentSetupPreferences";
import { useLocalAgentActivation } from "../activation/LocalAgentActivationStore";
import { LocalAgentActivationDialog } from "../activation/LocalAgentActivationDialog";
import "./local-agent-setup.css";

export function LocalAgentSetupSection({ enabled, surface, eligibleInstallationIds, hiddenAgentIds, preferences: input,
  onPreferencesChange, discovery, presentation = "launcher", onReturnToLauncher }: {
  enabled: boolean; surface: "chat" | "terminal"; eligibleInstallationIds: readonly string[]; hiddenAgentIds: readonly string[];
  preferences?: LocalAgentSetupPreferences; onPreferencesChange?: (value: LocalAgentSetupPreferences) => void;
  discovery: LocalAgentInstallationStoreSnapshot; onRefresh: () => void;
  presentation?: "launcher" | "settings"; onReturnToLauncher?: () => void;
}) {
  const { t } = useLocalization();
  const preferences = normalizeSetupPreferences(input);
  const setup = useLocalAgentSetup({ enabled, surface, eligibleInstallationIds, hiddenAgentIds, preferences, discovery });
  const activation = useLocalAgentActivation();
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [actionError, setActionError] = useState(false);
  const root = useRef<HTMLElement>(null);
  const isSettings = presentation === "settings";
  const entries = setup.snapshot?.entries ?? [];
  const operations = activation.snapshot.operations.filter(entry => eligibleInstallationIds.includes(entry.setupId));
  // Receipts cannot override the installation inventory (including stale,
  // failed, cancelled, or restored operations from an earlier activation).
  const pending = operations.filter(entry => entry.status !== "ready" && !discovery.ids.some(id => id === entry.setupId));
  const rows = entries.filter(entry => !pending.some(task => task.setupId === entry.setupId) && entry.recommended
    && preferences.enabled && !hiddenAgentIds.includes(entry.installationId) && !discovery.ids.includes(entry.installationId)
    && !preferences.dismissedSetupIds.includes(entry.setupId) && !(preferences.snoozedUntil[entry.setupId] > Date.now()));
  useEffect(() => { if (!enabled) setSelected(null); }, [enabled]);
  const close = () => {
    setSelected(null);
    // DesktopDialog restores the original trigger if it survived. When a
    // completed activation has become a normal launcher row, return there.
    queueMicrotask(() => {
      if (document.activeElement === document.body || !document.activeElement?.isConnected) {
        if (onReturnToLauncher) { onReturnToLauncher(); return; }
        const target = root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
        target?.focus();
      }
    });
  };
  if (!setup.supported || !activation.supported || (!isSettings && !rows.length && !pending.length && !selected && !activation.error)) return null;
  return <section ref={root} className="local-agent-setup" data-presentation={presentation} aria-label={t("settings.agentSetup.title")}>
    {isSettings && <div className="local-agent-setup-preferences">
      <label className="local-agent-setup-toggle"><input type="checkbox" checked={preferences.enabled}
        onChange={event => onPreferencesChange?.({ ...preferences, enabled: event.target.checked })} /><span>{t("settings.agentSetup.suggestions")}</span></label>
      {preferences.dismissedSetupIds.length > 0 && <button onClick={() => onPreferencesChange?.({ ...preferences, dismissedSetupIds: [] })}>{t("settings.agentSetup.restore")}</button>}
    </div>}
    {[...new Set([...entries.map(entry => entry.setupId), ...pending.map(operation => operation.setupId)])].map(id => {
      const operation = pending.find(item => item.setupId === id);
      const entry = rows.find(item => item.setupId === id);
      if (operation) return <div className="local-agent-setup-row" key={id}>
        <AgentLauncherIcon launcherId={operation.setupId} /><span className="local-agent-setup-row-name">{operation.displayName}
          <small>{isActivationActive(operation.status) && <>{Math.max(1, operation.steps.findIndex(step => !["complete", "skipped"].includes(step.status)) + 1)}/{operation.steps.length} · </>}{t(`settings.activation.status.${operation.status}`)}</small></span>
        <span className="local-agent-setup-row-state"><button aria-label={t("settings.activation.viewAgent", { agent: operation.displayName })}
          onClick={() => setSelected({ id: operation.setupId, name: operation.displayName })}>{t("settings.activation.view")}</button>
          {isActivationActive(operation.status) && <button disabled={operation.status === "cancelling"}
            aria-label={t("settings.activation.cancelAgent", { agent: operation.displayName })}
            onClick={() => { setActionError(false); void activation.store.act(operation.operationId, "cancel").catch(() => setActionError(true)); }}>{t("settings.activation.stop")}</button>}
        </span>
      </div>;
      if (!entry) return null;
      return <div className="local-agent-setup-row" key={id}>
      <AgentLauncherIcon launcherId={entry.installationId} /><span className="local-agent-setup-row-name">{entry.displayName}</span>
      <button className="local-agent-setup-row-action" aria-label={t("settings.agentSetup.activate", { agent: entry.displayName })}
        disabled={!enabled} onClick={() => setSelected({ id: entry.setupId, name: entry.displayName })}>{t("settings.activation.activate")}</button>
      </div>;
    })}
    {(activation.error || actionError) && <p role="alert">{t("settings.activation.requestFailed")} <button onClick={() => { setActionError(false); void activation.store.refresh(); }}>{t("settings.activation.refresh")}</button></p>}
    {isSettings && <>
      <button aria-expanded={directoryOpen} onClick={() => setDirectoryOpen(value => !value)}>{t("settings.agentSetup.title")}</button>
      {directoryOpen && <div className="local-agent-setup-directory">{entries.map(entry => <button key={entry.setupId}
        onClick={() => setSelected({ id: entry.setupId, name: entry.displayName })}>{entry.displayName}</button>)}</div>}
    </>}
    {selected && enabled && <LocalAgentActivationDialog key={selected.id} setupId={selected.id} displayName={selected.name}
      surface={surface} operation={operations.find(entry => entry.setupId === selected.id)} store={activation.store} onClose={close} />}
  </section>;
}
