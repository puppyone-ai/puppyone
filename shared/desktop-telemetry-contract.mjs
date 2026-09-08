export const DESKTOP_TELEMETRY_SCHEMA_VERSION = 2;
export const DESKTOP_TELEMETRY_SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1, 2]);
export const DESKTOP_TELEMETRY_NOTICE_VERSION = 2;
export const DESKTOP_TELEMETRY_LEVELS = Object.freeze(["off", "basic"]);
export const DESKTOP_TELEMETRY_DAILY_ACTIVE_EVENT = "desktop_daily_active";
export const DESKTOP_TELEMETRY_FIRST_RUN_EVENT = "desktop_first_run";
export const DESKTOP_TELEMETRY_ONBOARDING_VERSION = 1;

const COMMON_FIELDS = Object.freeze([
  "schema_version",
  "event_id",
  "event",
  "activity_day",
  "anonymous_id",
  "properties.app_version",
  "properties.platform",
  "properties.architecture",
  "properties.os_major",
  "properties.notice_version",
]);

const DISCLOSURE = deepFreeze({
  schemaVersion: DESKTOP_TELEMETRY_SCHEMA_VERSION,
  noticeVersion: DESKTOP_TELEMETRY_NOTICE_VERSION,
  levels: [
    {
      id: "off",
      sendsData: false,
      description: "No PuppyOne product analytics are sent.",
    },
    {
      id: "basic",
      sendsData: true,
      description: "Bounded first-run and daily activity events are sent from eligible Stable builds.",
    },
  ],
  events: [
    {
      name: DESKTOP_TELEMETRY_FIRST_RUN_EVENT,
      purpose: "Measure anonymous installation cohorts after the first-run notice is shown.",
      maximumFrequency: "Once per fresh installation while Basic analytics is enabled.",
      identifierRotation: "Not account-linked; retained for at most 100 days at the ingestion service.",
      fields: [
        ...COMMON_FIELDS,
        "retention_id",
        "properties.onboarding_version",
      ],
    },
    {
      name: DESKTOP_TELEMETRY_DAILY_ACTIVE_EVENT,
      purpose: "Measure active Stable installations, application-version adoption, and bounded retention.",
      maximumFrequency: "Once per installation per UTC day while PuppyOne is foregrounded.",
      identifierRotation: "Calendar-month activity ID; a separate retention ID is sent only during the first 100 lifecycle days.",
      fields: [
        ...COMMON_FIELDS,
        "retention_id",
      ],
    },
  ],
  neverCollected: [
    "account identifiers",
    "authentication credentials",
    "file contents",
    "file or repository paths",
    "Git remotes, commits, branches, or author details",
    "prompts, agent responses, or terminal content",
    "hardware serial numbers, MAC addresses, or device fingerprints",
    "raw IP addresses or full user-agent strings in the event payload",
  ],
});

export function isDesktopTelemetryLevel(value) {
  return DESKTOP_TELEMETRY_LEVELS.includes(value);
}

export function isDesktopTelemetrySchemaVersion(value) {
  return DESKTOP_TELEMETRY_SUPPORTED_SCHEMA_VERSIONS.includes(value);
}

export function getDesktopTelemetryDisclosure() {
  return DISCLOSURE;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
