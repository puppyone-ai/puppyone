import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { ModelConnection, ModelCatalogSnapshot } from "../../../../shared/model-connections/types";
import { SettingsValueRow } from "../../settings/components";

export function ModelConnectionDetails({ connection, catalog, busy, onEdit, onRefresh, onVerify, onRemove }: {
  connection: ModelConnection;
  catalog?: ModelCatalogSnapshot;
  busy: boolean;
  onEdit: () => void;
  onRefresh: () => Promise<boolean>;
  onVerify: (modelId: string) => Promise<boolean>;
  onRemove: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const models = catalog?.models ?? [];

  return <div className="model-connections-groups model-connection-details">
    <div className="desktop-settings-list">
      <SettingsValueRow label={t("settings.modelConnections.sourceKind")} value={t(`settings.modelConnections.source.${connection.sourceKind}`)} />
      <SettingsValueRow label={t("settings.modelConnections.apiKey")}
        value={t(connection.credentialConfigured ? "settings.modelConnections.keyConfigured" : "settings.modelConnections.noKey")}
        action={<button type="button" className="desktop-settings-row-action" disabled={busy} onClick={onEdit}>
          {t("settings.modelConnections.edit")}
        </button>} />
    </div>
    <section className="model-connections-group">
      <header className="model-connections-group-heading">
        <h3>{t("settings.modelConnections.models")} <span className="model-connections-count">{models.length}</span></h3>
        <button type="button" className="desktop-settings-row-action model-connections-text-action" disabled={busy} onClick={() => void onRefresh()}>
          <RefreshCw size={12} className={busy ? "spin" : undefined} aria-hidden="true" />{t("settings.modelConnections.refresh")}
        </button>
      </header>
      {catalog && catalog.status !== "ready" && <p className="model-connections-hint" role="status">
        {t(`settings.modelConnections.status.${catalog.status}`)}
      </p>}
      <div className="desktop-settings-list model-connections-list">
        {models.map((model) => <div className="desktop-settings-row model-connections-model" key={model.id}>
          <span className="model-connections-identity"><strong>{model.name}</strong>
            <small>{t(model.verifiedAt ? "settings.modelConnections.verified" : model.capabilities.tools === "supported"
              ? "settings.modelConnections.advertised" : "settings.modelConnections.unverified")}</small>
          </span>
          <button type="button" className="desktop-settings-row-action"
            disabled={busy || catalog?.status !== "ready" || !model.contextWindow || (connection.driver === "unsloth" && !connection.serverToolsDisabled)}
            onClick={() => void onVerify(model.id)}>
            {t(busy ? "settings.modelConnections.working" : "settings.modelConnections.verify")}
          </button>
        </div>)}
        {models.length === 0 && <div className="desktop-settings-row model-connections-empty"><span>{t("settings.modelConnections.modelsEmpty")}</span></div>}
      </div>
      {models.length > 0 && <p className="model-connections-hint">{t("settings.modelConnections.verificationHelp")}</p>}
      {catalog && !catalog.complete && catalog.status === "ready" && <p className="model-connections-hint">{t("settings.modelConnections.incomplete")}</p>}
    </section>
    <div className="model-connections-remove">
      {confirmRemove ? <div className="model-connections-delete" role="alert">
        <p>{t("settings.modelConnections.deleteWarning")}</p>
        <div className="model-connections-actions">
          <button type="button" className="desktop-settings-row-action model-connections-danger" disabled={busy} onClick={() => void onRemove()}>
            {t("settings.modelConnections.confirmDelete")}
          </button>
          <button type="button" className="desktop-settings-row-action" disabled={busy} onClick={() => setConfirmRemove(false)}>{t("common.action.cancel")}</button>
        </div>
      </div> : <button type="button" className="desktop-settings-row-action model-connections-danger" disabled={busy} onClick={() => setConfirmRemove(true)}>
        {t("settings.modelConnections.remove")}
      </button>}
    </div>
  </div>;
}
