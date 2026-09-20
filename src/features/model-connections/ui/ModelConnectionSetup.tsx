import { useId, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { ModelConnection, ModelConnectionCandidate, ModelConnectionDriver, ModelConnectionSourceKind, SaveModelConnectionRequest } from "../../../../shared/model-connections/types";

const DRIVERS: { id: ModelConnectionDriver; name: string; url: string }[] = [
  { id: "ollama", name: "Ollama", url: "http://127.0.0.1:11434/v1" },
  { id: "lm-studio", name: "LM Studio", url: "http://127.0.0.1:1234/v1" },
  { id: "unsloth", name: "Unsloth", url: "http://127.0.0.1:8000/v1" },
  { id: "openai-compatible", name: "API", url: "" },
];

export function ModelConnectionSetup({ connection, candidate, sourceKind, busy, onSave, onCancel }: {
  connection?: ModelConnection;
  candidate?: ModelConnectionCandidate;
  sourceKind: ModelConnectionSourceKind;
  busy: boolean;
  onSave: (request: SaveModelConnectionRequest) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const formId = useId();
  const initialDriver = connection?.driver ?? candidate?.driver ?? (sourceKind === "api" ? "openai-compatible" : "ollama");
  const initialDefinition = DRIVERS.find((entry) => entry.id === initialDriver)!;
  const [driver, setDriver] = useState<ModelConnectionDriver>(initialDriver);
  const [name, setName] = useState(connection?.name ?? candidate?.name ?? initialDefinition.name);
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? candidate?.baseUrl ?? initialDefinition.url);
  const [auth, setAuth] = useState<"none" | "bearer">(connection?.auth ?? (["unsloth", "openai-compatible"].includes(initialDriver) ? "bearer" : "none"));
  const [apiKey, setApiKey] = useState("");
  const [manualModelId, setManualModelId] = useState(connection?.manualModelId ?? "");
  const [defaultModelId, setDefaultModelId] = useState(connection?.defaultModelId ?? "");
  const [context, setContext] = useState(String(connection?.manualContextWindow ?? 4096));
  const [serverToolsDisabled, setServerToolsDisabled] = useState(connection?.serverToolsDisabled ?? false);
  const selectDriver = (next: ModelConnectionDriver) => {
    const definition = DRIVERS.find((entry) => entry.id === next)!;
    setDriver(next);
    setName(definition.name);
    setBaseUrl(definition.url);
    setAuth(next === "unsloth" || next === "openai-compatible" ? "bearer" : "none");
    setApiKey("");
    setServerToolsDisabled(false);
  };

  return <form className="model-connection-setup" onSubmit={(event) => {
    event.preventDefault();
    const request: SaveModelConnectionRequest = {
      ...(connection ? { id: connection.id, expectedGeneration: connection.configGeneration } : {}),
      sourceKind, driver, name, baseUrl, auth,
      ...(auth === "bearer" && apiKey ? { apiKey } : {}),
      manualModelId: manualModelId || null,
      defaultModelId: defaultModelId || null,
      manualContextWindow: context ? Number(context) : null,
      serverToolsDisabled,
    };
    setApiKey("");
    void onSave(request).then((saved) => { if (saved) onCancel(); });
  }}>
    <fieldset disabled={busy}>
      <legend className="desktop-settings-visually-hidden">{t(connection ? "settings.modelConnections.edit" : "settings.modelConnections.add")}</legend>
      <div className="model-connection-fields">
        {sourceKind === "local" && <div className="model-connection-field">
          <label htmlFor={`${formId}-driver`}>{t("settings.modelConnections.service")}</label>
          <select className="desktop-settings-select" id={`${formId}-driver`} value={driver} onChange={(event) => selectDriver(event.target.value as ModelConnectionDriver)}>
            {DRIVERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </div>}
        <div className="model-connection-field">
          <label htmlFor={`${formId}-name`}>{t("settings.modelConnections.name")}</label>
          <input className="desktop-settings-text-input" id={`${formId}-name`} value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="model-connection-field">
          <label htmlFor={`${formId}-url`}>{t("settings.modelConnections.url")}</label>
          <input className="desktop-settings-text-input" id={`${formId}-url`} type="url" dir="ltr" value={baseUrl} required maxLength={2048} placeholder="https://…"
            onChange={(event) => setBaseUrl(event.target.value)} />
        </div>
        {auth === "bearer" && <div className="model-connection-field">
          <label htmlFor={`${formId}-key`}>{t(connection?.credentialConfigured ? "settings.modelConnections.replaceKey" : "settings.modelConnections.apiKey")}</label>
          <input className="desktop-settings-text-input" id={`${formId}-key`} type="password" autoComplete="off" spellCheck={false} value={apiKey} maxLength={8192} minLength={8}
            onChange={(event) => setApiKey(event.target.value)} />
          <small>{t("settings.modelConnections.keyHelp")}</small>
        </div>}
        {driver === "unsloth" && <label className="model-connection-checkbox">
          <input type="checkbox" checked={serverToolsDisabled} onChange={(event) => setServerToolsDisabled(event.target.checked)} />
          {t("settings.modelConnections.unslothTools")}
        </label>}
      </div>
      <details className="model-connection-advanced">
        <summary>{t("settings.modelConnections.advanced")}</summary>
        <div className="model-connection-fields">
          <div className="model-connection-field">
            <label htmlFor={`${formId}-auth`}>{t("settings.modelConnections.authentication")}</label>
            <select className="desktop-settings-select" id={`${formId}-auth`} value={auth}
              onChange={(event) => { setAuth(event.target.value as "none" | "bearer"); setApiKey(""); }}>
              <option value="none">{t("settings.modelConnections.noKey")}</option>
              <option value="bearer">{t("settings.modelConnections.apiKey")}</option>
            </select>
          </div>
          <div className="model-connection-field">
            <label htmlFor={`${formId}-model`}>{t("settings.modelConnections.manualModel")}</label>
            <input className="desktop-settings-text-input" id={`${formId}-model`} value={manualModelId} maxLength={300} onChange={(event) => setManualModelId(event.target.value)} />
          </div>
          <div className="model-connection-field">
            <label htmlFor={`${formId}-default`}>{t("settings.modelConnections.defaultModel")}</label>
            <input className="desktop-settings-text-input" id={`${formId}-default`} value={defaultModelId} maxLength={300} onChange={(event) => setDefaultModelId(event.target.value)} />
          </div>
          <div className="model-connection-field">
            <label htmlFor={`${formId}-context`}>{t("settings.modelConnections.context")}</label>
            <input className="desktop-settings-text-input" id={`${formId}-context`} type="number" min={1024} max={10000000} step={1} value={context}
              onChange={(event) => setContext(event.target.value)} />
            <small>{t("settings.modelConnections.contextHelp")}</small>
          </div>
        </div>
      </details>
      <div className="model-connections-actions model-connection-form-actions">
        <button type="submit" className="desktop-settings-action primary">{t(busy ? "settings.modelConnections.saving" : "settings.modelConnections.save")}</button>
        <button type="button" className="desktop-settings-row-action" onClick={() => { setApiKey(""); onCancel(); }}>{t("common.action.cancel")}</button>
      </div>
    </fieldset>
  </form>;
}
