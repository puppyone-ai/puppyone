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
  const { state } = useModelConnections(suppliedStore);
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
  const ready = Boolean(current && currentConnection);
  const Icon = source === "managed" ? Cloud : source === "api" ? KeyRound : Server;
  const sourceLabel = source === "managed"
    ? t("agent.compute.managed")
    : source === "api"
      ? t("agent.compute.source.api")
      : t("agent.compute.source.local");

  useEffect(() => { onReadyChange(ready); }, [onReadyChange, ready]);
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
      {source === "managed" && <small>{t("agent.compute.managedBalance")}</small>}
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
    <button type="button" className="desktop-agent-compute-customize" disabled={disabled}
      onClick={onOpenModelConnections}>{t("agent.compute.customize")}</button>
  </section>;
}
