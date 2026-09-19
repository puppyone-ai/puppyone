import { useEffect, useRef, useState } from "react";
import { Cloud, KeyRound, Server, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { AgentModel } from "../../domain/agent-contract";
import { ModelConnectionsSettings, useModelConnections, type ModelConnectionStore } from "../../../model-connections";
import type { ModelConnectionSourceKind } from "../../../../../shared/model-connections/types";
import { AgentSessionControlPicker } from "../AgentSessionControlPicker";
import "./built-in-agent-compute.css";

type ComputeSource = "managed" | ModelConnectionSourceKind;
const CUSTOM_SOURCES = ["api", "local"] as const;

/** Cloud-first product UI; connection mechanics and credentials stay in their own domain. */
export function BuiltInAgentCompute({ models, selectedModel, disabled, onSelectModel, onCatalogChange, onReadyChange, store: suppliedStore }: {
  models: AgentModel[];
  selectedModel: string | null;
  disabled: boolean;
  onSelectModel: (model: string) => void;
  onCatalogChange: () => void;
  onReadyChange: (ready: boolean) => void;
  store?: ModelConnectionStore;
}) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections(suppliedStore);
  const [choice, setChoice] = useState<ComputeSource | null>(null);
  const [customize, setCustomize] = useState(false);
  const [configure, setConfigure] = useState(false);
  const lastRevision = useRef<number | null>(null);
  const catalogCallback = useRef(onCatalogChange);
  catalogCallback.current = onCatalogChange;
  const current = models.find((model) => model.model === selectedModel);
  const currentConnectionId = current?.connectionId ?? selectedModel?.split("/")[0];
  const currentConnection = state.snapshot?.connections.find((connection) => connection.id === currentConnectionId);
  const source = choice ?? currentConnection?.sourceKind ?? "managed";
  const connections = state.snapshot?.connections.filter((connection) => connection.sourceKind === source) ?? [];
  const visibleModels = models.filter((model) => connections.some((connection) => connection.id === model.connectionId
    && state.snapshot?.catalogs.some((catalog) => catalog.connectionId === connection.id && catalog.status === "ready" && catalog.configGeneration === connection.configGeneration)));
  const ready = source !== "managed" && visibleModels.some((model) => model.model === selectedModel);
  const Icon = source === "managed" ? Cloud : source === "api" ? KeyRound : Server;

  useEffect(() => { onReadyChange(ready); }, [onReadyChange, ready]);
  useEffect(() => {
    const revision = state.snapshot?.revision;
    if (disabled || revision == null || revision === lastRevision.current) return;
    lastRevision.current = revision;
    catalogCallback.current();
  }, [disabled, state.snapshot?.revision]);

  const chooseSource = (next: ComputeSource) => {
    setChoice(next);
    setConfigure(!state.snapshot?.connections.some((connection) => connection.sourceKind === next));
    // Browsing another source is not permission to submit using the previous route.
    if (next !== currentConnection?.sourceKind) onReadyChange(false);
  };
  const closeCustomization = () => { setCustomize(false); setChoice(null); setConfigure(false); };
  return <section className="desktop-agent-compute" aria-label={t("agent.compute.title")} data-po-scrollbar="content">
    <div className="desktop-agent-compute-summary">
      <Icon size={14} aria-hidden="true" />
      <span>{t(source === "managed" ? "agent.compute.cloud" : `agent.compute.source.${source}`)}</span>
      {source === "managed" && <small role="status">{t("agent.compute.cloudUnavailable")}</small>}
      {source !== "managed" && !customize && <AgentSessionControlPicker disabled={disabled || visibleModels.length === 0} control={{
        id: "model", value: ready ? selectedModel : null,
        options: visibleModels.map((model) => ({ value: model.model, label: model.displayName, description: model.description, keywords: `${model.id} ${model.model}` })),
      }} onSelect={(_id, model) => onSelectModel(model)} />}
    </div>
    <button type="button" className="desktop-agent-compute-customize" disabled={disabled} aria-expanded={customize}
      onClick={() => {
        if (customize) closeCustomization();
        else { setCustomize(true); chooseSource(source === "managed" ? "api" : source); }
      }}>{t("agent.compute.customize")}</button>
    {customize && source !== "managed" && <div className="desktop-agent-compute-editor">
      <header><span>{t("agent.compute.customizeTitle")}</span>
        <button type="button" disabled={disabled} aria-label={t("common.action.close")} onClick={closeCustomization}><X size={14} aria-hidden="true" /></button>
      </header>
      <div className="desktop-agent-compute-options" role="group" aria-label={t("agent.compute.title")}>
        {CUSTOM_SOURCES.map((id) => <button key={id} type="button" disabled={disabled} aria-pressed={source === id}
          onClick={() => chooseSource(id)}>{t(`agent.compute.source.${id}`)}</button>)}
      </div>
      <p>{t(`agent.compute.detail.${source}`)}</p>
      <div className="desktop-agent-compute-model">
        <span>{t("agent.compute.model")}</span>
        <AgentSessionControlPicker disabled={disabled || visibleModels.length === 0} control={{
          id: "model", value: ready ? selectedModel : null,
          options: visibleModels.map((model) => ({ value: model.model, label: model.displayName, description: model.description, keywords: `${model.id} ${model.model}` })),
        }} onSelect={(_id, model) => onSelectModel(model)} />
      </div>
      {visibleModels.length === 0 && <p role="status">{t("agent.compute.noModels")}</p>}
      <button type="button" className="desktop-agent-compute-configure" disabled={disabled} aria-expanded={configure}
        onClick={() => setConfigure(!configure)}>{t(configure ? "settings.modelConnections.closeSetup" : `agent.compute.configure.${source}`)}</button>
      {configure && <ModelConnectionsSettings key={source} embedded sourceKind={source} store={store} />}
      <button type="button" className="desktop-agent-compute-configure" disabled={disabled}
        onClick={() => { chooseSource("managed"); setCustomize(false); setConfigure(false); }}>{t("agent.compute.useCloud")}</button>
    </div>}
    {!ready && selectedModel && <p className="desktop-agent-compute-pending" role="status">
      {t("agent.compute.pending")}
      {currentConnection && <button type="button" disabled={disabled} onClick={() => { setChoice(currentConnection.sourceKind); setConfigure(false); }}>{t("agent.compute.return")}</button>}
    </p>}
    {state.error && !configure && <p role="alert">{t("settings.modelConnections.error", { code: state.error })}
      <button type="button" disabled={disabled || state.pending.read} onClick={() => void store.load()}>{t("common.action.retry")}</button>
    </p>}
  </section>;
}
