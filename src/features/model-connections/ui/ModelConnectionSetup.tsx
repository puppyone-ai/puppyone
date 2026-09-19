import { useId, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { ModelConnection, ModelConnectionCandidate, ModelConnectionDriver, ModelConnectionSourceKind, SaveModelConnectionRequest } from "../../../../shared/model-connections/types";

const DRIVERS: { id: ModelConnectionDriver; name: string; url: string }[] = [
  { id: "ollama", name: "Ollama", url: "http://127.0.0.1:11434/v1" },
  { id: "lm-studio", name: "LM Studio", url: "http://127.0.0.1:1234/v1" },
  { id: "unsloth", name: "Unsloth", url: "http://127.0.0.1:8000/v1" },
  { id: "openai-compatible", name: "API", url: "" },
];

export function ModelConnectionSetup({ connection, candidate, sourceKind: fixedSourceKind, busy, onSave, onCancel }: {
  connection?: ModelConnection;
  candidate?: ModelConnectionCandidate;
  sourceKind?: ModelConnectionSourceKind;
  busy: boolean;
  onSave: (request: SaveModelConnectionRequest) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const formId = useId();
  const [sourceKind, setSourceKind] = useState<ModelConnectionSourceKind>(fixedSourceKind ?? connection?.sourceKind ?? (candidate ? "local" : "api"));
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
    setDriver(next); setName(definition.name); setBaseUrl(definition.url); setAuth(next === "unsloth" || next === "openai-compatible" ? "bearer" : "none");
    setApiKey(""); setServerToolsDisabled(false);
  };
  return <form className="model-connection-setup" onSubmit={(event) => {
    event.preventDefault();
    const request: SaveModelConnectionRequest = {
      ...(connection ? { id: connection.id, expectedGeneration: connection.configGeneration } : {}),
      sourceKind, driver, name, baseUrl, auth, ...(auth === "bearer" && apiKey ? { apiKey } : {}),
      manualModelId: manualModelId || null, defaultModelId: defaultModelId || null,
      manualContextWindow: context ? Number(context) : null, serverToolsDisabled,
    };
    setApiKey("");
    void onSave(request).then((saved) => { if (saved) onCancel(); });
  }}>
    <fieldset disabled={busy}>
      <legend>{t(connection ? "settings.modelConnections.edit" : "settings.modelConnections.add")}</legend>
      {!fixedSourceKind && <>
        <label htmlFor={`${formId}-source`}>{t("settings.modelConnections.sourceKind")}</label>
        <select id={`${formId}-source`} value={sourceKind} onChange={(event) => {
          const next = event.target.value as ModelConnectionSourceKind;
          setSourceKind(next);
          if (!connection) selectDriver(next === "api" ? "openai-compatible" : "ollama");
        }}>
          <option value="api">{t("settings.modelConnections.source.api")}</option>
          <option value="local">{t("settings.modelConnections.source.local")}</option>
        </select>
      </>}
      <label htmlFor={`${formId}-driver`}>{t("settings.modelConnections.service")}</label>
      <select id={`${formId}-driver`} value={driver} onChange={(event) => selectDriver(event.target.value as ModelConnectionDriver)}>
        {DRIVERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select>
      <label htmlFor={`${formId}-name`}>{t("settings.modelConnections.name")}</label>
      <input id={`${formId}-name`} value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} />
      <label htmlFor={`${formId}-url`}>{t("settings.modelConnections.url")}</label>
      <input id={`${formId}-url`} type="url" dir="ltr" value={baseUrl} required maxLength={2048} onChange={(event) => setBaseUrl(event.target.value)} />
      <label htmlFor={`${formId}-auth`}>{t("settings.modelConnections.authentication")}</label>
      <select id={`${formId}-auth`} value={auth} onChange={(event) => { setAuth(event.target.value as "none" | "bearer"); setApiKey(""); }}>
        <option value="none">{t("settings.modelConnections.noKey")}</option>
        <option value="bearer">{t("settings.modelConnections.apiKey")}</option>
      </select>
      {auth === "bearer" && <>
        <label htmlFor={`${formId}-key`}>{t(connection?.credentialConfigured ? "settings.modelConnections.replaceKey" : "settings.modelConnections.apiKey")}</label>
        <input id={`${formId}-key`} type="password" autoComplete="off" spellCheck={false} value={apiKey} maxLength={8192} minLength={8} onChange={(event) => setApiKey(event.target.value)} />
        <small>{t("settings.modelConnections.keyHelp")}</small>
      </>}
      <label htmlFor={`${formId}-model`}>{t("settings.modelConnections.manualModel")}</label>
      <input id={`${formId}-model`} value={manualModelId} maxLength={300} onChange={(event) => setManualModelId(event.target.value)} />
      <label htmlFor={`${formId}-default`}>{t("settings.modelConnections.defaultModel")}</label>
      <input id={`${formId}-default`} value={defaultModelId} maxLength={300} onChange={(event) => setDefaultModelId(event.target.value)} />
      <label htmlFor={`${formId}-context`}>{t("settings.modelConnections.context")}</label>
      <input id={`${formId}-context`} type="number" min={1024} max={10000000} step={1} value={context} onChange={(event) => setContext(event.target.value)} />
      <small>{t("settings.modelConnections.contextHelp")}</small>
      {driver === "unsloth" && <label className="model-connection-checkbox">
        <input type="checkbox" checked={serverToolsDisabled} onChange={(event) => setServerToolsDisabled(event.target.checked)} />
        {t("settings.modelConnections.unslothTools")}
      </label>}
      <div className="model-connection-actions">
        <button type="submit">{t(busy ? "settings.modelConnections.saving" : "settings.modelConnections.save")}</button>
        <button type="button" onClick={() => { setApiKey(""); onCancel(); }}>{t("common.action.cancel")}</button>
      </div>
    </fieldset>
  </form>;
}
