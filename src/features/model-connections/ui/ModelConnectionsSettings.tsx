import { useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { bidiIsolate } from "@puppyone/localization/core";
import type { ModelConnection, ModelConnectionCandidate, ModelConnectionSourceKind } from "../../../../shared/model-connections/types";
import type { ModelConnectionStore } from "../application/ModelConnectionStore";
import { useModelConnections } from "../controller/useModelConnections";
import { ModelConnectionSetup } from "./ModelConnectionSetup";
import "./model-connections.css";

export function ModelConnectionsSettings({ embedded = false, sourceKind, store: suppliedStore }: { embedded?: boolean; sourceKind?: ModelConnectionSourceKind; store?: ModelConnectionStore }) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections(suppliedStore);
  const [editor, setEditor] = useState<{ connection?: ModelConnection; candidate?: ModelConnectionCandidate } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const connections = state.snapshot?.connections.filter((connection) => !sourceKind || connection.sourceKind === sourceKind) ?? [];
  const localDiscovery = sourceKind !== "api";
  return <section className={embedded ? "model-connections model-connections-embedded" : "desktop-utility-view desktop-settings-view model-connections"} data-po-scrollbar={embedded ? "content" : undefined}>
    <div className={embedded ? "model-connections-content" : "desktop-utility-body desktop-settings-body model-connections-content"} data-po-scrollbar={embedded ? undefined : "content"}>
      <header><h2>{t(sourceKind ? `settings.modelConnections.source.${sourceKind}` : "settings.modelConnections.title")}</h2>{!embedded && <p>{t("settings.modelConnections.detail")}</p>}</header>
      {state.error && <p role="alert">{t("settings.modelConnections.error", { code: bidiIsolate(state.error) })}</p>}
      {!state.snapshot && <button type="button" disabled={state.pending.read} onClick={() => void store.load()}>{t(state.pending.read ? "settings.modelConnections.loading" : "common.action.retry")}</button>}
      <div className="model-connection-actions">
        <button type="button" onClick={() => setEditor({})}>{t("settings.modelConnections.add")}</button>
        {localDiscovery && <button type="button" disabled={state.pending.discover} onClick={() => void store.discover()}>{t(state.pending.discover ? "settings.modelConnections.discovering" : "settings.modelConnections.discover")}</button>}
      </div>
      {localDiscovery && <p className="model-connection-hint">{t("settings.modelConnections.discoveryHelp")}</p>}
      {localDiscovery && state.candidates.length > 0 && <ul className="model-connection-candidates">
        {state.candidates.map((candidate) => <li key={`${candidate.driver}:${candidate.baseUrl}`}>
          <span>{candidate.name} <small dir="ltr">{candidate.baseUrl}</small></span>
          <button type="button" onClick={() => setEditor({ candidate })}>{t("settings.modelConnections.connect")}</button>
        </li>)}
      </ul>}
      {editor && <ModelConnectionSetup key={editor.connection?.id ?? editor.candidate?.baseUrl ?? "new"}
        {...editor} sourceKind={sourceKind ?? (editor.candidate ? "local" : undefined)} busy={Boolean(state.pending.save)} onSave={store.save} onCancel={() => setEditor(null)} />}
      {state.snapshot && connections.length === 0 && !editor && <p>{t("settings.modelConnections.empty")}</p>}
      {connections.map((connection) => {
        const catalog = state.snapshot?.catalogs.find((entry) => entry.connectionId === connection.id);
        const busy = Boolean(state.pending[connection.id]);
        return <article className="model-connection-card" key={connection.id}>
          <header><h3>{connection.name}</h3><small>{t(connection.transport === "loopback" ? "settings.modelConnections.localConnection" : "settings.modelConnections.remoteConnection")}</small></header>
          {!sourceKind && <small>{t(`settings.modelConnections.source.${connection.sourceKind}`)}</small>}
          <p dir="ltr" className="model-connection-url">{connection.baseUrl}</p>
          <p>{t(`settings.modelConnections.status.${catalog?.status ?? "unread"}`)}</p>
          {catalog?.errorCode && <p role="status">{t("settings.modelConnections.error", { code: bidiIsolate(catalog.errorCode) })}</p>}
          <div className="model-connection-actions">
            <button type="button" disabled={busy} onClick={() => void store.refresh(connection.id)}>{t("settings.modelConnections.refresh")}</button>
            <button type="button" disabled={busy || state.pending.save} onClick={() => setEditor({ connection })}>{t("settings.modelConnections.edit")}</button>
            <button type="button" disabled={busy} onClick={() => setDeleting(connection.id)}>{t("settings.modelConnections.remove")}</button>
          </div>
          {deleting === connection.id && <div role="alert" className="model-connection-delete">
            <p>{t("settings.modelConnections.deleteWarning")}</p>
            <button type="button" disabled={busy} onClick={() => void store.remove({ id: connection.id, expectedGeneration: connection.configGeneration }).then((removed) => { if (removed) setDeleting(null); })}>{t("settings.modelConnections.confirmDelete")}</button>
            <button type="button" onClick={() => setDeleting(null)}>{t("common.action.cancel")}</button>
          </div>}
          <ul className="model-connection-models">{catalog?.models.map((model) => <li key={model.id}>
            <div><strong>{model.name}</strong><small dir="ltr">{model.id}</small>
              <small>{t(model.verifiedAt ? "settings.modelConnections.verified" : model.capabilities.tools === "supported" ? "settings.modelConnections.advertised" : "settings.modelConnections.unverified")}</small>
              {model.loaded !== null && <small>{t(model.loaded ? "settings.modelConnections.loaded" : "settings.modelConnections.notLoaded")}</small>}
            </div>
            <button type="button" disabled={busy || catalog.status !== "ready" || !model.contextWindow || (connection.driver === "unsloth" && !connection.serverToolsDisabled)}
              onClick={() => void store.verify({ id: connection.id, expectedGeneration: connection.configGeneration, modelId: model.id })}>{t(busy ? "settings.modelConnections.working" : "settings.modelConnections.verify")}</button>
          </li>)}</ul>
          {catalog && !catalog.complete && catalog.status === "ready" && <p>{t("settings.modelConnections.incomplete")}</p>}
        </article>;
      })}
      <p className="model-connection-hint">{t("settings.modelConnections.verificationHelp")}</p>
      {!sourceKind && <aside className="model-connection-managed"><h3>{t("settings.modelConnections.managed")}</h3><p>{t("settings.modelConnections.managedUnavailable")}</p></aside>}
    </div>
  </section>;
}
