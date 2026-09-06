import {
  DESKTOP_TELEMETRY_SCHEMA_VERSION,
  isDesktopTelemetrySchemaVersion,
} from "../../../shared/desktop-telemetry-contract.mjs";
import { isDesktopTelemetryEvent } from "../../../shared/desktop-telemetry-event.mjs";

export const DESKTOP_TELEMETRY_MAX_BATCH_SIZE = 16;
export const DESKTOP_TELEMETRY_MAX_BODY_BYTES = 32 * 1024;
const MAX_ACTIVITY_AGE_DAYS = 8;

export async function parseDesktopTelemetryRequest(request, {
  maxBodyBytes = DESKTOP_TELEMETRY_MAX_BODY_BYTES,
  now = () => new Date(),
} = {}) {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new TelemetryRequestError(415, "unsupported_media_type");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new TelemetryRequestError(413, "payload_too_large");
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) throw new TelemetryRequestError(400, "empty_payload");
  if (bytes.byteLength > maxBodyBytes) throw new TelemetryRequestError(413, "payload_too_large");

  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TelemetryRequestError(400, "invalid_json");
  }

  if (!hasExactKeys(payload, ["events", "schema_version", "sent_at"])) {
    throw new TelemetryRequestError(400, "invalid_envelope");
  }
  if (!isDesktopTelemetrySchemaVersion(payload.schema_version)) {
    throw new TelemetryRequestError(400, "unsupported_schema");
  }
  if (!isCanonicalTimestamp(payload.sent_at)) {
    throw new TelemetryRequestError(400, "invalid_sent_at");
  }
  if (
    !Array.isArray(payload.events)
    || payload.events.length === 0
    || payload.events.length > DESKTOP_TELEMETRY_MAX_BATCH_SIZE
    || !payload.events.every(isDesktopTelemetryEvent)
    || (payload.schema_version === 1 && payload.events.some((event) => event.schema_version !== 1))
    || (payload.schema_version === DESKTOP_TELEMETRY_SCHEMA_VERSION
      && payload.events.some((event) => event.schema_version > DESKTOP_TELEMETRY_SCHEMA_VERSION))
  ) {
    throw new TelemetryRequestError(400, "invalid_events");
  }

  const currentDay = toUtcDay(now());
  const firstAcceptedDay = addUtcDays(currentDay, -MAX_ACTIVITY_AGE_DAYS);
  if (payload.events.some((event) => (
    event.activity_day < firstAcceptedDay || event.activity_day > currentDay
  ))) {
    throw new TelemetryRequestError(400, "activity_day_out_of_range");
  }

  return Object.freeze({
    schemaVersion: payload.schema_version,
    sentAt: payload.sent_at,
    events: Object.freeze([...payload.events]),
  });
}

export class TelemetryRequestError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "TelemetryRequestError";
    this.status = status;
    this.code = code;
  }
}

function isJsonContentType(value) {
  return typeof value === "string" && value.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

function hasExactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function toUtcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("A valid telemetry server time is required.");
  return date.toISOString().slice(0, 10);
}

function addUtcDays(day, amount) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
