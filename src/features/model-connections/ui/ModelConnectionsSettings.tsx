import { ChevronLeft, ChevronRight, KeyRound, Plus, RefreshCw, Server } from "lucide-react";
import { useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { bidiIsolate } from "@puppyone/localization/core";
import type { ModelConnection, ModelConnectionCandidate, ModelConnectionSourceKind } from "../../../../shared/model-connections/types";
import { SettingsSectionHeader } from "../../settings/components";
import type { ModelConnectionStore } from "../application/ModelConnectionStore";
import { useModelConnections } from "../controller/useModelConnections";
import { ModelConnectionDetails } from "./ModelConnectionDetails";
import { ModelConnectionSetup } from "./ModelConnectionSetup";
import "./model-connections-settings.css";

type SettingsPage =
  | { kind: "list" }
  | { kind: "detail"; id: string }
  | { kind: "edit"; connection: ModelConnection }
  | { kind: "add"; sourceKind: ModelConnectionSourceKind; candidate?: ModelConnectionCandidate };

const SOURCE_KINDS = ["api", "local"] as const;

export function ModelConnectionsSettings({ store: suppliedStore }: { store?: ModelConnectionStore }) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections(suppliedStore);
  const [page, setPage] = useState<SettingsPage>({ kind: "list" });
  const [actionError, setActionError] = useState<string | null>(null);
  const connections = state.snapshot?.connections ?? [];
  const selected = page.kind === "detail" ? connections.find((connection) => connection.id === page.id) : undefined;
  const editing = page.kind === "add" || page.kind === "edit";
  const busy = Boolean(state.pending.save || (selected && state.pending[selected.id]));
  const candidates = state.candidates.filter((candidate) => !connections.some((connection) =>
    connection.driver === candidate.driver && connection.baseUrl === candidate.baseUrl));

  const navigate = (next: SettingsPage) => { setActionError(null); setPage(next); };
  const run = async (operation: () => Promise<boolean>) => {
    setActionError(null);
    const succeeded = await operation();
    if (!succeeded) setActionError(store.getSnapshot().error);
    return succeeded;
  };
  const returnPage: SettingsPage = page.kind === "edit" ? { kind: "detail", id: page.connection.id } : { kind: "list" };

  return (
    <section className="desktop-utility-view desktop-settings-view model-connections">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section model-connections-section">
          {page.kind !== "list" && (
            <button type="button" className="desktop-settings-row-action model-connections-back" disabled={busy}
              onClick={() => navigate(returnPage)}>
              <ChevronLeft size={14} aria-hidden="true" />{t("settings.modelConnections.back")}
            </button>
          )}
          <SettingsSectionHeader
            title={editing ? t(page.kind === "edit" ? "settings.modelConnections.edit" : "settings.modelConnections.add")
              : selected?.name ?? t("settings.modelConnections.title")}
            detail={editing ? t(`settings.modelConnections.source.${page.kind === "edit" ? page.connection.sourceKind : page.sourceKind}`)
              : selected?.baseUrl ?? t("settings.modelConnections.detail")}
          />
          {actionError && <p className="model-connections-feedback" role="alert">
            {t("settings.modelConnections.error", { code: bidiIsolate(actionError) })}
          </p>}
          {editing ? (
            <ModelConnectionSetup key={page.kind === "edit" ? page.connection.id : page.candidate?.baseUrl ?? page.sourceKind}
              connection={page.kind === "edit" ? page.connection : undefined}
              candidate={page.kind === "add" ? page.candidate : undefined}
              sourceKind={page.kind === "edit" ? page.connection.sourceKind : page.sourceKind}
              busy={Boolean(state.pending.save)} onSave={(request) => run(() => store.save(request))}
              onCancel={() => navigate(returnPage)} />
          ) : selected ? (
            <ModelConnectionDetails connection={selected}
              catalog={state.snapshot?.catalogs.find((entry) => entry.connectionId === selected.id)}
              busy={busy} onEdit={() => navigate({ kind: "edit", connection: selected })}
              onRefresh={() => run(() => store.refresh(selected.id))}
              onVerify={(modelId) => run(() => store.verify({ id: selected.id, expectedGeneration: selected.configGeneration, modelId }))}
              onRemove={async () => {
                const removed = await run(() => store.remove({ id: selected.id, expectedGeneration: selected.configGeneration }));
                if (removed) navigate({ kind: "list" });
              }} />
          ) : (
            <div className="model-connections-groups">
              {!state.snapshot && <div className="desktop-settings-row">
                {state.pending.read ? <span role="status">{t("settings.modelConnections.loading")}</span>
                  : <button type="button" className="desktop-settings-row-action" onClick={() => void run(store.load)}>{t("common.action.retry")}</button>}
              </div>}
              {SOURCE_KINDS.map((sourceKind) => {
                const items = connections.filter((connection) => connection.sourceKind === sourceKind);
                const Icon = sourceKind === "api" ? KeyRound : Server;
                return <section className="model-connections-group" key={sourceKind} aria-label={t(`settings.modelConnections.source.${sourceKind}`)}>
                  <header className="model-connections-group-heading">
                    <h3>{t(`settings.modelConnections.source.${sourceKind}`)}</h3>
                    <div className="model-connections-actions">
                      {sourceKind === "local" && <button type="button" className="desktop-settings-row-action model-connections-text-action"
                        disabled={state.pending.discover} onClick={() => { setActionError(null); void store.discover(); }}>
                        <RefreshCw size={12} className={state.pending.discover ? "spin" : undefined} aria-hidden="true" />
                        {t(state.pending.discover ? "settings.modelConnections.discovering" : "settings.modelConnections.discover")}
                      </button>}
                      <button type="button" className="desktop-settings-row-action model-connections-text-action"
                        aria-label={t(`settings.modelConnections.add.${sourceKind}`)} onClick={() => navigate({ kind: "add", sourceKind })}>
                        <Plus size={14} aria-hidden="true" />{t("settings.modelConnections.add")}
                      </button>
                    </div>
                  </header>
                  <div className="desktop-settings-list model-connections-list">
                    {items.map((connection) => {
                      const catalog = state.snapshot?.catalogs.find((entry) => entry.connectionId === connection.id);
                      return <button type="button" className="desktop-settings-row model-connections-list-row" key={connection.id}
                        onClick={() => navigate({ kind: "detail", id: connection.id })}>
                        <Icon size={18} aria-hidden="true" />
                        <span className="model-connections-identity"><strong>{connection.name}</strong><small dir="ltr">{connection.baseUrl}</small></span>
                        <span className="model-connections-row-status">{t(`settings.modelConnections.status.${catalog?.status ?? "unread"}`)}</span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>;
                    })}
                    {items.length === 0 && state.snapshot && <div className="desktop-settings-row model-connections-empty">
                      <span>{t(`settings.modelConnections.empty.${sourceKind}`)}</span>
                    </div>}
                    {sourceKind === "local" && candidates.map((candidate) => (
                      <div className="desktop-settings-row model-connections-candidate" key={`${candidate.driver}:${candidate.baseUrl}`}>
                        <Server size={18} aria-hidden="true" />
                        <span className="model-connections-identity"><strong>{candidate.name}</strong><small dir="ltr">{candidate.baseUrl}</small></span>
                        <button type="button" className="desktop-settings-row-action" onClick={() => navigate({ kind: "add", sourceKind, candidate })}>
                          {t("settings.modelConnections.connect")}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>;
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
