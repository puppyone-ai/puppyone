import type {
  DesktopCloudAutomationConfigField,
  DesktopCloudAutomationProviderResource,
  DesktopCloudAutomationProviderSpec,
  DesktopCloudCreateSynchronizeBindingRequest,
  DesktopCloudUpdateSynchronizeTriggerRequest,
} from "../../lib/cloudApi";

export type AutomationRunMode = "manual" | "scheduled" | "realtime";
export type AutomationTriggerPreset = "manual" | "hourly" | "daily" | "weekly" | "custom" | "realtime";

export type AutomationTriggerDraft = {
  preset: AutomationTriggerPreset;
  time: string;
  weekday: string;
  customCron: string;
  timezone: string;
};

export type AutomationValidationError = Readonly<
  | { code: "target-outside-project" }
  | { code: "target-unsupported-character" }
  | { code: "invalid-timezone" }
  | { code: "invalid-time" }
  | { code: "invalid-weekday" }
  | { code: "cron-part-count" }
  | { code: "cron-field"; field: number }
>;

export type AutomationSourceSelection = {
  resourceId: string;
  resourceName: string;
  resourceUrl: string;
  resourceType: string;
  metadata: Record<string, unknown>;
};

const CLOUD_AUTOMATION_INTERNAL_CONFIG_KEYS = new Set([
  "access_key",
  "authority",
  "connection_id",
  "credentials_ref",
  "credential_ref",
  "direction",
  "external_resource_id",
  "external_resource",
  "last_sync_commit_id",
  "last_synchronize_commit_id",
  "synchronize_binding_id",
  "name",
  "oauth_user_id",
  "provider",
  "resource_id",
  "resource_name",
  "resource_type",
  "status",
  "sync_behavior",
  "target_folder_path",
  "target_output",
  "target_path",
  "user_id",
  "write_behavior",
]);

const CRON_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

export function getCloudAutomationUserConfigFields(
  provider: DesktopCloudAutomationProviderSpec | null,
): DesktopCloudAutomationConfigField[] {
  return (provider?.config_fields ?? []).filter((field) => !CLOUD_AUTOMATION_INTERNAL_CONFIG_KEYS.has(field.key));
}

export function defaultAutomationConfigValues(
  provider: DesktopCloudAutomationProviderSpec,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of getCloudAutomationUserConfigFields(provider)) {
    values[field.key] = field.default === null || field.default === undefined ? "" : String(field.default);
  }
  return values;
}

export function automationConfigValuesFromConnection(
  provider: DesktopCloudAutomationProviderSpec,
  config: Record<string, unknown> | null | undefined,
) {
  const values = defaultAutomationConfigValues(provider);
  const options = isRecord(config?.options) ? config.options : {};
  for (const field of getCloudAutomationUserConfigFields(provider)) {
    const value = options[field.key] ?? config?.[field.key];
    if (value !== null && value !== undefined) values[field.key] = String(value);
  }
  return values;
}

export function automationSourceFromConfig(
  config: Record<string, unknown> | null | undefined,
): AutomationSourceSelection | null {
  const source = isRecord(config?.source) ? config.source : null;
  const resourceId = readString(source?.resource_id);
  if (!resourceId) return null;
  return {
    resourceId,
    resourceName: readString(source?.resource_name) || resourceId,
    resourceUrl: readString(source?.resource_url),
    resourceType: readString(source?.resource_type) || "manual",
    metadata: isRecord(source?.metadata) ? source.metadata : {},
  };
}

export function automationSourceFromProviderResource(
  resource: DesktopCloudAutomationProviderResource,
): AutomationSourceSelection {
  return {
    resourceId: resource.id,
    resourceName: resource.name,
    resourceUrl: resource.url ?? "",
    resourceType: resource.type,
    metadata: resource.metadata,
  };
}

