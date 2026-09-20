import { useEffect, useRef } from "react";
import { Cloud, KeyRound, Server } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { AgentModel } from "../../domain/agent-contract";
import { useModelConnections, type ModelConnectionStore } from "../../../model-connections";
import { AgentSessionControlPicker } from "../AgentSessionControlPicker";
import "./built-in-agent-compute.css";

/** Chat selects a ready route; Settings exclusively owns connection configuration. */
export function BuiltInAgentCompute({
  models,
  selectedModel,
  disabled,
  onSelectModel,
  onCatalogChange,
  onOpenModelConnections,
  onReadyChange,
  store: suppliedStore,
}: {
  models: AgentModel[];
  selectedModel: string | null;
  disabled: boolean;
  onSelectModel: (model: string) => void;
  onCatalogChange: () => void;
  onOpenModelConnections: () => void;
  onReadyChange: (ready: boolean) => void;
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
  const currentConnection = snapshot?.connections.find((connection) => connection.id === current?.connectionId);
  const source = currentConnection?.sourceKind ?? "managed";
  const managed = snapshot?.managed;
  const ready = Boolean(current && currentConnection && (source !== "managed" || managed?.available));
  const money = (micro: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(micro / 1_000_000);
  const Icon = source === "managed" ? Cloud : source === "api" ? KeyRound : Server;
  const sourceLabel = source === "managed"
    ? t("agent.compute.managed")
    : source === "api"
      ? t("agent.compute.source.api")
      : t("agent.compute.source.local");

  useEffect(() => { onReadyChange(ready); }, [onReadyChange, ready]);
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

  return <section className="desktop-agent-compute" aria-label={t("agent.compute.title")}>
    <div className="desktop-agent-compute-summary">
      <Icon size={14} aria-hidden="true" />
      <span>{sourceLabel}</span>
      {source === "managed" && <small>{managed?.signedIn
        ? t("agent.compute.balance", { amount: money(managed.availableMicroUsd ?? 0) })
        : t("agent.compute.managedBalance")}</small>}
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
    </div>
    {source === "managed" && <div className="desktop-agent-credit-actions">
      {managed?.sandbox && <small>{t("agent.compute.sandbox")}</small>}
      {!managed?.signedIn ? <button type="button" disabled={disabled || state.pending.managed}
        onClick={() => void store.managed({ action: "sign-in" })}>{t("agent.compute.signIn")}</button>
        : <>
          {(managed.packs ?? []).map((pack) => <button key={pack.id} type="button" disabled={disabled || state.pending.managed}
            onClick={() => void store.managed({ action: "checkout", packId: pack.id })}>
            {t("agent.compute.topUp", { amount: money(pack.price_cents * 10_000) })}
          </button>)}
          <button type="button" disabled={state.pending.managed} onClick={() => void store.managed({ action: "refresh" })}>
            {t("agent.compute.refreshBalance")}
          </button>
          {(managed.reservedMicroUsd ?? 0) > 0 && <small>{t("agent.compute.pendingCredit", { amount: money(managed.reservedMicroUsd ?? 0) })}</small>}
          {(managed.trialGrantedMicroUsd ?? 0) > 0 && <small>{t("agent.compute.trialGranted", { amount: money(managed.trialGrantedMicroUsd ?? 0) })}</small>}
          {managed.reason === "insufficient-credit" && <small>{t("agent.compute.insufficientCredit")}</small>}
        </>}
      {(state.error || managed?.errorCode) && <small role="alert">{t("agent.compute.paymentUnavailable")}</small>}
    </div>}
    <button type="button" className="desktop-agent-compute-customize" disabled={disabled}
      onClick={onOpenModelConnections}>{t("agent.compute.customize")}</button>
  </section>;
}
