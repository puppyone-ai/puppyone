import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Cloud, KeyRound, Server, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { AgentModel } from "../../domain/agent-contract";
import { ModelConnectionQuickSetup, useModelConnections, type ModelConnectionStore } from "../../../model-connections";
import type { ModelConnectionSourceKind } from "../../../../../shared/model-connections/types";
import { AgentSessionControlPicker } from "../AgentSessionControlPicker";
import "./built-in-agent-compute.css";

type ComputeSource = "managed" | ModelConnectionSourceKind;
const CUSTOM_SOURCES = ["api", "local"] as const;
type CustomizationStage = "closed" | "chooser" | "source";

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
  const [stage, setStage] = useState<CustomizationStage>("closed");
  const [showSetup, setShowSetup] = useState(false);
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
  const ready = stage !== "chooser" && source !== "managed" && visibleModels.some((model) => model.model === selectedModel);
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
    setShowSetup(false);
    setStage(next === "managed" ? "closed" : "source");
    // Browsing another source is not permission to submit using the previous route.
    if (next !== currentConnection?.sourceKind) onReadyChange(false);
  };
  const closeCustomization = () => { setStage("closed"); setChoice(null); setShowSetup(false); };
  const openCustomization = () => setStage(source === "managed" ? "chooser" : "source");
  return <section className="desktop-agent-compute" aria-label={t("agent.compute.title")} data-po-scrollbar="content">
    {stage === "closed" && <div className="desktop-agent-compute-summary">
      <Icon size={14} aria-hidden="true" />
      <span>{t(source === "managed" ? "agent.compute.cloud" : `agent.compute.source.${source}`)}</span>
      {source === "managed" && <small role="status">{t("agent.compute.cloudUnavailable")}</small>}
      {source !== "managed" && <AgentSessionControlPicker disabled={disabled || visibleModels.length === 0} control={{
        id: "model", value: ready ? selectedModel : null,
        options: visibleModels.map((model) => ({ value: model.model, label: model.displayName, description: model.description, keywords: `${model.id} ${model.model}` })),
      }} onSelect={(_id, model) => onSelectModel(model)} />}
    </div>}
    {stage === "closed" && <button type="button" className="desktop-agent-compute-customize" disabled={disabled} aria-expanded="false"
      onClick={openCustomization}>{t("agent.compute.customize")}</button>}
    {stage === "chooser" && <div className="desktop-agent-compute-editor">
      <header><span>{t("agent.compute.customizeTitle")}</span>
        <button type="button" disabled={disabled} aria-label={t("common.action.close")} onClick={closeCustomization}><X size={14} aria-hidden="true" /></button>
      </header>
      <p className="desktop-agent-compute-question">{t("agent.compute.connectQuestion")}</p>
      <div className="desktop-agent-compute-options">
        {CUSTOM_SOURCES.map((id) => {
          const OptionIcon = id === "api" ? KeyRound : Server;
          return <button key={id} type="button" disabled={disabled} onClick={() => chooseSource(id)}>
            <OptionIcon size={18} aria-hidden="true" />
            <span><strong>{t(`agent.compute.source.${id}`)}</strong><small>{t(`agent.compute.option.${id}`)}</small></span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>;
        })}
      </div>
      {currentConnection && <button type="button" className="desktop-agent-compute-secondary" disabled={disabled} onClick={() => chooseSource("managed")}>
        {t("agent.compute.useCloud")}
      </button>}
    </div>}
    {stage === "source" && source !== "managed" && <div className="desktop-agent-compute-editor">
      <header>
        <button type="button" className="desktop-agent-compute-back" disabled={disabled} onClick={() => { setStage("chooser"); setShowSetup(false); }}>
          <ChevronLeft size={14} aria-hidden="true" />{t("agent.compute.back")}
        </button>
        <span>{t(`agent.compute.source.${source}`)}</span>
        <button type="button" disabled={disabled} aria-label={t("common.action.close")} onClick={closeCustomization}><X size={14} aria-hidden="true" /></button>
      </header>
      <p>{t(`agent.compute.option.${source}`)}</p>
      {visibleModels.length > 0 && !showSetup && <div className="desktop-agent-compute-model">
        <span>{t("agent.compute.chooseModel")}</span>
        <AgentSessionControlPicker disabled={disabled} control={{
          id: "model", value: ready ? selectedModel : null,
          options: visibleModels.map((model) => ({ value: model.model, label: model.displayName, description: model.description, keywords: `${model.id} ${model.model}` })),
        }} onSelect={(_id, model) => onSelectModel(model)} />
      </div>}
      {(visibleModels.length === 0 || showSetup) && <ModelConnectionQuickSetup key={`${source}:${showSetup}`} sourceKind={source}
        createNew={showSetup} onCancel={() => setShowSetup(false)} store={store} />}
      {visibleModels.length > 0 && !showSetup && <button type="button" className="desktop-agent-compute-secondary" disabled={disabled}
        aria-expanded="false" onClick={() => setShowSetup(true)}>{t("agent.compute.addConnection")}</button>}
    </div>}
  </section>;
}
