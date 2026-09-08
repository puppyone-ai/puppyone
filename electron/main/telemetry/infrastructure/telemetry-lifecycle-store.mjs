import { createAtomicJsonFile } from "./atomic-json-file.mjs";

const LIFECYCLE_VERSION = 1;
const COHORT_STATUSES = new Set(["fresh", "baseline"]);

export function createTelemetryLifecycleStore({ filePath, fsModule }) {
  const file = createAtomicJsonFile({ filePath, fsModule });

  return Object.freeze({
    async read() {
      return normalizeLifecycle(await file.read());
    },

    async write(lifecycle) {
      const normalized = requireLifecycle(lifecycle);
      await file.write(normalized);
      return normalized;
    },
  });
}

export function createInitialTelemetryLifecycle({ fresh }) {
  return Object.freeze({
    version: LIFECYCLE_VERSION,
    cohort_status: fresh ? "fresh" : "baseline",
    first_run_utc_day: null,
    first_run_enqueued: !fresh,
  });
}

export function neutralizeTelemetryLifecycle() {
  return createInitialTelemetryLifecycle({ fresh: false });
}

function normalizeLifecycle(value) {
  if (!value || value.version !== LIFECYCLE_VERSION) return null;
  try {
    return requireLifecycle(value);
  } catch {
    return null;
  }
}

function requireLifecycle(value) {
  if (!value || value.version !== LIFECYCLE_VERSION || !COHORT_STATUSES.has(value.cohort_status)) {
    throw new TypeError("A valid telemetry lifecycle is required.");
  }
  const fresh = value.cohort_status === "fresh";
  const firstRunEnqueued = value.first_run_enqueued === true;
  if (!fresh && !firstRunEnqueued) {
    throw new TypeError("A baseline telemetry lifecycle must not enqueue a first-run event.");
  }
  const firstRunUtcDay = fresh && firstRunEnqueued
    ? normalizeUtcDay(value.first_run_utc_day)
    : null;
  return Object.freeze({
    version: LIFECYCLE_VERSION,
    cohort_status: value.cohort_status,
    first_run_utc_day: firstRunUtcDay,
    first_run_enqueued: firstRunEnqueued,
  });
}

function normalizeUtcDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("A valid first-run UTC day is required.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TypeError("A valid first-run UTC day is required.");
  }
  return value;
}
