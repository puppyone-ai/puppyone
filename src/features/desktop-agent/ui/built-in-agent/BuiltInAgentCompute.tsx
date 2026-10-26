import { useEffect, useRef } from "react";
import { KeyRound, Server, Sparkles } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { LocalIcon } from "@puppyone/shared-ui";
import type { ModelConnectionSnapshot, ModelConnectionSourceKind } from "../../../../../shared/model-connections/types";
import type { AgentModel } from "../../domain/agent-contract";
import { useModelConnections } from "../../../model-connections";
import { AgentSessionControlPicker } from "../AgentSessionControlPicker";
import "./built-in-agent-compute.css";

export type ComputeAccessRequired = "loading" | "sign-in-required" | "insufficient-credit" | "gateway-unavailable"
  | "compute-setup-required" | null;

const SOURCE_ICONS: Record<ModelConnectionSourceKind, typeof Server> = { managed: Sparkles, api: KeyRound, local: LocalIcon };
const SOURCE_LABELS: Record<ModelConnectionSourceKind, string> = {
  managed: "agent.compute.managed", api: "agent.compute.source.api", local: "agent.compute.source.local",
};

/** Why the paid route cannot serve a turn yet, in the words Chat has to show. */
function paidAccessRequired(managed: ModelConnectionSnapshot["managed"] | undefined, connecting: boolean): ComputeAccessRequired {
  if (connecting) return "loading";
  if (!managed || managed.reason === "ready") return null;
  return managed.reason;
}

/**
 * Chat selects a ready route; Settings exclusively owns connection configuration.
 *
 * `payments` arrives from the panel render entry, never from the stored
 * experiment: see `src/features/payments/README.md`. Without it PuppyOne's own
 * token is not a route at all, so no balance, trial credit or price is named
 * and the only remaining step is the user's own connection.
 */
export function BuiltInAgentCompute({
  models,
  payments,
  selectedModel,
  disabled,
  onSelectModel,
  onCatalogChange,
  onOpenAccount,
  onOpenModelConnections,
  onReadyChange,
  onAccessRequiredChange,
  accessPrompt = false,
}: {
  models: AgentModel[];
  payments: boolean;
  selectedModel: string | null;
  disabled: boolean;
  onSelectModel: (model: string) => void;
  onCatalogChange: () => void;
  onOpenAccount: () => void;
  onOpenModelConnections: () => void;
  onReadyChange: (ready: boolean) => void;
  onAccessRequiredChange?: (reason: ComputeAccessRequired) => void;
  accessPrompt?: boolean;
}) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections();
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
  const managedConnectionIds = new Set(snapshot?.connections
    .filter((connection) => connection.sourceKind === "managed").map((connection) => connection.id));
  const isManagedModel = (model: AgentModel) => Boolean(model.connectionId && managedConnectionIds.has(model.connectionId));
  const current = readyModels.find((model) => model.model === selectedModel);
  const selected = models.find((model) => model.model === selectedModel);
  const currentConnection = snapshot?.connections.find((connection) => connection.id === selected?.connectionId);
  const source = currentConnection?.sourceKind ?? (payments ? "managed" : "api");
  // Paid compute is the one route an install may not be allowed to offer. An
  // unpaid window therefore reads no wallet and keeps only the user's own
  // connections, including when a paid model is still the remembered route.
  const managed = payments ? snapshot?.managed : undefined;
  const ownModels = readyModels.filter((model) => !isManagedModel(model));
  const offeredModels = payments ? readyModels : ownModels;
  const ownComputeOnly = !payments && (source === "managed" || !currentConnection);
  const ready = Boolean(current && currentConnection && (source !== "managed" || managed?.available));
  const needsManagedAccess = payments && source === "managed"
    && (!selectedModel || currentConnection?.sourceKind === "managed");
  const connecting = state.pending.managed || !managed || managed.reason === "loading"
    || Boolean(managed.signedIn && !ready && (state.pending.managed || managed.reason === "ready"));
  const paidAccess = needsManagedAccess && !ready ? paidAccessRequired(managed, connecting) : null;
  const setupRequired = !payments && !ready && offeredModels.length === 0;
  const accessRequired: ComputeAccessRequired = paidAccess ?? (setupRequired ? "compute-setup-required" : null);
  const paidPrompt = accessPrompt && needsManagedAccess && !ready;
  const setupPrompt = accessPrompt && accessRequired === "compute-setup-required";
  const showPrompt = paidPrompt || setupPrompt;
  const money = (micro: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(micro / 1_000_000);
  const Icon = ownComputeOnly ? Server : SOURCE_ICONS[source];
  const sourceLabel = ownComputeOnly ? t("agent.compute.customize") : t(SOURCE_LABELS[source]);
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
      {offeredModels.length > 0 && (source !== "managed" || !offeredModels.some(isManagedModel)) && <AgentSessionControlPicker disabled={disabled} control={{
        id: "model",
        value: ready ? selectedModel : null,
        options: offeredModels.map((model) => ({
          value: model.model,
          label: isManagedModel(model) ? t("agent.compute.managed") : model.displayName,
          description: isManagedModel(model) ? undefined : model.description,
          keywords: isManagedModel(model) ? undefined : `${model.id} ${model.model}`,
        })),
      }} onSelect={(_id, model) => onSelectModel(model)} />}
    </div>}
    {setupPrompt && <div className="desktop-agent-access-prompt" role="region" aria-label={t("agent.compute.title")}>
      <div className="desktop-agent-access-copy">
        <strong>{t("agent.compute.title")}</strong>
        <p>{t("agent.compute.setupDetail")}</p>
      </div>
      <div className="desktop-agent-access-actions">
        <button type="button" className="desktop-agent-access-primary" disabled={disabled}
          onClick={onOpenModelConnections}>{t("agent.compute.customize")}</button>
      </div>
    </div>}
    {paidPrompt && <div className="desktop-agent-access-prompt" role="region" aria-label={t("agent.compute.accessTitle")} aria-busy={connecting}>
      <div className="desktop-agent-access-copy">
        <strong>{t(connecting || !managed?.signedIn ? "agent.compute.accessTitle" : managed.reason === "insufficient-credit"
          ? "agent.compute.insufficientCredit" : "agent.compute.connectionUnavailable")}</strong>
        {!managed?.signedIn && <p>{(managed?.trialCreditMicroUsd ?? 0) > 0
          ? t("agent.compute.trialOffer", { amount: money(managed?.trialCreditMicroUsd ?? 0) })
          : t("agent.compute.walletDetail")}</p>}
      </div>
      <div className="desktop-agent-access-actions">
        {connecting ? <button type="button" className="desktop-agent-access-primary" disabled>
          <span role="status">{t("agent.compute.connecting")}</span>
        </button> : !managed?.signedIn ? <button type="button" className="desktop-agent-access-primary" disabled={disabled || state.pending.managed}
          onClick={() => void store.managed({ action: "sign-in" })}>
          {t("agent.compute.signInToStart")}
        </button> : managed.reason === "insufficient-credit" ? <button type="button" className="desktop-agent-access-primary"
          disabled={disabled} onClick={onOpenAccount}>
          <span>{t("agent.compute.manageBalance")}</span>
        </button> : <button type="button" className="desktop-agent-access-primary" disabled={state.pending.managed}
          onClick={() => void store.managed({ action: "refresh" })}>{t("common.action.retry")}</button>}
        {!managed?.signedIn && customize}
      </div>
      {!connecting && state.error && (!managed?.signedIn || managed.reason !== "gateway-unavailable") && <small role="alert">{operationError}</small>}
    </div>}
  </section>;
}
