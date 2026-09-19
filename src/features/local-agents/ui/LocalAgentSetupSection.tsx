import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { LocalAgentSetupPreferences } from "../../../../shared/local-agent-installation/setup-types";
import type { LocalAgentInstallationStoreSnapshot } from "../application/LocalAgentInstallationStore";
import { useLocalAgentSetup } from "../controller/useLocalAgentSetup";
import { normalizeSetupPreferences } from "../model/localAgentSetupPreferences";
import "./local-agent-setup.css";

export function LocalAgentSetupSection({ enabled, surface, eligibleInstallationIds, hiddenAgentIds, preferences: input,
  onPreferencesChange, discovery, onRefresh, presentation = "launcher", onReturnToLauncher }: {
  enabled: boolean;
  surface: "chat" | "terminal";
  eligibleInstallationIds: readonly string[];
  hiddenAgentIds: readonly string[];
  preferences?: LocalAgentSetupPreferences;
  onPreferencesChange?: (value: LocalAgentSetupPreferences) => void;
  discovery: LocalAgentInstallationStoreSnapshot;
  onRefresh: () => void;
  presentation?: "launcher" | "settings";
  onReturnToLauncher?: () => void;
}) {
  const { t } = useLocalization();
  const preferences = normalizeSetupPreferences(input);
  const setup = useLocalAgentSetup({ enabled, surface, eligibleInstallationIds, hiddenAgentIds, preferences, discovery });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<"manual" | "recommendation">("manual");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [cardFocused, setCardFocused] = useState(false);
  const directoryButton = useRef<HTMLButtonElement>(null);
  const activateButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const viewHeading = useRef<HTMLHeadingElement>(null);
  const actionGeneration = useRef(0);
  const entries = setup.snapshot?.entries ?? [];
  const chosen = entries.find((entry) => entry.setupId === chosenId);
  const selected = entries.find((entry) => entry.setupId === selectedId);
  const busy = setup.busy || acting || !enabled;
  const isSettings = presentation === "settings";
  const guidanceAvailable = selected && (selectedMode === "manual" || selected.recommended);
  const recommended = chosen?.recommended && !dismissed && preferences.enabled
    && !hiddenAgentIds.includes(chosen.installationId)
    && !preferences.dismissedSetupIds.includes(chosen.setupId)
    && !(preferences.snoozedUntil[chosen.setupId] > Date.now())
    && !discovery.ids.includes(chosen.installationId);

  useEffect(() => {
    if (chosenId !== null || setup.busy || !enabled) return;
    const candidate = setup.snapshot?.entries.find((entry) => entry.recommended);
    if (candidate) setChosenId(candidate.setupId);
  }, [chosenId, setup.busy, setup.snapshot, enabled]);
  useEffect(() => {
    if (selectedId && enabled) viewHeading.current?.focus();
    return () => { actionGeneration.current += 1; };
  }, [selectedId, enabled]);
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    const target = isSettings ? directoryButton.current : activateButton.current;
    if (target) target.focus();
    else onReturnToLauncher?.();
  }, [selectedId, directoryOpen, dismissed, isSettings, onReturnToLauncher]);

  if (!setup.supported) return null;
  if (!isSettings && !selectedId && !(chosen && (recommended || cardFocused))) return null;
  function open(id: string, mode: "manual" | "recommendation" = "manual") {
    setActionStatus(null);
    setSelectedId(id);
    setSelectedMode(mode);
    setCardFocused(false);
    setDirectoryOpen(false);
  }
  function close() {
    actionGeneration.current += 1;
    setSelectedId(null);
    setDirectoryOpen(false);
    setActing(false);
    setActionStatus(null);
    restoreFocus.current = true;
  }
  function dismiss(permanent: boolean) {
    if (!chosen) return;
    setCardFocused(false);
    setDismissed(true);
    onPreferencesChange?.(permanent
      ? { ...preferences, dismissedSetupIds: [...new Set([...preferences.dismissedSetupIds, chosen.setupId])] }
      : { ...preferences, snoozedUntil: { ...preferences.snoozedUntil, [chosen.setupId]: Date.now() + 7 * 24 * 60 * 60 * 1_000 } });
    restoreFocus.current = true;
  }
  async function openGuide() {
    if (!selected || !guidanceAvailable || busy || selected.status === "found") return;
    const generation = ++actionGeneration.current;
    setActing(true);
    try {
      const status = await setup.openGuide(selected.setupId, selectedMode);
      if (generation === actionGeneration.current) {
        setActionStatus(status);
      }
    } catch { if (generation === actionGeneration.current) setActionStatus("failed"); }
    finally { if (generation === actionGeneration.current) setActing(false); }
  }

  return <section className="local-agent-setup" data-presentation={presentation} aria-label={t("settings.agentSetup.title")}>
    {isSettings && <div className="local-agent-setup-preferences">
      <label className="local-agent-setup-toggle">
        <input type="checkbox" checked={preferences.enabled} onChange={(event) => onPreferencesChange?.({ ...preferences, enabled: event.target.checked })} />
        <span>{t("settings.agentSetup.suggestions")}</span>
      </label>
      {preferences.dismissedSetupIds.length > 0 && <button type="button" onClick={() => onPreferencesChange?.({ ...preferences, dismissedSetupIds: [] })}>
        {t("settings.agentSetup.restore")}
      </button>}
    </div>}
    {!selectedId && chosen && (recommended || cardFocused) && <div className="local-agent-setup-card"
      onFocus={() => setCardFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCardFocused(false); }}>
      <p>{t(recommended ? "settings.agentSetup.recommendation" : "settings.agentSetup.updated", { agent: chosen.displayName })}</p>
      <div className="local-agent-setup-actions">
        <button ref={activateButton} className="local-agent-setup-primary" type="button" aria-disabled={busy || !recommended} onClick={() => { if (recommended && !busy) open(chosen.setupId, "recommendation"); }}>{t("settings.agentSetup.activate", { agent: chosen.displayName })}</button>
        <details className="local-agent-setup-options" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }} onKeyDown={(event) => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }}>
          <summary aria-label={t("settings.agentSetup.options")} title={t("settings.agentSetup.options")}><MoreHorizontal size={16} aria-hidden="true" /></summary>
          <div>
            <button type="button" aria-disabled={!recommended} onClick={() => { if (recommended) dismiss(false); }}>{t("settings.agentSetup.later")}</button>
            <button type="button" aria-disabled={!recommended} onClick={() => { if (recommended) dismiss(true); }}>{t("settings.agentSetup.never")}</button>
          </div>
        </details>
      </div>
    </div>}
    {isSettings && <button type="button" ref={directoryButton} aria-expanded={directoryOpen || selectedId !== null}
      onClick={() => directoryOpen || selectedId ? close() : setDirectoryOpen(true)}>{t("settings.agentSetup.title")}</button>}
    {isSettings && directoryOpen && <div className="local-agent-setup-directory">
      {entries.map((entry) => <button type="button" key={entry.setupId} disabled={busy} onClick={() => open(entry.setupId)}>{entry.displayName}</button>)}
      {entries.length === 0 && <p>{t(setup.error ? "settings.agentSetup.failed" : setup.busy ? "settings.localAgents.scanning" : "settings.agentSetup.empty")}</p>}
      {setup.error && <button type="button" onClick={onRefresh}>{t("settings.localAgents.retry")}</button>}
    </div>}
    {selectedId && <div className="local-agent-setup-detail">
      <h3 ref={viewHeading} tabIndex={-1}>{t("settings.agentSetup.activate", { agent: selected?.displayName ?? selectedId })}</h3>
      <p>{t(setup.busy ? "settings.localAgents.scanning"
        : setup.error || !selected || selected.status === "unknown" ? "settings.agentSetup.unknown"
          : selected.status === "found" ? "settings.agentSetup.detected"
            : selected.strategy === "app-bundled-runtime" ? "settings.agentSetup.bundled"
              : selected.strategy === "companion-managed-runtime" ? "settings.agentSetup.managed" : "settings.agentSetup.install",
      { agent: selected?.displayName ?? selectedId })}</p>
      {selected?.installationId === "claude" && surface === "chat" && <p>{t("settings.agentSetup.claude")}</p>}
      <p>{t("settings.agentSetup.return", { scan: t("settings.localAgents.scan") })}</p>
      <div className="local-agent-setup-actions">
        <button type="button" className="local-agent-setup-primary" aria-disabled={busy || setup.error || !guidanceAvailable || selected?.status === "found"}
          onClick={() => { if (!setup.error) void openGuide(); }}>{t("settings.agentSetup.guide")}</button>
        <button type="button" disabled={busy} onClick={() => { setActionStatus(null); onRefresh(); }}>{t("settings.localAgents.scan")}</button>
        <button type="button" onClick={close}>{t("common.action.close")}</button>
      </div>
      <p role="status">{actionStatus ? t(`settings.agentSetup.${actionStatus}`, { scan: t("settings.localAgents.scan") }) : ""}</p>
    </div>}
  </section>;
}