export function defaultAutomationTargetPath(provider: DesktopCloudAutomationProviderSpec | null) {
  const label = provider?.display_name || provider?.provider || "automation";
  return normalizeAutomationTargetPath(label.replace(/[<>:"|?*]/g, "-"));
}

export function normalizeAutomationTargetPath(path: string) {
  const parts: string[] = [];
  for (const part of path.trim().replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return "";
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

export function getAutomationTargetPathValidationError(path: string): AutomationValidationError | null {
  let depth = 0;
  for (const part of path.trim().replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return { code: "target-outside-project" };
    } else {
      if (/[\x00-\x1f]/.test(part)) return { code: "target-unsupported-character" };
      depth += 1;
    }
  }
  return null;
}

export function getSupportedAutomationRunModes(
  provider: DesktopCloudAutomationProviderSpec | null,
): AutomationRunMode[] {
  const supported = (provider?.supported_sync_modes ?? [])
    .filter((mode): mode is AutomationRunMode => mode === "manual" || mode === "scheduled" || mode === "realtime");
  return supported.length > 0 ? [...new Set(supported)] : ["manual"];
}

export function getDefaultAutomationRunMode(
  provider: DesktopCloudAutomationProviderSpec | null,
): AutomationRunMode {
  const modes = getSupportedAutomationRunModes(provider);
  const preferred = provider?.default_sync_mode;
  return modes.find((mode) => mode === preferred) ?? modes[0];
}

export function getAutomationTriggerPresets(
  provider: DesktopCloudAutomationProviderSpec | null,
): AutomationTriggerPreset[] {
  const modes = getSupportedAutomationRunModes(provider);
  return [
    ...(modes.includes("manual") ? ["manual" as const] : []),
    ...(modes.includes("scheduled") ? ["hourly" as const, "daily" as const, "weekly" as const, "custom" as const] : []),
    ...(modes.includes("realtime") ? ["realtime" as const] : []),
  ];
}

export function getDefaultAutomationTriggerDraft(
  provider: DesktopCloudAutomationProviderSpec | null,
): AutomationTriggerDraft {
  const mode = getDefaultAutomationRunMode(provider);
  const preset: AutomationTriggerPreset = mode === "scheduled" ? "daily" : mode;
  return {
    preset,
    time: "09:00",
    weekday: "1",
    customCron: "0 9 * * 1-5",
    timezone: getLocalAutomationTimezone(),
  };
}

export function automationTriggerDraftFromConnection(
  provider: DesktopCloudAutomationProviderSpec | null,
  trigger: Record<string, unknown> | null | undefined,
): AutomationTriggerDraft {
  const fallback = getDefaultAutomationTriggerDraft(provider);
  const type = readString(trigger?.type).toLowerCase();
  const schedule = readString(trigger?.schedule);
  const timezone = readString(trigger?.timezone) || fallback.timezone;
  if (type === "realtime") return { ...fallback, preset: "realtime", timezone };
  if (type !== "schedule" && type !== "scheduled") return { ...fallback, preset: "manual", timezone };

  if (schedule === "0 * * * *") return { ...fallback, preset: "hourly", timezone };
  const daily = schedule.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (daily) {
    return {
      ...fallback,
      preset: "daily",
      time: `${daily[2].padStart(2, "0")}:${daily[1].padStart(2, "0")}`,
      timezone,
    };
  }
  const weekly = schedule.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/);
  if (weekly) {
    return {
      ...fallback,
      preset: "weekly",
      time: `${weekly[2].padStart(2, "0")}:${weekly[1].padStart(2, "0")}`,
      weekday: weekly[3] === "7" ? "0" : weekly[3],
      timezone,
    };
  }
  return { ...fallback, preset: "custom", customCron: schedule || fallback.customCron, timezone };
}

export function getAutomationTriggerSchedule(draft: AutomationTriggerDraft) {
  const [hour = "9", minute = "0"] = draft.time.split(":");
  if (draft.preset === "hourly") return "0 * * * *";
  if (draft.preset === "daily") return `${Number(minute)} ${Number(hour)} * * *`;
  if (draft.preset === "weekly") return `${Number(minute)} ${Number(hour)} * * ${draft.weekday}`;
  if (draft.preset === "custom") return draft.customCron.trim();
  return "";
}

export function getAutomationTriggerValidationError(draft: AutomationTriggerDraft): AutomationValidationError | null {
  if (!["hourly", "daily", "weekly", "custom"].includes(draft.preset)) return null;
  if (!isValidAutomationTimezone(draft.timezone)) return { code: "invalid-timezone" };
  if ((draft.preset === "daily" || draft.preset === "weekly") && !isValidClockTime(draft.time)) {
    return { code: "invalid-time" };
  }
  if (draft.preset === "weekly" && !/^[0-6]$/.test(draft.weekday)) return { code: "invalid-weekday" };
  return validateFivePartCron(getAutomationTriggerSchedule(draft));
}

export function validateFivePartCron(schedule: string): AutomationValidationError | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return { code: "cron-part-count" };
  for (let index = 0; index < fields.length; index += 1) {
    if (!isValidCronField(fields[index], ...CRON_RANGES[index])) {
      return { code: "cron-field", field: index + 1 };
    }
  }
  return null;
}

export function getNextAutomationRun(draft: AutomationTriggerDraft, from = new Date()): Date | null {
  if (!["hourly", "daily", "weekly"].includes(draft.preset) || getAutomationTriggerValidationError(draft)) return null;
  const [hour, minute] = draft.time.split(":").map(Number);
  const maxMinutes = draft.preset === "hourly" ? 61 : draft.preset === "daily" ? 1_441 : 10_081;
  const zonedPartsFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: draft.timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  for (let offset = 0; offset < maxMinutes; offset += 1) {
    const parts = getZonedDateParts(candidate, zonedPartsFormatter);
    const matches = draft.preset === "hourly"
      ? parts.minute === 0
      : parts.hour === hour
        && parts.minute === minute
        && (draft.preset !== "weekly" || parts.weekday === Number(draft.weekday));
    if (matches) return new Date(candidate);
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}

export function buildAutomationTriggerUpdateRequest(
  draft: AutomationTriggerDraft,
): DesktopCloudUpdateSynchronizeTriggerRequest {
  const schedule = getAutomationTriggerSchedule(draft);
  const syncMode: AutomationRunMode = ["hourly", "daily", "weekly", "custom"].includes(draft.preset)
    ? "scheduled"
    : draft.preset as AutomationRunMode;
  return {
    sync_mode: syncMode,
    trigger: syncMode === "scheduled"
      ? { type: "schedule", schedule, timezone: draft.timezone }
      : { type: syncMode },
  };
}

export function buildAutomationConfig({
  provider,
  configValues,
  source,
  baseConfig,
}: {
  provider: DesktopCloudAutomationProviderSpec;
  configValues: Record<string, string>;
  source: AutomationSourceSelection | null;
  baseConfig?: Record<string, unknown> | null;
}) {
  const fieldsByKey = new Map(getCloudAutomationUserConfigFields(provider).map((field) => [field.key, field]));
  const options: Record<string, unknown> = isRecord(baseConfig?.options) ? { ...baseConfig.options } : {};
  for (const [key, value] of Object.entries(configValues)) {
    const trimmed = value.trim();
    if (key === "resource_url") continue;
    const field = fieldsByKey.get(key);
    if (!trimmed) {
      if (baseConfig && field) delete options[key];
      continue;
    }
    options[key] = field?.type === "number" ? Number(trimmed) : value;
  }

  const resourceUrl = (configValues.resource_url ?? "").trim();
  const resolvedSource = provider.provider === "url"
    ? {
        provider: provider.provider,
        resource_type: "web_page",
        resource_id: resourceUrl,
        resource_name: resourceUrl,
        resource_url: resourceUrl,
      }
    : source
      ? {
          provider: provider.provider,
          resource_type: source.resourceType || "manual",
          resource_id: source.resourceId,
          resource_name: source.resourceName || source.resourceId,
          ...(source.resourceUrl ? { resource_url: source.resourceUrl } : {}),
          ...(Object.keys(source.metadata).length > 0 ? { metadata: source.metadata } : {}),
        }
      : {
          provider: provider.provider,
          resource_type: "manual",
          resource_id: provider.provider,
          resource_name: provider.display_name,
        };

  return { source: resolvedSource, options };
}

export function buildDesktopCreateAutomationRequest({
  projectId,
  provider,
  configValues,
  source,
  targetPath,
  trigger,
}: {
  projectId: string;
  provider: DesktopCloudAutomationProviderSpec;
  configValues: Record<string, string>;
  source: AutomationSourceSelection | null;
  targetPath: string;
  trigger: AutomationTriggerDraft;
}): DesktopCloudCreateSynchronizeBindingRequest {
  const triggerRequest = buildAutomationTriggerUpdateRequest(trigger);
  return {
    project_id: projectId,
    provider: provider.provider,
    config: buildAutomationConfig({ provider, configValues, source }),
    target_path: targetPath,
    direction: "inbound",
    sync_mode: triggerRequest.sync_mode,
    trigger: triggerRequest.trigger ?? undefined,
  };
}

export function getAutomationTimezones() {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const local = getLocalAutomationTimezone();
  const values = intl.supportedValuesOf?.("timeZone") ?? [
    "UTC",
    "America/Los_Angeles",
    "America/New_York",
    "Europe/London",
    "Europe/Paris",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
  return [...new Set([local, "UTC", ...values])].sort((left, right) => left.localeCompare(right));
}

function getLocalAutomationTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function isValidClockTime(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function isValidAutomationTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isValidCronField(field: string, min: number, max: number) {
  return field.split(",").every((part) => {
    const [rangePart, stepPart, ...extra] = part.split("/");
    if (extra.length > 0) return false;
    if (stepPart !== undefined && (!/^\d+$/.test(stepPart) || Number(stepPart) < 1)) return false;
    if (rangePart === "*") return true;
    const range = rangePart.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      return start >= min && start <= max && end >= min && end <= max && start <= end;
    }
    if (!/^\d+$/.test(rangePart)) return false;
    const value = Number(rangePart);
    return value >= min && value <= max;
  });
}

function getZonedDateParts(date: Date, formatter: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
