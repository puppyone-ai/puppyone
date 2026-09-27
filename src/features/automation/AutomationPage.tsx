import { ArrowRight, ChevronRight, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import {
  Tooltip,
  RENDERER_ASSET_PATHS,
  resolveRendererPublicAssetUrl,
} from "@puppyone/shared-ui";
import type {
  DesktopCloudAutomationProviderSpec,
  DesktopCloudRepositoryView,
  DesktopCloudSession,
} from "../../lib/cloudApi";
import { getCloudAutomationRun } from "../../lib/cloudApi";
import {
  formatProviderLabel,
  getCloudProviderIconUrl,
  getScopePathLabel,
  providerIcon,
} from "../cloud/utils";
import type { CloudAutomationRow } from "./automationDomain";
import {
  CloudManageAutomationDialog,
  CloudNewAutomationDialog,
  type CloudAutomationCreationEcho,
} from "./AutomationDialogs";
import { AutomationTemplateCard } from "./AutomationTemplateCard";
import {
  AUTOMATION_CATEGORIES,
  buildAutomationTemplates,
  getAutomationTemplatesForCategory,
  type AutomationCatalogCategory,
  type AutomationTemplate,
} from "./automationTemplates";
import {
  formatAutomationCategory,
  formatAutomationRelativeTime,
  formatAutomationStatus,
} from "./automationPresentation";

export function CloudAutomationPage({
  projectId,
  cloudSession,
  apiBaseUrl,
  rows,
  totalCount,
  hasAnyAutomation,
  loading,
  providerSpecs,
  providerSpecsLoading,
  providerSpecsError,
  detailRow,
  onOpenRow,
  onCloseDetail,
  onCloudSessionChange,
  onRefresh,
  onOpenAutomation,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  rows: CloudAutomationRow[];
  totalCount: number;
  hasAnyAutomation: boolean;
  loading: boolean;
  providerSpecs: DesktopCloudAutomationProviderSpec[];
  providerSpecsLoading: boolean;
  providerSpecsError: string | null;
  detailRow: CloudAutomationRow | null;
  onOpenRow: (rowId: string) => void;
  onCloseDetail: () => void;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onRefresh: () => Promise<void>;
  onOpenAutomation: () => void;
}) {
  const { t } = useLocalization();
  const [newAutomationOpen, setNewAutomationOpen] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState<AutomationTemplate | null>(null);
  const [activeCategory, setActiveCategory] = useState<AutomationCatalogCategory>("popular");
  const [creationEcho, setCreationEcho] = useState<CloudAutomationCreationEcho | null>(null);
  const [highlightedConnectionId, setHighlightedConnectionId] = useState<string | null>(null);
  const templates = buildAutomationTemplates(providerSpecs);
  const visibleTemplates = getAutomationTemplatesForCategory(templates, activeCategory);
  const activeCreationRunId = creationEcho && !isTerminalRunStatus(creationEcho.status)
    ? creationEcho.runId
    : null;

  const openNewAutomation = (template: AutomationTemplate | null = null) => {
    setDraftTemplate(template);
    setNewAutomationOpen(true);
  };

  const handleCreated = (echo: CloudAutomationCreationEcho) => {
    setCreationEcho(echo);
    setHighlightedConnectionId(echo.connectionId);
  };

  const refreshCreationStatus = async () => {
    const echo = creationEcho;
    if (echo?.runId) {
      try {
        const run = await getCloudAutomationRun(cloudSession, echo.runId, onCloudSessionChange, apiBaseUrl);
        setCreationEcho((current) => current?.runId === run.id ? {
          ...current,
          status: run.status,
          summary: run.result_summary || null,
          error: run.error || null,
        } : current);
      } catch {
        // Row refresh below still gives the user the latest connection state.
      }
    }
    await onRefresh().catch(() => undefined);
  };

  useEffect(() => {
    if (!highlightedConnectionId) return undefined;
    const timer = window.setTimeout(() => setHighlightedConnectionId(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [highlightedConnectionId]);

  useEffect(() => {
    const runId = activeCreationRunId;
    if (!runId) return undefined;
    let cancelled = false;
    let attempts = 0;
    let timer: number | null = null;
    const poll = async () => {
      attempts += 1;
      try {
        const run = await getCloudAutomationRun(cloudSession, runId, onCloudSessionChange, apiBaseUrl);
        if (cancelled) return;
        setCreationEcho((current) => current?.runId === runId ? {
          ...current,
          status: run.status,
          summary: run.result_summary || (isTerminalRunStatus(run.status) ? null : current.summary),
          error: run.error || null,
        } : current);
        if (isTerminalRunStatus(run.status)) {
          await onRefresh().catch(() => undefined);
          return;
        }
      } catch {
        // The page keeps the queued response visible and offers manual refresh.
      }
      if (!cancelled && attempts < 5) timer = window.setTimeout(poll, 2_000);
    };
    timer = window.setTimeout(poll, 1_500);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeCreationRunId, apiBaseUrl, cloudSession, onCloudSessionChange, onRefresh]);

  const catalog = (
    <>
      {hasAnyAutomation && (
        <header className="desktop-cloud-automation-add-more-header">
          <h2>{t("automation.page.addMoreSources")}</h2>
          <p>{t("automation.page.addMoreDescription")}</p>
        </header>
      )}
      <nav
        className="desktop-cloud-automation-category-tabs"
        data-po-scrollbar="hidden"
        aria-label={t("automation.page.categories")}
        role="tablist"
      >
        {AUTOMATION_CATEGORIES.map((category) => {
          const active = activeCategory === category.id;
          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "active" : undefined}
              onClick={() => setActiveCategory(category.id)}
            >
              {formatAutomationCategory(category.id, t)}
            </button>
          );
        })}
      </nav>
      <section
        className="desktop-cloud-automation-template-grid"
        aria-label={t("automation.page.categoryTemplates", { category: formatAutomationCategory(activeCategory, t) })}
      >
        {providerSpecsLoading ? Array.from({ length: 4 }, (_, index) => (
          <div className="desktop-cloud-automation-template-card skeleton" aria-hidden="true" key={index}>
            <span />
            <span />
            <span />
          </div>
        )) : visibleTemplates.map((template) => (
          <AutomationTemplateCard key={template.id} template={template} onAdd={() => openNewAutomation(template)} />
        ))}
      </section>
      {!providerSpecsLoading && providerSpecsError && (
        <div className="desktop-cloud-automation-catalog-error" role="alert">
          {t("automation.page.templateLoadFailed", { detail: bidiIsolate(providerSpecsError) })}
        </div>
      )}
      {!providerSpecsLoading && !providerSpecsError && visibleTemplates.length === 0 && (
        <div className="desktop-cloud-automation-catalog-empty">{t("automation.page.noSourcesInCategory")}</div>
      )}
    </>
  );

  return (
    <section className="desktop-cloud-automation-page">
    <main className="desktop-cloud-automation-canvas" data-po-scrollbar="content">
        <section className={`desktop-cloud-automation-catalog ${hasAnyAutomation ? "has-automations" : ""}`}>
          <header className="desktop-cloud-automation-landing-header">
            <div className="desktop-cloud-automation-landing-copy">
              <h1>{t("automation.page.title")}</h1>
              <p>{t("automation.page.description")}</p>
            </div>
            <button type="button" className="desktop-cloud-automation-new-button" onClick={() => openNewAutomation()}>
              {t("automation.page.new")}
            </button>
          </header>

          {creationEcho && (
            <section className={`desktop-cloud-automation-creation-echo ${getAutomationStatusTone(creationEcho.status)}`} role="status">
              <div>
                <strong>{creationEcho.summary
                  || (creationEcho.error
                    ? t("automation.creation.initialFailed")
                    : formatAutomationStatus(creationEcho.status, t))}</strong>
                <span>
                  {t("automation.creation.route", {
                    provider: bidiIsolate(formatProviderLabel(creationEcho.provider, t)),
                    path: bidiIsolate(`/${creationEcho.targetPath}`),
                  })}
                  {creationEcho.error
                    ? ` · ${t("automation.error.detail", { detail: bidiIsolate(creationEcho.error) })}`
                    : ""}
                </span>
              </div>
              <div className="desktop-cloud-automation-creation-echo-actions">
                <button type="button" onClick={() => void refreshCreationStatus()}>
                  <RefreshCw size={14} />
                  {t("common.action.refresh")}
                </button>
                <Tooltip content={t("automation.creation.dismissStatus")}><button
                  type="button"
                  aria-label={t("automation.creation.dismissStatus")}
                  onClick={() => setCreationEcho(null)}
                >
                  <X size={14} />
                </button></Tooltip>
              </div>
            </section>
          )}

          {hasAnyAutomation && (
            <section className="desktop-cloud-automation-existing-section primary">
              <header className="desktop-cloud-automation-existing-header">
                <h2>{t("automation.page.yourAutomations")}</h2>
                <span>{totalCount}</span>
              </header>
              {loading && rows.length === 0 ? (
                <div className="desktop-cloud-automation-existing-loading" role="status">{t("automation.page.loadingYours")}</div>
              ) : rows.length > 0 ? (
                <div className="desktop-cloud-automation-detail">
                  <CloudAutomationAccessList
                    rows={rows}
                    selectedRowId={detailRow?.id ?? null}
                    highlightedConnectionId={highlightedConnectionId}
                    creationEcho={creationEcho}
                    onOpenRow={onOpenRow}
                  />
                </div>
              ) : (
                <div className="desktop-cloud-automation-catalog-empty">{t("automation.page.noMatchingAutomations")}</div>
              )}
            </section>
          )}

          <section className={hasAnyAutomation ? "desktop-cloud-automation-add-more" : undefined}>
            {catalog}
          </section>

          {!hasAnyAutomation && loading && (
            <div className="desktop-cloud-automation-existing-loading" role="status">{t("automation.page.loadingYours")}</div>
          )}
        </section>
      </main>
      {newAutomationOpen && (
        <CloudNewAutomationDialog
          projectId={projectId}
          cloudSession={cloudSession}
          apiBaseUrl={apiBaseUrl}
          providers={providerSpecs}
          providersLoading={providerSpecsLoading}
          providersError={providerSpecsError}
          template={draftTemplate}
          onCloudSessionChange={onCloudSessionChange}
          onRefresh={onRefresh}
          onCreated={handleCreated}
          onClose={() => setNewAutomationOpen(false)}
        />
      )}
      {detailRow && (
        <CloudManageAutomationDialog
          key={`${detailRow.id}:${providerSpecs.some((provider) => provider.provider === detailRow.connector.provider) ? "spec" : "fallback"}`}
          projectId={projectId}
          row={detailRow}
          providerSpec={providerSpecs.find((provider) => provider.provider === detailRow.connector.provider) ?? null}
          cloudSession={cloudSession}
          apiBaseUrl={apiBaseUrl}
          onCloudSessionChange={onCloudSessionChange}
          onRefresh={onRefresh}
          onOpenAutomation={onOpenAutomation}
          onClose={onCloseDetail}
        />
      )}
    </section>
  );
}

function CloudAutomationAccessList({
  rows,
  selectedRowId,
  highlightedConnectionId,
  creationEcho,
  onOpenRow,
}: {
  rows: CloudAutomationRow[];
  selectedRowId?: string | null;
  highlightedConnectionId: string | null;
  creationEcho: CloudAutomationCreationEcho | null;
  onOpenRow: (rowId: string) => void;
}) {
  const localization = useLocalization();
  const { getCollator, t } = localization;
  const providerGroups = getAutomationProviderGroups(rows, getCollator({ sensitivity: "base" }), t);
  return (
    <section className="desktop-cloud-automation-list" aria-label={t("automation.page.cloudAutomation")}>
      {providerGroups.map((group) => {
        const ProviderIcon = providerIcon(group.provider);
        const iconUrl = getCloudProviderIconUrl(group.provider);
        return (
          <section className="desktop-cloud-automation-provider-group" key={group.provider}>
            <div className="desktop-cloud-automation-provider-header">
              <h2>{group.label}</h2>
              <span>{localization.formatNumber(group.rows.length)}</span>
            </div>
            <div className="desktop-cloud-automation-provider-body">
              <div className="desktop-cloud-automation-provider-summary" aria-hidden="true">
                <span className="desktop-cloud-automation-provider-hero">
                  {iconUrl ? <img src={iconUrl} alt="" /> : <ProviderIcon size={40} />}
                </span>
              </div>
              <div className="desktop-cloud-automation-connection-list">
                {group.rows.map((row) => {
                  const connector = row.connector;
                  const echo = creationEcho?.connectionId === connector.id ? creationEcho : null;
                  const status = echo?.status || connector.status || "active";
                  const connectionTitle = connector.name || group.label;
                  const statusLabel = formatAutomationStatus(status, t);
                  const statusTone = getAutomationStatusTone(status);
                  const lastRunLabel = formatAutomationRelativeTime(
                    connector.last_run_at || connector.updated_at,
                    localization,
                  );
                  const targetPath = formatAutomationPathTrailLabel(row.scope);
                  const highlighted = highlightedConnectionId === connector.id;
                  return (
                    <Tooltip content={t("automation.connection.title", {
                        name: bidiIsolate(connectionTitle),
                        path: bidiIsolate(getScopePathLabel(row.scope)),
                      })} key={row.id}><button
                      className={`desktop-cloud-automation-connection-card ${selectedRowId === row.id ? "selected" : ""} ${highlighted ? "created" : ""}`.trim()}
                      type="button"
                      onClick={() => onOpenRow(row.id)}
                    >
                      <span className="desktop-cloud-automation-route">
                        <Tooltip content={t("automation.connection.source", {
                            provider: bidiIsolate(group.label),
                            name: bidiIsolate(connectionTitle),
                          })}><span
                          className="desktop-cloud-automation-source-config"
                              >
                          {iconUrl ? <img src={iconUrl} alt="" /> : <ProviderIcon size={16} />}
                          <span>{group.label}</span>
                        </span></Tooltip>
                        <ArrowRight className="po-directional-icon" size={15} />
                        <span className="desktop-cloud-automation-path-trail">
                          <img src={resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.ui.folder)} alt="" />
                          <span>{targetPath}</span>
                        </span>
                      </span>
                      <span className="desktop-cloud-automation-right">
                        <span className="desktop-cloud-automation-meta">
                          <span className={`desktop-cloud-automation-status-meta ${statusTone}`}>
                            <span className="desktop-cloud-automation-status-dot" aria-hidden="true" />
                            {statusLabel}
                          </span>
                          <span>{t("automation.connection.inbound")}</span>
                          <span>{echo
                            ? echo.summary || formatAutomationStatus(echo.status, t)
                            : lastRunLabel
                              ? t("automation.connection.lastRun", { time: bidiIsolate(lastRunLabel) })
                              : t("automation.connection.neverRun")}</span>
                        </span>
                        <span className="desktop-cloud-automation-manage">{t("automation.connection.manage")}<ChevronRight className="po-directional-icon" size={13} /></span>
                      </span>
                      {(echo?.error || connector.error_message) && (
                        <span className="desktop-cloud-automation-error" dir="auto">
                          {t("automation.error.detail", {
                            detail: bidiIsolate(echo?.error || connector.error_message),
                          })}
                        </span>
                      )}
                    </button></Tooltip>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </section>
  );
}

function getAutomationProviderGroups(rows: CloudAutomationRow[], collator: Intl.Collator, t: ReturnType<typeof useLocalization>["t"]) {
  const groups = new Map<string, { provider: string; label: string; rows: CloudAutomationRow[] }>();
  for (const row of rows) {
    const provider = row.connector.provider;
    const group = groups.get(provider) ?? { provider, label: formatProviderLabel(provider, t), rows: [] };
    group.rows.push(row);
    groups.set(provider, group);
  }
  return [...groups.values()].sort((left, right) => collator.compare(left.label, right.label));
}

function getAutomationStatusTone(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? "";
  if (["active", "ready", "connected", "success", "completed"].includes(normalized)) return "success";
  if (["syncing", "processing", "running"].includes(normalized)) return "accent";
  if (["paused", "pending", "warning", "queued"].includes(normalized)) return "warning";
  if (["error", "failed", "blocked"].includes(normalized)) return "danger";
  return "muted";
}

function formatAutomationPathTrailLabel(scope: DesktopCloudRepositoryView) {
  const path = getScopePathLabel(scope);
  if (path === "/") return "/";
  return `/ ${path.replace(/^\/+/, "").split("/").filter(Boolean).join(" / ")}`;
}

function isTerminalRunStatus(status: string) {
  return ["success", "completed", "failed", "error", "cancelled", "canceled"].includes(status.toLowerCase());
}
