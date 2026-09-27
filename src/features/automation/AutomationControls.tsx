import { Tooltip } from "@puppyone/shared-ui";
import { ChevronDown, ChevronRight, Folder, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type {
  DesktopCloudAutomationConfigField,
  DesktopCloudAutomationProviderResource,
  DesktopCloudAutomationProviderSpec,
  DesktopCloudSession,
} from "../../lib/cloudApi";
import {
  listCloudAutomationProviderResources,
  listCloudDirectory,
  supportsCloudAutomationOauth,
} from "../../lib/cloudApi";
import {
  automationSourceFromProviderResource,
  getNextAutomationRun,
  getAutomationTimezones,
  getAutomationTargetPathValidationError,
  getAutomationTriggerPresets,
  getAutomationTriggerValidationError,
  getCloudAutomationUserConfigFields,
  normalizeAutomationTargetPath,
  type AutomationSourceSelection,
  type AutomationTriggerDraft,
  type AutomationTriggerPreset,
} from "./automationRequest";
import {
  formatAutomationNextRun,
  formatAutomationTriggerPreset,
  formatAutomationTriggerSummary,
  formatAutomationValidationError,
  formatAutomationWeekday,
} from "./automationPresentation";

type SessionChangeHandler = (session: DesktopCloudSession | null) => void;
type ResourceFallbackNotice = "empty" | "unavailable" | "manual";
type ResourceLoadError = Readonly<{ code: "load" | "load-more"; detail: string }>;

export function CloudAutomationSourceEditor({
  provider,
  cloudSession,
  apiBaseUrl,
  configValues,
  source,
  onCloudSessionChange,
  onConfigValueChange,
  onSourceChange,
}: {
  provider: DesktopCloudAutomationProviderSpec;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  configValues: Record<string, string>;
  source: AutomationSourceSelection | null;
  onCloudSessionChange: SessionChangeHandler;
  onConfigValueChange: (key: string, value: string) => void;
  onSourceChange: (source: AutomationSourceSelection | null) => void;
}) {
  const { t } = useLocalization();
  const fields = getCloudAutomationUserConfigFields(provider);
  const canEnumerate = provider.auth !== "none" && supportsCloudAutomationOauth(provider.provider);
  const [manualMode, setManualMode] = useState(!canEnumerate);
  const [fallbackNotice, setFallbackNotice] = useState<ResourceFallbackNotice | null>(null);
  const handleManualFallback = useCallback((notice: ResourceFallbackNotice) => {
    setFallbackNotice(notice);
    setManualMode(true);
  }, []);

  useEffect(() => {
    setManualMode(!canEnumerate);
    setFallbackNotice(null);
  }, [canEnumerate, provider.provider]);

  return (
    <div className="desktop-cloud-automation-source-editor">
      {canEnumerate && !manualMode ? (
        <CloudAutomationResourcePicker
          provider={provider}
          cloudSession={cloudSession}
          apiBaseUrl={apiBaseUrl}
          value={source}
          onCloudSessionChange={onCloudSessionChange}
          onChange={onSourceChange}
          onManualFallback={handleManualFallback}
        />
      ) : provider.provider !== "url" ? (
        <CloudAutomationManualSourceFields source={source} onChange={onSourceChange} />
      ) : null}

      {fallbackNotice && (
        <div className="desktop-cloud-automation-inline-note">
          {t(`automation.resource.fallback.${fallbackNotice}`)}
        </div>
      )}

      {canEnumerate && manualMode && (
        <button
          className="desktop-cloud-automation-link-button"
          type="button"
          onClick={() => {
            setFallbackNotice(null);
            setManualMode(false);
          }}
        >
          {t("automation.resource.browseConnected")}
        </button>
      )}

      {fields.map((field) => (
        <label className="desktop-cloud-automation-field" key={field.key}>
          <span>{field.label}{field.required ? " *" : ""}</span>
          <CloudAutomationConfigInput
            field={field}
            value={configValues[field.key] ?? ""}
            onChange={(value) => onConfigValueChange(field.key, value)}
          />
          {field.hint && <small>{field.hint}</small>}
        </label>
      ))}

      {provider.provider === "url" && fields.length === 0 && (
        <div className="desktop-cloud-automation-field-empty">{t("automation.source.noSettings")}</div>
      )}
    </div>
  );
}

function CloudAutomationResourcePicker({
  provider,
  cloudSession,
  apiBaseUrl,
  value,
  onCloudSessionChange,
  onChange,
  onManualFallback,
}: {
  provider: DesktopCloudAutomationProviderSpec;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  value: AutomationSourceSelection | null;
  onCloudSessionChange: SessionChangeHandler;
  onChange: (source: AutomationSourceSelection | null) => void;
  onManualFallback: (notice: ResourceFallbackNotice) => void;
}) {
  const { t } = useLocalization();
  const [query, setQuery] = useState("");
  const [resources, setResources] = useState<DesktopCloudAutomationProviderResource[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ResourceLoadError | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void listCloudAutomationProviderResources(
        cloudSession,
        provider.provider,
        { q: query },
        onCloudSessionChange,
        apiBaseUrl,
      )
        .then((result) => {
          if (cancelled) return;
          setResources(result.resources);
          setNextCursor(result.next_cursor);
          if (!query.trim() && result.resources.length === 0) {
            onManualFallback("empty");
          }
        })
        .catch((loadError) => {
          if (cancelled) return;
          if (isResourceFallbackError(loadError)) {
            onManualFallback("unavailable");
            return;
          }
          setResources([]);
          setNextCursor(null);
          setError({
            code: "load",
            detail: loadError instanceof Error ? loadError.message : String(loadError),
          });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBaseUrl, cloudSession, onCloudSessionChange, onManualFallback, provider.provider, query]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await listCloudAutomationProviderResources(
        cloudSession,
        provider.provider,
        { q: query, cursor: nextCursor },
        onCloudSessionChange,
        apiBaseUrl,
      );
      setResources((current) => mergeResources(current, result.resources));
      setNextCursor(result.next_cursor);
    } catch (loadError) {
      setError({
        code: "load-more",
        detail: loadError instanceof Error ? loadError.message : String(loadError),
      });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section
      className="desktop-cloud-automation-resource-picker"
      aria-label={t("automation.resource.providerResources", { provider: bidiIsolate(provider.display_name) })}
    >
      <label className="desktop-cloud-automation-resource-search">
        <Search size={14} aria-hidden="true" />
        <input
          value={query}
          aria-label={t("automation.resource.searchProvider", { provider: bidiIsolate(provider.display_name) })}
          placeholder={t("automation.resource.search")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {value && (
        <div className="desktop-cloud-automation-selected-resource">
          <span>{t("automation.resource.selected")}</span>
          <strong dir="auto">{value.resourceName}</strong>
          <button type="button" onClick={() => onChange(null)}>{t("common.action.clear")}</button>
        </div>
      )}
      {loading ? (
        <div className="desktop-cloud-automation-resource-state" role="status">{t("automation.resource.loading")}</div>
      ) : error ? (
        <div className="desktop-cloud-automation-resource-state error" role="alert">
          <span>{t(`automation.resource.error.${error.code}`, { detail: bidiIsolate(error.detail) })}</span>
          <button type="button" onClick={() => onManualFallback("manual")}>{t("automation.resource.enterManually")}</button>
        </div>
      ) : resources.length === 0 ? (
        <div className="desktop-cloud-automation-resource-state">{t("automation.resource.noMatches")}</div>
      ) : (
        <div className="desktop-cloud-automation-resource-list" data-po-scrollbar="content">
          {resources.map((resource) => {
            const selected = value?.resourceId === resource.id;
            return (
              <Tooltip content={resource.authorized
                  ? resource.name
                  : t("automation.resource.notAuthorized", { name: bidiIsolate(resource.name) })} key={`${resource.type}:${resource.id}`}><button
                className={selected ? "selected" : undefined}
                type="button"
                disabled={!resource.authorized}
                aria-pressed={selected}
                onClick={() => onChange(automationSourceFromProviderResource(resource))}
                                                                                                                                          >
                <span>
                  <strong dir="auto">{resource.name}</strong>
                  {(resource.subtitle || resource.type) && <small>{resource.subtitle || resource.type}</small>}
                </span>
                <span>{resource.authorized
                  ? selected ? t("automation.resource.selected") : t("automation.resource.select")
                  : t("automation.resource.noAccess")}</span>
              </button></Tooltip>
            );
          })}
        </div>
      )}
      {nextCursor && (
        <button className="desktop-cloud-automation-link-button" type="button" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? t("common.status.loading") : t("automation.resource.loadMore")}
        </button>
      )}
      <button
        className="desktop-cloud-automation-link-button"
        type="button"
        onClick={() => onManualFallback("manual")}
      >
        {t("automation.resource.enterIdInstead")}
      </button>
    </section>
  );
}

function CloudAutomationManualSourceFields({
  source,
  onChange,
}: {
  source: AutomationSourceSelection | null;
  onChange: (source: AutomationSourceSelection | null) => void;
}) {
  const { t } = useLocalization();
  const update = (patch: Partial<AutomationSourceSelection>) => {
    const next = {
      resourceId: source?.resourceId ?? "",
      resourceName: source?.resourceName ?? "",
      resourceUrl: source?.resourceUrl ?? "",
      resourceType: source?.resourceType ?? "manual",
      metadata: source?.metadata ?? {},
      ...patch,
    };
    onChange(next.resourceId || next.resourceName || next.resourceUrl ? next : null);
  };
  return (
    <div className="desktop-cloud-automation-manual-source" aria-label={t("automation.source.manualDetails")}>
      <label className="desktop-cloud-automation-field">
        <span>{t("automation.source.resourceIdRequired")}</span>
        <input
          value={source?.resourceId ?? ""}
          required
          placeholder={t("automation.source.resourceIdPlaceholder")}
          onChange={(event) => update({ resourceId: event.target.value })}
        />
      </label>
      <label className="desktop-cloud-automation-field">
        <span>{t("automation.source.resourceName")}</span>
        <input
          value={source?.resourceName ?? ""}
          placeholder={t("automation.source.displayNamePlaceholder")}
          onChange={(event) => update({ resourceName: event.target.value })}
        />
      </label>
      <label className="desktop-cloud-automation-field">
        <span>{t("automation.source.resourceUrl")}</span>
        <input
          value={source?.resourceUrl ?? ""}
          type="url"
          placeholder="https://…"
          onChange={(event) => update({ resourceUrl: event.target.value })}
        />
      </label>
    </div>
  );
}

export function CloudAutomationTriggerEditor({
  provider,
  draft,
  onChange,
  showNextRun = false,
}: {
  provider: DesktopCloudAutomationProviderSpec | null;
  draft: AutomationTriggerDraft;
  onChange: (draft: AutomationTriggerDraft) => void;
  showNextRun?: boolean;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const presets = getAutomationTriggerPresets(provider);
  const validationError = getAutomationTriggerValidationError(draft);
  const validationMessage = formatAutomationValidationError(validationError, t);
  const nextRun = showNextRun
    ? formatAutomationNextRun(getNextAutomationRun(draft), draft.timezone, localization)
    : null;
  const timezones = useMemo(() => getAutomationTimezones(), []);
  const scheduled = ["hourly", "daily", "weekly", "custom"].includes(draft.preset);

  return (
    <section className="desktop-cloud-automation-trigger-editor" aria-label={t("automation.trigger.settings")}>
      <label className="desktop-cloud-automation-field">
        <span>{t("automation.trigger.label")}</span>
        <select
          aria-label={t("automation.trigger.runTrigger")}
          value={draft.preset}
          onChange={(event) => onChange({ ...draft, preset: event.target.value as AutomationTriggerPreset })}
        >
          {presets.map((preset) => <option key={preset} value={preset}>{formatAutomationTriggerPreset(preset, t)}</option>)}
        </select>
      </label>
      {(draft.preset === "daily" || draft.preset === "weekly") && (
        <label className="desktop-cloud-automation-field">
          <span>{t("automation.trigger.time")}</span>
          <input type="time" value={draft.time} onChange={(event) => onChange({ ...draft, time: event.target.value })} />
        </label>
      )}
      {draft.preset === "weekly" && (
        <label className="desktop-cloud-automation-field">
          <span>{t("automation.trigger.day")}</span>
          <select value={draft.weekday} onChange={(event) => onChange({ ...draft, weekday: event.target.value })}>
            {WEEKDAY_VALUES.map((day) => <option value={day} key={day}>{formatAutomationWeekday(day, t)}</option>)}
          </select>
        </label>
      )}
      {draft.preset === "custom" && (
        <label className="desktop-cloud-automation-field desktop-cloud-automation-custom-cron">
          <span>{t("automation.trigger.cronExpression")}</span>
          <input
            value={draft.customCron}
            aria-invalid={Boolean(validationError)}
            placeholder="0 9 * * 1-5"
            onChange={(event) => onChange({ ...draft, customCron: event.target.value })}
          />
          <small>{t("automation.trigger.cronHint")}</small>
        </label>
      )}
      {scheduled && (
        <label className="desktop-cloud-automation-field">
          <span>{t("automation.trigger.timezone")}</span>
          <select value={draft.timezone} onChange={(event) => onChange({ ...draft, timezone: event.target.value })}>
            {timezones.map((timezone) => <option value={timezone} key={timezone}>{timezone}</option>)}
          </select>
        </label>
      )}
      <div className="desktop-cloud-automation-trigger-summary">
        <span>{formatAutomationTriggerSummary(draft, t)}</span>
        {nextRun && <small>{t("automation.trigger.nextRun", { date: bidiIsolate(nextRun) })}</small>}
      </div>
      {validationMessage && <div className="desktop-cloud-automation-inline-error" role="alert">{validationMessage}</div>}
    </section>
  );
}

export function CloudAutomationDestinationEditor({
  projectId,
  cloudSession,
  apiBaseUrl,
  targetPath,
  onCloudSessionChange,
  onChange,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  targetPath: string;
  onCloudSessionChange: SessionChangeHandler;
  onChange: (path: string) => void;
}) {
  const { t } = useLocalization();
  const [pickerOpen, setPickerOpen] = useState(false);
  const normalizedPath = normalizeAutomationTargetPath(targetPath);
  const pathError = getAutomationTargetPathValidationError(targetPath);
  const pathErrorMessage = formatAutomationValidationError(pathError, t);
  return (
    <section className="desktop-cloud-automation-destination-editor">
      <label className="desktop-cloud-automation-field">
        <span>{t("automation.destination.projectFolder")}</span>
        <input
          value={targetPath}
          aria-invalid={Boolean(pathError)}
          placeholder={t("automation.destination.folderPlaceholder")}
          onChange={(event) => onChange(event.target.value)}
        />
        <small className={pathError ? "error" : undefined} dir="auto">
          {pathErrorMessage ?? t("automation.destination.finalPath", { path: bidiIsolate(`/${normalizedPath}`) })}
        </small>
      </label>
      <button
        className="desktop-cloud-automation-folder-toggle"
        type="button"
        aria-expanded={pickerOpen}
        onClick={() => setPickerOpen((current) => !current)}
      >
        <Folder size={14} />
        {pickerOpen ? t("automation.destination.hideFolders") : t("automation.destination.chooseFolders")}
        {pickerOpen ? <ChevronDown size={13} /> : <ChevronRight className="po-directional-icon" size={13} />}
      </button>
      {pickerOpen && (
        <CloudAutomationFolderBranch
          projectId={projectId}
          cloudSession={cloudSession}
          apiBaseUrl={apiBaseUrl}
          path=""
          depth={0}
          selectedPath={normalizedPath}
          onCloudSessionChange={onCloudSessionChange}
          onSelect={onChange}
        />
      )}
    </section>
  );
}

function CloudAutomationFolderBranch({
  projectId,
  cloudSession,
  apiBaseUrl,
  path,
  depth,
  selectedPath,
  onCloudSessionChange,
  onSelect,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  path: string;
  depth: number;
  selectedPath: string;
  onCloudSessionChange: SessionChangeHandler;
  onSelect: (path: string) => void;
}) {
  const { getCollator, t } = useLocalization();
  const nameCollator = useMemo(() => getCollator({ sensitivity: "base" }), [getCollator]);
  const [folders, setFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    void listCloudDirectory(cloudSession, projectId, path, onCloudSessionChange, apiBaseUrl)
      .then((tree) => {
        if (cancelled) return;
        setFolders(
          tree.entries
            .filter((entry) => entry.type === "folder")
            .map((entry) => ({ name: entry.name, path: normalizeAutomationTargetPath(entry.path) }))
            .sort((left, right) => nameCollator.compare(left.name, right.name)),
        );
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, cloudSession, nameCollator, onCloudSessionChange, path, projectId]);

  if (loading) return <div className="desktop-cloud-automation-folder-state" role="status">{t("automation.destination.loadingFolders")}</div>;
  if (error) return <div className="desktop-cloud-automation-folder-state error">{t("automation.destination.folderLoadFailed")}</div>;
  if (folders.length === 0) return <div className="desktop-cloud-automation-folder-state">{t("automation.destination.noSubfolders")}</div>;

  return (
    <div className="desktop-cloud-automation-folder-tree" style={{ "--automation-folder-depth": depth } as CSSProperties}>
      {folders.map((folder) => {
        const isExpanded = expanded.has(folder.path);
        const selected = selectedPath === folder.path;
        return (
          <div key={folder.path}>
            <div className={`desktop-cloud-automation-folder-row ${selected ? "selected" : ""}`}>
              <Tooltip content={t(isExpanded ? "automation.destination.collapseFolder" : "automation.destination.expandFolder", {
                  name: bidiIsolate(folder.name),
                })}><button
                type="button"
                aria-label={t(isExpanded ? "automation.destination.collapseFolder" : "automation.destination.expandFolder", {
                  name: bidiIsolate(folder.name),
                })}
                aria-expanded={isExpanded}
                onClick={() => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(folder.path)) next.delete(folder.path);
                  else next.add(folder.path);
                  return next;
                })}
                    >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight className="po-directional-icon" size={13} />}
              </button></Tooltip>
              <button type="button" aria-pressed={selected} onClick={() => onSelect(folder.path)}>
                <Folder size={14} />
                <span dir="auto">{folder.name}</span>
              </button>
            </div>
            {isExpanded && (
              <CloudAutomationFolderBranch
                projectId={projectId}
                cloudSession={cloudSession}
                apiBaseUrl={apiBaseUrl}
                path={folder.path}
                depth={depth + 1}
                selectedPath={selectedPath}
                onCloudSessionChange={onCloudSessionChange}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CloudAutomationConfigInput({
  field,
  value,
  onChange,
}: {
  field: DesktopCloudAutomationConfigField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === "select" && field.options?.length) {
    return (
      <select required={field.required} value={value} onChange={(event) => onChange(event.target.value)}>
        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  return (
    <input
      value={value}
      required={field.required}
      type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
      placeholder={field.placeholder ?? undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function isResourceFallbackError(error: unknown) {
  const status = error && typeof error === "object" && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  const message = error instanceof Error ? error.message : String(error);
  return status === 401 || status === 404 || /(?:401|404|not authorize|unknown .*provider|not supported)/i.test(message);
}

function mergeResources(
  current: DesktopCloudAutomationProviderResource[],
  next: DesktopCloudAutomationProviderResource[],
) {
  const resources = new Map(current.map((resource) => [`${resource.type}:${resource.id}`, resource]));
  for (const resource of next) resources.set(`${resource.type}:${resource.id}`, resource);
  return [...resources.values()];
}

const WEEKDAY_VALUES = ["1", "2", "3", "4", "5", "6", "0"] as const;
