import { useEffect, useRef, useState } from "react";
import { Cloud, KeyRound, Server } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { AgentModel } from "../../domain/agent-contract";
import { ModelConnectionsSettings, useModelConnections, type ModelConnectionStore } from "../../../model-connections";
import type { ModelConnectionSourceKind } from "../../../../../shared/model-connections/types";
import { AgentSessionControlPicker } from "../AgentSessionControlPicker";
import "./built-in-agent-compute.css";

type ComputeSource = "managed" | ModelConnectionSourceKind;
const SOURCES = [{ id: "managed", icon: Cloud }, { id: "api", icon: KeyRound }, { id: "local", icon: Server }] as const;

/** Built-in product policy: choose compute, then model. Connection mechanics stay in their own domain. */
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
  const [configure, setConfigure] = useState(false);
  const lastRevision = useRef<number | null>(null);
  const catalogCallback = useRef(onCatalogChange);
  catalogCallback.current = onCatalogChange;
  const current = models.find((model) => model.model === selectedModel);
  const currentConnectionId = current?.connectionId ?? selectedModel?.split("/")[0];
  const currentConnection = state.snapshot?.connections.find((connection) => connection.id === currentConnectionId);
  const source = choice ?? currentConnection?.sourceKind ?? null;
  const connections = state.snapshot?.connections.filter((connection) => connection.sourceKind === source) ?? [];
  const visibleModels = models.filter((model) => connections.some((connection) => connection.id === model.connectionId
    && state.snapshot?.catalogs.some((catalog) => catalog.connectionId === connection.id && catalog.status === "ready" && catalog.configGeneration === connection.configGeneration)));
  const ready = source !== "managed" && visibleModels.some((model) => model.model === selectedModel);

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
  return <section className="desktop-agent-compute" aria-label={t("agent.compute.title")} data-po-scrollbar="content">
    <h3>{t("agent.compute.title")}</h3>
    <div className="desktop-agent-compute-sources" role="group" aria-label={t("agent.compute.title")}>
      {SOURCES.map(({ id, icon: Icon }) => <button key={id} type="button" disabled={disabled}
        aria-pressed={source === id} onClick={() => chooseSource(id)}>
        <Icon size={16} aria-hidden="true" /><span>{t(`agent.compute.source.${id}`)}</span>
      </button>)}
    </div>
    {!source && <p>{t("agent.compute.choose")}</p>}
    {source === "managed" && <p role="status">{t("settings.modelConnections.managedUnavailable")}</p>}
    {source && source !== "managed" && <>
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
    </>}
    {!ready && selectedModel && <p className="desktop-agent-compute-pending" role="status">
      {t("agent.compute.pending")}
      {currentConnection && <button type="button" disabled={disabled} onClick={() => { setChoice(currentConnection.sourceKind); setConfigure(false); }}>{t("agent.compute.return")}</button>}
    </p>}
    {state.error && !configure && <p role="alert">{t("settings.modelConnections.error", { code: state.error })}
      <button type="button" disabled={disabled || state.pending.read} onClick={() => void store.load()}>{t("common.action.retry")}</button>
    </p>}
  </section>;
}
