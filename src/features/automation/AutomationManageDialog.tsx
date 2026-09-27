import {
  ArrowRight,
  Check,
  ExternalLink,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import {
  Tooltip,
  RENDERER_ASSET_PATHS,
  resolveRendererPublicAssetUrl,
} from "@puppyone/shared-ui";
import type {
  DesktopCloudAutomationProviderSpec,
  DesktopCloudAutomationRun,
  DesktopCloudSession,
} from "../../lib/cloudApi";
import {
  deleteCloudAutomationConnection,
  listCloudAutomationConnectionRuns,
  pauseCloudAutomationConnection,
  refreshCloudAutomationConnection,
  resumeCloudAutomationConnection,
  updateCloudAutomationConnection,
  updateCloudAutomationTrigger,
} from "../../lib/cloudApi";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../app-shell/DesktopOverlayPortal";
import {
  formatProviderLabel,
  getCloudProviderIconUrl,
  getScopePathLabel,
  isConnectorActiveStatus,
  providerIcon,
} from "../cloud/utils";
import type { CloudAutomationRow } from "./automationDomain";
import {
  CloudAutomationDestinationEditor,
  CloudAutomationSourceEditor,
  CloudAutomationTriggerEditor,
} from "./AutomationControls";
import {
  automationConfigValuesFromConnection,
  automationSourceFromConfig,
  automationTriggerDraftFromConnection,
  buildAutomationConfig,
  buildAutomationTriggerUpdateRequest,
  getNextAutomationRun,
  getAutomationTargetPathValidationError,
  getAutomationTriggerValidationError,
  getCloudAutomationUserConfigFields,
  normalizeAutomationTargetPath,
  type AutomationSourceSelection,
} from "./automationRequest";
import {
  formatAutomationNextRun,
  formatAutomationStatus,
  formatAutomationTriggerPreset,
  formatAutomationTriggerSummary,
  formatAutomationValidationError,
} from "./automationPresentation";

type AutomationManageAction = "refresh" | "pause" | "resume" | "delete" | "save";
type AutomationManageError = Readonly<{ action: AutomationManageAction; detail: string }>;
type AutomationManageNotice = "run-queued" | "paused" | "resumed" | "saved";

export function CloudManageAutomationDialog({
  projectId,
  row,
  providerSpec,
  cloudSession,
  apiBaseUrl,
  onCloudSessionChange,
  onRefresh,
  onOpenAutomation,
  onClose,
}: {
  projectId: string;
  row: CloudAutomationRow;
  providerSpec: DesktopCloudAutomationProviderSpec | null;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onRefresh: () => Promise<void>;
  onOpenAutomation: () => void;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const connector = row.connector;
  const provider = useMemo(
    () => providerSpec ?? fallbackProviderSpec(connector.provider, t),
    [connector.provider, providerSpec, t],
  );
  const [busy, setBusy] = useState<AutomationManageAction | null>(null);
  const [error, setError] = useState<AutomationManageError | null>(null);
  const [notice, setNotice] = useState<AutomationManageNotice | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [configValues, setConfigValues] = useState(() => automationConfigValuesFromConnection(provider, connector.config));
  const [source, setSource] = useState<AutomationSourceSelection | null>(() => automationSourceFromConfig(connector.config));
  const [targetPath, setTargetPath] = useState(() => getConnectionTargetPath(row));
  const [trigger, setTrigger] = useState(() => automationTriggerDraftFromConnection(provider, connector.trigger));
  const [runs, setRuns] = useState<DesktopCloudAutomationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const runsRequestRef = useRef(0);
  const providerLabel = formatProviderLabel(connector.provider, t);
  const targetTitle = getScopePathLabel(row.scope) === "/"
    ? t("automation.destination.projectRoot")
    : getScopePathLabel(row.scope);
  const paused = connector.status === "paused";
  const title = t("automation.manage.title", {
    source: bidiIsolate(connector.name || providerLabel),
    target: bidiIsolate(targetTitle),
  });
  const nextRunDate = useMemo(() => getNextAutomationRun(trigger), [trigger]);
  const nextRun = formatAutomationNextRun(nextRunDate, trigger.timezone, localization);
  const scheduledTrigger = ["hourly", "daily", "weekly", "custom"].includes(trigger.preset);

  const loadRuns = useCallback(async () => {
    const requestId = runsRequestRef.current + 1;
    runsRequestRef.current = requestId;
    setRunsLoading(true);
    setRunsError(null);
    try {
      const result = await listCloudAutomationConnectionRuns(
        cloudSession,
        connector.id,
        10,
        onCloudSessionChange,
        apiBaseUrl,
      );
      if (runsRequestRef.current !== requestId) return;
      setRuns(result);
    } catch (loadError) {
      if (runsRequestRef.current !== requestId) return;
      setRunsError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (runsRequestRef.current === requestId) setRunsLoading(false);
    }
  }, [apiBaseUrl, cloudSession, connector.id, onCloudSessionChange]);

  useEffect(() => {
    void loadRuns();
    return () => {
      runsRequestRef.current += 1;
    };
  }, [loadRuns]);

  const runAction = async (action: Exclude<AutomationManageAction, "save">) => {
    if (busy) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      if (action === "refresh") {
        await refreshCloudAutomationConnection(cloudSession, connector.id, onCloudSessionChange, apiBaseUrl);
      } else if (action === "pause") {
        await pauseCloudAutomationConnection(cloudSession, connector.id, onCloudSessionChange, apiBaseUrl);
      } else if (action === "resume") {
        await resumeCloudAutomationConnection(cloudSession, connector.id, onCloudSessionChange, apiBaseUrl);
      } else {
        await deleteCloudAutomationConnection(cloudSession, connector.id, onCloudSessionChange, apiBaseUrl);
        await onRefresh();
        onClose();
        return;
      }
      await onRefresh();
      if (action === "refresh") await loadRuns();
      setNotice(action === "refresh" ? "run-queued" : action === "pause" ? "paused" : "resumed");
    } catch (actionError) {
      setError({
        action,
        detail: actionError instanceof Error ? actionError.message : String(actionError),
      });
    } finally {
      setBusy(null);
    }
  };

  const fields = getCloudAutomationUserConfigFields(provider);
  const missingRequired = fields.some((field) => field.required && !configValues[field.key]?.trim());
  const sourceMissing = provider.provider !== "url" && providerNeedsOauth(provider) && !source?.resourceId.trim();
  const targetPathError = getAutomationTargetPathValidationError(targetPath);
  const triggerError = getAutomationTriggerValidationError(trigger);
  const canSave = !missingRequired && !sourceMissing && !targetPathError && !triggerError && !busy;

  const saveChanges = async () => {
    if (!canSave) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      await updateCloudAutomationConnection(
        cloudSession,
        connector.id,
        {
          config: buildAutomationConfig({ provider, configValues, source, baseConfig: connector.config }),
          target_path: normalizeAutomationTargetPath(targetPath),
          direction: "inbound",
        },
        onCloudSessionChange,
        apiBaseUrl,
      );
      await updateCloudAutomationTrigger(
        cloudSession,
        connector.id,
        buildAutomationTriggerUpdateRequest(trigger),
        onCloudSessionChange,
        apiBaseUrl,
      );
      await onRefresh();
      setEditing(false);
      setNotice("saved");
    } catch (saveError) {
      setError({
        action: "save",
        detail: saveError instanceof Error ? saveError.message : String(saveError),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot onClose={busy ? undefined : onClose}>
        <DesktopDialogSurface width={920} className="desktop-cloud-automation-dialog" ariaLabel={title}>
        <header className="desktop-dialog-header desktop-cloud-automation-dialog-header">
          <div className="desktop-dialog-title-row">
            <div>
              <h2>{title}</h2>
              <p>{t("automation.manage.description", {
                provider: bidiIsolate(providerLabel),
                target: bidiIsolate(targetTitle),
              })}</p>
            </div>
          </div>
          <div className="desktop-cloud-automation-header-actions">
            <button className="desktop-dialog-button" type="button" disabled={busy !== null} onClick={() => runAction("refresh")}>
              <Play size={14} />
              {busy === "refresh" ? t("automation.manage.running") : t("automation.manage.runNow")}
            </button>
            <button className="desktop-dialog-button" type="button" disabled={busy !== null} onClick={() => runAction(paused ? "resume" : "pause")}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {busy === "pause" || busy === "resume"
                ? t("automation.manage.saving")
                : paused ? t("automation.manage.resume") : t("automation.manage.pause")}
            </button>
            <Tooltip content={t("automation.manage.openInCloud")}><button
              className="desktop-dialog-button desktop-cloud-automation-icon-action"
              type="button"
              aria-label={t("automation.manage.openInCloud")}
              onClick={onOpenAutomation}
                                                                  >
              <ExternalLink size={14} />
            </button></Tooltip>
            <Tooltip content={t("automation.manage.delete")}><button
              className="desktop-dialog-button desktop-cloud-automation-icon-action"
              type="button"
              disabled={busy !== null}
              aria-label={t("automation.manage.delete")}
              onClick={() => setDeleteConfirm(true)}
                                                             >
              <Trash2 size={14} />
            </button></Tooltip>
            <DesktopDialogCloseButton disabled={busy !== null} onClick={onClose} />
          </div>
        </header>
        <div
          className="desktop-dialog-body desktop-cloud-automation-dialog-body"
          data-po-scrollbar="content"
        >
          {error && (
            <div className="desktop-dialog-error" role="alert" dir="auto">
              {t(`automation.manage.error.${error.action}`, { detail: bidiIsolate(error.detail) })}
            </div>
          )}
          {notice && <div className="desktop-cloud-automation-success" role="status">{t(`automation.manage.notice.${notice}`)}</div>}
          {deleteConfirm && (
            <section className="desktop-cloud-automation-delete-confirm" role="alert" aria-label={t("automation.manage.confirmDeleteLabel")}>
              <div>
                <strong>{t("automation.manage.confirmDeleteTitle")}</strong>
                <span>{t("automation.manage.confirmDeleteDescription")}</span>
              </div>
              <div className="desktop-cloud-automation-actions">
                <button className="desktop-dialog-button" type="button" autoFocus disabled={busy !== null} onClick={() => setDeleteConfirm(false)}>
                  {t("automation.manage.keep")}
                </button>
                <button className="desktop-dialog-button danger" type="button" disabled={busy !== null} onClick={() => runAction("delete")}>
                  {busy === "delete" ? t("automation.manage.deleting") : t("automation.manage.delete")}
                </button>
              </div>
            </section>
          )}
          <div className="desktop-cloud-automation-map">
            <section className="desktop-cloud-automation-node">
              <div className="desktop-cloud-automation-node-header">
                <span className="desktop-cloud-automation-node-icon"><CloudAutomationProviderMark provider={connector.provider} /></span>
                <span>{connector.name || providerLabel}</span>
              </div>
              <div className="desktop-cloud-automation-node-body">
                <DetailValue label={t("automation.manage.provider")} value={providerLabel} />
                <DetailValue label={t("automation.manage.direction")} value={t("automation.connection.inbound")} />
              </div>
            </section>
            <div className="desktop-cloud-automation-connector" aria-label={t("automation.trigger.label")}>
              <span />
              <button type="button" aria-label={t("automation.manage.editTrigger")} onClick={() => setEditing(true)}>
                {formatAutomationTriggerPreset(trigger.preset, t)}
              </button>
              <span />
              <ArrowRight className="po-directional-icon" size={16} />
            </div>
            <section className="desktop-cloud-automation-node">
              <div className="desktop-cloud-automation-node-header">
                <span className="desktop-cloud-automation-node-icon"><img src={resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.ui.folder)} alt="" /></span>
                <span>{targetTitle}</span>
              </div>
              <div className="desktop-cloud-automation-node-body">
                <DetailValue label={t("automation.manage.cloudPath")} value={getScopePathLabel(row.scope)} mono />
                <DetailValue
                  label={t("automation.manage.status")}
                  value={formatAutomationStatus(connector.status, t)}
                  tone={isConnectorActiveStatus(connector.status) ? "ready" : "warning"}
                />
              </div>
            </section>
          </div>

          <section className="desktop-cloud-automation-schedule-overview">
            <div>
              <strong>{t("automation.manage.schedule")}</strong>
              <span>{formatAutomationTriggerSummary(trigger, t)}</span>
              {scheduledTrigger && (
                <small>{nextRun
                  ? t("automation.trigger.nextRun", { date: bidiIsolate(nextRun) })
                  : t("automation.trigger.nextRunCustom")}</small>
              )}
            </div>
            <button className="desktop-dialog-button" type="button" onClick={() => setEditing((current) => !current)}>
              {editing ? t("automation.manage.hideEditor") : t("automation.manage.editSettings")}
            </button>
          </section>

          {editing && (
            <section className="desktop-cloud-automation-manage-editor" aria-label={t("automation.manage.editSettings")}>
              <div>
                <h3>{t("automation.manage.source")}</h3>
                <CloudAutomationSourceEditor
                  provider={provider}
                  cloudSession={cloudSession}
                  apiBaseUrl={apiBaseUrl}
                  configValues={configValues}
                  source={source}
                  onCloudSessionChange={onCloudSessionChange}
                  onConfigValueChange={(key, value) => setConfigValues((current) => ({ ...current, [key]: value }))}
                  onSourceChange={setSource}
                />
              </div>
              <div>
                <h3>{t("automation.trigger.label")}</h3>
                <CloudAutomationTriggerEditor provider={provider} draft={trigger} onChange={setTrigger} showNextRun />
              </div>
              <div>
                <h3>{t("automation.manage.destination")}</h3>
                <CloudAutomationDestinationEditor
                  projectId={projectId}
                  cloudSession={cloudSession}
                  apiBaseUrl={apiBaseUrl}
                  targetPath={targetPath}
                  onCloudSessionChange={onCloudSessionChange}
                  onChange={setTargetPath}
                />
              </div>
              <div className="desktop-cloud-automation-manage-editor-actions">
                <span>{missingRequired
                  ? t("automation.create.missingRequired")
                  : sourceMissing
                    ? t("automation.manage.sourceMissing")
                    : formatAutomationValidationError(targetPathError || triggerError, t)}</span>
                <button className="desktop-dialog-button primary" type="button" disabled={!canSave} onClick={saveChanges}>
                  <Check size={14} />
                  {busy === "save" ? t("automation.manage.saving") : t("automation.manage.saveChanges")}
                </button>
              </div>
            </section>
          )}

          <RunHistory runs={runs} loading={runsLoading} error={runsError} onRetry={loadRuns} />
        </div>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}

function RunHistory({
  runs,
  loading,
  error,
  onRetry,
}: {
  runs: DesktopCloudAutomationRun[];
  loading: boolean;
  error: string | null;
  onRetry: () => Promise<void>;
}) {
  const localization = useLocalization();
  const { t } = localization;
  return (
    <section className="desktop-cloud-automation-run-history" aria-label={t("automation.runs.history")}>
      <header>
        <h3>{t("automation.runs.recent")}</h3>
        <span>{runs.length > 0 ? t("automation.runs.shown", { count: runs.length }) : null}</span>
      </header>
      {loading ? (
        <div className="desktop-cloud-automation-run-state" role="status">{t("automation.runs.loading")}</div>
      ) : error ? (
        <div className="desktop-cloud-automation-run-state error">
          <span dir="auto">{t("automation.runs.loadFailed", { detail: bidiIsolate(error) })}</span>
          <button className="desktop-cloud-automation-link-button" type="button" onClick={() => void onRetry()}>{t("common.action.retry")}</button>
        </div>
      ) : runs.length === 0 ? (
        <div className="desktop-cloud-automation-run-state">{t("automation.runs.none")}</div>
      ) : (
        <div className="desktop-cloud-automation-run-list">
          {runs.map((run) => (
            <article key={run.id}>
              <span className={`desktop-cloud-automation-run-status ${getStatusTone(run.status)}`}>{formatAutomationStatus(run.status, t)}</span>
              <div>
                <strong>{run.result_summary || t("automation.runs.defaultSummary", {
                  trigger: bidiIsolate(run.trigger_type || t("automation.runs.run")),
                })}</strong>
                <small>{formatRunTimestamp(run.started_at || run.finished_at, localization)}</small>
                {run.error && <p dir="auto">{t("automation.error.detail", { detail: bidiIsolate(run.error) })}</p>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DetailValue({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ready" | "warning";
}) {
  return (
    <div className="desktop-cloud-automation-detail-value">
      <span>{label}</span>
      <strong className={`${mono ? "mono" : ""} ${tone ?? ""}`.trim()}>{value}</strong>
    </div>
  );
}

function CloudAutomationProviderMark({
  provider,
  iconUrl,
}: {
  provider: string;
  iconUrl?: string | null;
}) {
  const Icon = providerIcon(provider);
  const resolvedIconUrl = iconUrl || getCloudProviderIconUrl(provider);
  return resolvedIconUrl ? <img src={resolvedIconUrl} alt="" /> : <Icon size={18} />;
}

function providerNeedsOauth(provider: DesktopCloudAutomationProviderSpec) {
  return provider.auth !== "none";
}

function fallbackProviderSpec(provider: string, t: MessageFormatter): DesktopCloudAutomationProviderSpec {
  return {
    provider,
    display_name: formatProviderLabel(provider, t),
    description: null,
    auth: "none",
    creation_mode: "direct",
    category: "datasource",
    icon: null,
    supported_sync_modes: ["manual", "scheduled"],
    default_sync_mode: "manual",
    config_fields: [],
  };
}

function getConnectionTargetPath(row: CloudAutomationRow) {
  const configPath = typeof row.connector.config?.target_path === "string" ? row.connector.config.target_path : "";
  return normalizeAutomationTargetPath(configPath || row.scope.path || "");
}

function formatRunTimestamp(
  value: string | null | undefined,
  localization: ReturnType<typeof useLocalization>,
) {
  if (!value) return localization.t("automation.runs.timeUnavailable");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return bidiIsolate(value);
  return localization.formatDate(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["success", "completed", "active"].includes(normalized)) return "success";
  if (["failed", "error", "blocked"].includes(normalized)) return "danger";
  if (["queued", "pending"].includes(normalized)) return "warning";
  return "accent";
}
