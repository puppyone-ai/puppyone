import { useEffect, useRef } from "react";
import { KeyRound, Server, Sparkles } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { AgentModel } from "../../domain/agent-contract";
import { useModelConnections, type ModelConnectionStore } from "../../../model-connections";
import { AgentSessionControlPicker } from "../AgentSessionControlPicker";
import "./built-in-agent-compute.css";

export type ComputeAccessRequired = "loading" | "sign-in-required" | "insufficient-credit" | "gateway-unavailable" | null;

/** Chat selects a ready route; Settings exclusively owns connection configuration. */
export function BuiltInAgentCompute({
  models,
  selectedModel,
  disabled,
  onSelectModel,
  onCatalogChange,
  onOpenAccount,
  onOpenModelConnections,
  onReadyChange,
  onAccessRequiredChange,
  accessPrompt = false,
  store: suppliedStore,
}: {
  models: AgentModel[];
  selectedModel: string | null;
  disabled: boolean;
  onSelectModel: (model: string) => void;
  onCatalogChange: () => void;
  onOpenAccount: () => void;
  onOpenModelConnections: () => void;
  onReadyChange: (ready: boolean) => void;
  onAccessRequiredChange?: (reason: ComputeAccessRequired) => void;
  accessPrompt?: boolean;
  store?: ModelConnectionStore;
}) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections(suppliedStore);
  const lastRevision = useRef<number | null>(null);
  const catalogCallback = useRef(onCatalogChange);
  catalogCallback.current = onCatalogChange;

  const snapshot = state.snapshot;
  const readyConnectionIds = new Set(snapshot?.catalogs
    .filter((catalog) => {
      const connection = snapshot.connections.find((candidate) => candidate.id === catalog.connectionId);
      return connection
        && catalog.status === "ready"
        && catalog.configGeneration === connection.configGeneration;
    })
    .map((catalog) => catalog.connectionId));
  const readyModels = models.filter((model) => model.connectionId && readyConnectionIds.has(model.connectionId));
  const current = readyModels.find((model) => model.model === selectedModel);
  const selected = models.find((model) => model.model === selectedModel);
  const currentConnection = snapshot?.connections.find((connection) => connection.id === selected?.connectionId);
  const source = currentConnection?.sourceKind ?? "managed";
  const managed = snapshot?.managed;
  const ready = Boolean(current && currentConnection && (source !== "managed" || managed?.available));
  const needsManagedAccess = source === "managed" && (!selectedModel || currentConnection?.sourceKind === "managed");
  const connecting = !managed || managed.reason === "loading"
    || Boolean(managed.signedIn && !ready && (state.pending.managed || managed.reason === "ready"));
  const accessRequired = needsManagedAccess && !ready
    ? connecting ? "loading" : managed?.reason === "ready" ? null : managed?.reason ?? "loading" : null;
  const showPrompt = accessPrompt && needsManagedAccess && !ready;
  const money = (micro: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(micro / 1_000_000);
  const Icon = source === "managed" ? Sparkles : source === "api" ? KeyRound : Server;
  const sourceLabel = source === "managed"
    ? t("agent.compute.managed")
    : source === "api"
      ? t("agent.compute.source.api")
      : t("agent.compute.source.local");
  const operationError = state.error === "AUTHENTICATION_FAILED"
    ? t("agent.compute.signInUnavailable")
    : t("agent.compute.connectionUnavailable");

  useEffect(() => { onReadyChange(ready); }, [onReadyChange, ready]);
  useEffect(() => { onAccessRequiredChange?.(accessRequired); }, [onAccessRequiredChange, accessRequired]);
  useEffect(() => {
    if (!managed?.signedIn) return;
    const refresh = () => { if (!document.hidden) void store.managed({ action: "refresh" }); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [managed?.signedIn, store]);
  useEffect(() => {
    const revision = snapshot?.revision;
    if (disabled || revision == null || revision === lastRevision.current) return;
    lastRevision.current = revision;
    catalogCallback.current();
  }, [disabled, snapshot?.revision]);

  const customize = <button type="button" className="desktop-agent-compute-customize" disabled={disabled}
    onClick={onOpenModelConnections}>{t("agent.compute.customize")}</button>;

  return <section className="desktop-agent-compute" aria-label={t("agent.compute.title")}>
    {!showPrompt && <div className="desktop-agent-compute-summary">
      <Icon size={14} aria-hidden="true" />
      <span>{sourceLabel}</span>
      {readyModels.length > 0 && <AgentSessionControlPicker disabled={disabled} control={{
        id: "model",
        value: ready ? selectedModel : null,
        options: readyModels.map((model) => ({
          value: model.model,
          label: model.displayName,
          description: model.description,
          keywords: `${model.id} ${model.model}`,
        })),
      }} onSelect={(_id, model) => onSelectModel(model)} />}
    </div>}
    {showPrompt && <div className="desktop-agent-access-prompt" role="region" aria-label={t("agent.compute.accessTitle")} aria-busy={connecting}>
      <div className="desktop-agent-access-copy">
        <strong role="status">{t(connecting ? "agent.compute.connecting" : !managed?.signedIn ? "agent.compute.accessTitle" : managed.reason === "insufficient-credit"
          ? "agent.compute.insufficientCredit" : "agent.compute.connectionUnavailable")}</strong>
        {!connecting && !managed?.signedIn ? <p>{(managed?.trialCreditMicroUsd ?? 0) > 0
          ? t("agent.compute.trialOffer", { amount: money(managed?.trialCreditMicroUsd ?? 0) })
          : t("agent.compute.walletDetail")}</p> : <p>{t("agent.compute.draftKept")}</p>}
      </div>
      {!connecting && <div className="desktop-agent-access-actions">
        {!managed?.signedIn ? <button type="button" className="desktop-agent-access-primary" disabled={disabled || state.pending.managed}
          onClick={() => void store.managed({ action: "sign-in" })}>
          {t("agent.compute.signInToStart")}
        </button> : managed.reason === "insufficient-credit" ? <button type="button" className="desktop-agent-access-primary"
          disabled={disabled} onClick={onOpenAccount}>
          <span>{t("agent.compute.manageBalance")}</span>
        </button> : <button type="button" className="desktop-agent-access-primary" disabled={state.pending.managed}
          onClick={() => void store.managed({ action: "refresh" })}>{t("common.action.retry")}</button>}
        {!managed?.signedIn && customize}
      </div>}
      {!connecting && state.error && (!managed?.signedIn || managed.reason !== "gateway-unavailable") && <small role="alert">{operationError}</small>}
    </div>}
  </section>;
}
