import { useId, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { bidiIsolate } from "@puppyone/localization/core";
import type { ModelConnectionCandidate, ModelConnectionDriver, ModelConnectionSourceKind, SaveModelConnectionRequest } from "../../../../shared/model-connections/types";
import type { ModelConnectionStore } from "../application/ModelConnectionStore";
import { useModelConnections } from "../controller/useModelConnections";
import "./model-connections.css";

const LOCAL_SERVICES: { id: Exclude<ModelConnectionDriver, "openai-compatible">; name: string; url: string }[] = [
  { id: "ollama", name: "Ollama", url: "http://127.0.0.1:11434/v1" },
  { id: "lm-studio", name: "LM Studio", url: "http://127.0.0.1:1234/v1" },
  { id: "unsloth", name: "Unsloth", url: "http://127.0.0.1:8000/v1" },
];

/** Focused first-run setup. Full connection lifecycle management remains in Settings. */
export function ModelConnectionQuickSetup({ sourceKind, createNew = false, onCancel, store: suppliedStore }: {
  sourceKind: ModelConnectionSourceKind;
  createNew?: boolean;
  onCancel?: () => void;
  store?: ModelConnectionStore;
}) {
  const { t } = useLocalization();
  const { state, store } = useModelConnections(suppliedStore);
  const [manual, setManual] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const connections = state.snapshot?.connections.filter((connection) => connection.sourceKind === sourceKind) ?? [];
  const showReadiness = !createNew && connections.length > 0 && !manual;

  const save = async (request: SaveModelConnectionRequest) => {
    setSaveFailed(false);
    const saved = await store.save(request);
    setSaveFailed(!saved);
    return saved;
  };
  const connectCandidate = (candidate: ModelConnectionCandidate) => void save({
    sourceKind: "local",
    driver: candidate.driver,
    name: candidate.name,
    baseUrl: candidate.baseUrl,
    auth: "none",
    manualModelId: null,
    defaultModelId: null,
    manualContextWindow: 4096,
    serverToolsDisabled: false,
  });

  if (showReadiness) {
    return <div className="model-connection-quick-readiness">
      {connections.map((connection) => {
        const catalog = state.snapshot?.catalogs.find((entry) => entry.connectionId === connection.id);
        const busy = Boolean(state.pending[connection.id]);
        return <div className="model-connection-quick-connection" key={connection.id}>
          <span><strong>{connection.name}</strong><small dir="ltr">{connection.baseUrl}</small></span>
          {catalog?.models.map((model) => <div className="model-connection-quick-model" key={model.id}>
            <span>{model.name}</span>
            <button type="button" disabled={busy || catalog.status !== "ready" || !model.contextWindow
              || (connection.driver === "unsloth" && !connection.serverToolsDisabled)}
              onClick={() => { setSaveFailed(false); void store.verify({ id: connection.id, expectedGeneration: connection.configGeneration, modelId: model.id }).then((saved) => setSaveFailed(!saved)); }}>
              {t(busy ? "settings.modelConnections.working" : "settings.modelConnections.verify")}
            </button>
          </div>)}
          {catalog?.models.length === 0 && <button type="button" disabled={busy}
            onClick={() => { setSaveFailed(false); void store.refresh(connection.id).then((saved) => setSaveFailed(!saved)); }}>
            {t(busy ? "settings.modelConnections.working" : "settings.modelConnections.refresh")}
          </button>}
        </div>;
      })}
      <button type="button" className="model-connection-quick-link" onClick={() => setManual(true)}>{t("settings.modelConnections.addAnother")}</button>
      {saveFailed && state.error && <p role="alert">{t("settings.modelConnections.error", { code: bidiIsolate(state.error) })}</p>}
    </div>;
  }

  if (manual || createNew || sourceKind === "api") return <QuickConnectionForm sourceKind={sourceKind} busy={Boolean(state.pending.save)}
    error={saveFailed ? state.error : null} onSave={save} onCancel={createNew ? onCancel : manual ? () => setManual(false) : undefined} />;

  return <div className="model-connection-quick-actions">
    <button type="button" className="model-connection-quick-primary" disabled={state.pending.discover}
      onClick={() => { setSaveFailed(false); void store.discover(); }}>
      {t(state.pending.discover ? "settings.modelConnections.discovering" : "settings.modelConnections.discover")}
    </button>
    <button type="button" onClick={() => setManual(true)}>{t("settings.modelConnections.enterUrl")}</button>
    {state.candidates.length > 0 && <ul className="model-connection-quick-candidates">
      {state.candidates.map((candidate) => <li key={`${candidate.driver}:${candidate.baseUrl}`}>
        <span><strong>{candidate.name}</strong><small dir="ltr">{candidate.baseUrl}</small></span>
        <button type="button" disabled={state.pending.save} onClick={() => connectCandidate(candidate)}>
          {t("settings.modelConnections.connect")}
        </button>
      </li>)}
    </ul>}
    {saveFailed && state.error && <p role="alert">{t("settings.modelConnections.error", { code: bidiIsolate(state.error) })}</p>}
  </div>;
}

function QuickConnectionForm({ sourceKind, busy, error, onSave, onCancel }: {
  sourceKind: ModelConnectionSourceKind;
  busy: boolean;
  error: string | null;
  onSave: (request: SaveModelConnectionRequest) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useLocalization();
  const formId = useId();
  const [driver, setDriver] = useState<ModelConnectionDriver>(sourceKind === "api" ? "openai-compatible" : "ollama");
  const definition = LOCAL_SERVICES.find((entry) => entry.id === driver);
  const [baseUrl, setBaseUrl] = useState(sourceKind === "api" ? "" : LOCAL_SERVICES[0].url);
  const [apiKey, setApiKey] = useState("");
  const [serverToolsDisabled, setServerToolsDisabled] = useState(false);
  const selectDriver = (next: ModelConnectionDriver) => {
    setDriver(next);
    setBaseUrl(LOCAL_SERVICES.find((entry) => entry.id === next)?.url ?? "");
    setApiKey("");
    setServerToolsDisabled(false);
  };

  return <form className="model-connection-quick-form" onSubmit={(event) => {
    event.preventDefault();
    const auth = apiKey ? "bearer" : "none";
    const request: SaveModelConnectionRequest = {
      sourceKind,
      driver,
      name: sourceKind === "api" ? "API" : definition?.name ?? "Local model",
      baseUrl,
      auth,
      ...(apiKey ? { apiKey } : {}),
      manualModelId: null,
      defaultModelId: null,
      manualContextWindow: 4096,
      serverToolsDisabled,
    };
    setApiKey("");
    void onSave(request);
  }}>
    <fieldset disabled={busy}>
      {sourceKind === "local" && <>
        <label htmlFor={`${formId}-service`}>{t("settings.modelConnections.service")}</label>
        <select id={`${formId}-service`} value={driver} onChange={(event) => selectDriver(event.target.value as ModelConnectionDriver)}>
          {LOCAL_SERVICES.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </>}
      <label htmlFor={`${formId}-url`}>{t("settings.modelConnections.url")}</label>
      <input id={`${formId}-url`} type="url" dir="ltr" value={baseUrl} required maxLength={2048}
        placeholder="https://…" onChange={(event) => setBaseUrl(event.target.value)} />
      {(sourceKind === "api" || driver === "unsloth") && <>
        <label htmlFor={`${formId}-key`}>{t("settings.modelConnections.apiKey")}</label>
        <input id={`${formId}-key`} type="password" autoComplete="off" spellCheck={false} value={apiKey}
          maxLength={8192} onChange={(event) => setApiKey(event.target.value)} />
        <small>{t("settings.modelConnections.keyHelp")}</small>
      </>}
      {driver === "unsloth" && <label className="model-connection-checkbox">
        <input type="checkbox" checked={serverToolsDisabled} onChange={(event) => setServerToolsDisabled(event.target.checked)} />
        {t("settings.modelConnections.unslothTools")}
      </label>}
      {error && <p role="alert">{t("settings.modelConnections.error", { code: bidiIsolate(error) })}</p>}
      <div className="model-connection-quick-submit">
        <button type="submit" className="model-connection-quick-primary">{t(busy ? "settings.modelConnections.saving" : "settings.modelConnections.connect")}</button>
        {onCancel && <button type="button" onClick={() => { setApiKey(""); onCancel(); }}>{t("common.action.cancel")}</button>}
      </div>
    </fieldset>
  </form>;
}
