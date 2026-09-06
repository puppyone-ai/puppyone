import {
  DESKTOP_TELEMETRY_DAILY_ACTIVE_EVENT,
  DESKTOP_TELEMETRY_FIRST_RUN_EVENT,
  DESKTOP_TELEMETRY_NOTICE_VERSION,
  DESKTOP_TELEMETRY_ONBOARDING_VERSION,
  DESKTOP_TELEMETRY_SCHEMA_VERSION,
} from "./desktop-telemetry-contract.mjs";

const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTHLY_ANONYMOUS_ID_PATTERN = /^m1_[A-Za-z0-9_-]{32,64}$/;
const RETENTION_ID_PATTERN = /^r1_[A-Za-z0-9_-]{32,64}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,79}$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

export function createDesktopDailyActiveEvent(values) {
  return createCurrentEvent(DESKTOP_TELEMETRY_DAILY_ACTIVE_EVENT, values);
}

export function createDesktopFirstRunEvent(values) {
  return createCurrentEvent(DESKTOP_TELEMETRY_FIRST_RUN_EVENT, values);
}

function createCurrentEvent(eventName, {
  activityDay,
  anonymousId,
  appVersion,
  architecture,
  eventId,
  osMajor,
  platform,
  retentionId,
}) {
  const properties = {
    app_version: requireMatch(appVersion, VERSION_PATTERN, "application version"),
    platform: requireMatch(platform, TOKEN_PATTERN, "platform"),
    architecture: requireMatch(architecture, TOKEN_PATTERN, "architecture"),
    os_major: normalizeOsMajor(osMajor),
    notice_version: DESKTOP_TELEMETRY_NOTICE_VERSION,
  };
  if (eventName === DESKTOP_TELEMETRY_FIRST_RUN_EVENT) {
    properties.onboarding_version = DESKTOP_TELEMETRY_ONBOARDING_VERSION;
  }
  const retention = eventName === DESKTOP_TELEMETRY_FIRST_RUN_EVENT || retentionId !== undefined
    ? { retention_id: requireMatch(retentionId, RETENTION_ID_PATTERN, "retention ID") }
    : {};
  return deepFreeze({
    schema_version: DESKTOP_TELEMETRY_SCHEMA_VERSION,
    event_id: requireMatch(eventId, EVENT_ID_PATTERN, "event ID"),
    event: eventName,
    activity_day: normalizeActivityDay(activityDay),
    anonymous_id: requireMatch(anonymousId, MONTHLY_ANONYMOUS_ID_PATTERN, "anonymous ID"),
    ...retention,
    properties,
  });
}

export function isDesktopTelemetryEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.schema_version === 1) return isLegacyDailyActiveEvent(value);
  if (value.schema_version !== DESKTOP_TELEMETRY_SCHEMA_VERSION) return false;
  if (
    value.event !== DESKTOP_TELEMETRY_DAILY_ACTIVE_EVENT
    && value.event !== DESKTOP_TELEMETRY_FIRST_RUN_EVENT
  ) return false;
  const includesRetention = Object.hasOwn(value, "retention_id");
  if (value.event === DESKTOP_TELEMETRY_FIRST_RUN_EVENT && !includesRetention) return false;
  if (!hasExactKeys(value, [
    "activity_day",
    "anonymous_id",
    "event",
    "event_id",
    "properties",
    ...(includesRetention ? ["retention_id"] : []),
    "schema_version",
  ])) return false;
  try {
    const factory = value.event === DESKTOP_TELEMETRY_FIRST_RUN_EVENT
      ? createDesktopFirstRunEvent
      : createDesktopDailyActiveEvent;
    const normalized = factory({
      activityDay: value.activity_day,
      anonymousId: value.anonymous_id,
      appVersion: value.properties?.app_version,
      architecture: value.properties?.architecture,
      eventId: value.event_id,
      osMajor: value.properties?.os_major,
      platform: value.properties?.platform,
      retentionId: value.retention_id,
    });
    return JSON.stringify(normalized) === JSON.stringify(value);
  } catch {
    return false;
  }
}

function isLegacyDailyActiveEvent(value) {
  if (value.event !== DESKTOP_TELEMETRY_DAILY_ACTIVE_EVENT) return false;
  if (!hasExactKeys(value, [
    "activity_day",
    "anonymous_id",
    "event",
    "event_id",
    "properties",
    "schema_version",
  ])) return false;
  if (!hasExactKeys(value.properties, [
    "app_version",
    "architecture",
    "notice_version",
    "os_major",
    "platform",
  ])) return false;
  try {
    requireMatch(value.event_id, EVENT_ID_PATTERN, "event ID");
    normalizeActivityDay(value.activity_day);
    requireMatch(value.anonymous_id, MONTHLY_ANONYMOUS_ID_PATTERN, "anonymous ID");
    requireMatch(value.properties.app_version, VERSION_PATTERN, "application version");
    requireMatch(value.properties.platform, TOKEN_PATTERN, "platform");
    requireMatch(value.properties.architecture, TOKEN_PATTERN, "architecture");
    if (normalizeOsMajor(value.properties.os_major) !== value.properties.os_major) return false;
    return value.properties.notice_version === 1;
  } catch {
    return false;
  }
}

export function normalizeDesktopOsMajor(value) {
  return normalizeOsMajor(value);
}

function normalizeActivityDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("A valid UTC telemetry activity day is required.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TypeError("A valid UTC telemetry activity day is required.");
  }
  return value;
}

function normalizeOsMajor(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,3})(?:\D|$)/);
  if (!match) return "unknown";
  return String(Number(match[1]));
}

function requireMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`A valid ${label} is required.`);
  }
  return value;
}

function hasExactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
