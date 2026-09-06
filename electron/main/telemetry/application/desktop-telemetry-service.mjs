import { randomUUID as nodeRandomUUID } from "node:crypto";
import { assertDesktopBuildInfo } from "../../../../shared/desktop-build-identity.mjs";
import {
  DESKTOP_TELEMETRY_NOTICE_VERSION,
  DESKTOP_TELEMETRY_SCHEMA_VERSION,
  getDesktopTelemetryDisclosure,
  isDesktopTelemetryLevel,
} from "../../../../shared/desktop-telemetry-contract.mjs";
import {
  createDesktopDailyActiveEvent,
  createDesktopFirstRunEvent,
} from "../domain/daily-active-event.mjs";
import {
  createInitialTelemetryLifecycle,
  neutralizeTelemetryLifecycle,
} from "../infrastructure/telemetry-lifecycle-store.mjs";

const MAX_BATCH_SIZE = 16;
const QUEUE_RETENTION_DAYS = 7;
const RETENTION_MEASUREMENT_DAYS = 100;
const RETRY_BASE_DELAY_MS = 60 * 1000;
const RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

export function createDesktopTelemetryService({
  architecture,
  buildInfo,
  identityStore,
  isPackaged,
  lifecycleStore,
  logger = console,
  now = () => new Date(),
  osMajor,
  platform,
  preferenceStore,
  queueStore,
  random = Math.random,
  randomUUID = nodeRandomUUID,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  transport = null,
}) {
  const identity = assertDesktopBuildInfo(buildInfo);
  requirePort(identityStore, "identityStore", [
    "clear",
    "getMonthlyAnonymousId",
    "getRetentionAnonymousId",
    "hasStoredIdentity",
  ]);
  requirePort(lifecycleStore, "lifecycleStore", ["read", "write"]);
  requirePort(preferenceStore, "preferenceStore", ["read", "write"]);
  requirePort(queueStore, "queueStore", ["read", "write", "clear"]);

  const eligibility = resolveTelemetryEligibility({ buildInfo: identity, isPackaged });
  const listeners = new Set();
  let preference = null;
  let queue = null;
  let lifecycle = null;
  let started = false;
  let disposed = false;
  let initializationPromise = null;
  let mutationQueue = Promise.resolve();
  let flushPromise = null;
  let retryTimer = null;
  let retryAttempt = 0;

  const serialize = (operation) => {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.catch(() => undefined);
    return next;
  };

  async function initialize() {
    if (preference && queue && lifecycle) return snapshot();
    if (!initializationPromise) {
      initializationPromise = Promise.all([
        identityStore.hasStoredIdentity(),
        lifecycleStore.read(),
        preferenceStore.read(),
        queueStore.read(),
      ]).then(async ([hasStoredIdentity, storedLifecycle, storedPreference, storedQueue]) => {
        preference = storedPreference;
        queue = storedQueue;
        lifecycle = storedLifecycle ?? await lifecycleStore.write(createInitialTelemetryLifecycle({
          fresh: !hasPriorTelemetryState({ hasStoredIdentity, preference, queue }),
        }));
        return snapshot();
      }).catch((error) => {
        initializationPromise = null;
        throw error;
      });
    }
    return initializationPromise;
  }

  async function start() {
    if (started) return initialize();
    started = true;
    const state = await initialize();
    if (state.enabled && queue.events.length > 0) scheduleFlush(0);
    return state;
  }

  function snapshot() {
    if (!preference || !queue || !lifecycle) throw new Error("Desktop telemetry has not been initialized.");
    const reason = getDisabledReason();
    return Object.freeze({
      schemaVersion: DESKTOP_TELEMETRY_SCHEMA_VERSION,
      defaultLevel: eligibility.defaultLevel,
      level: preference.level,
      effectiveLevel: reason ? "off" : preference.level,
      enabled: reason === null,
      eligible: eligibility.eligible,
      disabledReason: reason,
      noticeVersion: DESKTOP_TELEMETRY_NOTICE_VERSION,
      noticeSeenVersion: preference.notice_seen_version,
      noticeRequired: eligibility.eligible
        && preference.level !== "off"
        && preference.notice_seen_version < DESKTOP_TELEMETRY_NOTICE_VERSION,
      transportConfigured: Boolean(transport),
      queuedEventCount: queue.events.length,
    });
  }

  function getDisabledReason() {
    if (!eligibility.eligible) return eligibility.reason;
    if (preference.level === "off") return "level-off";
    if (preference.notice_seen_version < DESKTOP_TELEMETRY_NOTICE_VERSION) return "notice-required";
    if (!transport) return "transport-unconfigured";
    return null;
  }

  async function markNoticeSeen() {
    return serialize(async () => {
      await initialize();
      if (preference.notice_seen_version >= DESKTOP_TELEMETRY_NOTICE_VERSION) return snapshot();
      preference = await preferenceStore.write({
        ...preference,
        notice_seen_version: DESKTOP_TELEMETRY_NOTICE_VERSION,
        updated_at: now().toISOString(),
      });
      publish();
      return snapshot();
    });
  }

  async function setLevel(level) {
    if (!isDesktopTelemetryLevel(level)) throw new TypeError("Unsupported desktop telemetry level.");
    return serialize(async () => {
      await initialize();
      const acknowledgeCurrentNotice = level === "basic"
        && preference.notice_seen_version < DESKTOP_TELEMETRY_NOTICE_VERSION;
      if (preference.level !== level || acknowledgeCurrentNotice) {
        preference = await preferenceStore.write({
          ...preference,
          level,
          notice_seen_version: acknowledgeCurrentNotice
            ? DESKTOP_TELEMETRY_NOTICE_VERSION
            : preference.notice_seen_version,
          updated_at: now().toISOString(),
        });
      }
      if (level === "off") {
        cancelRetry();
        queue = await queueStore.clear();
        await identityStore.clear();
        lifecycle = await lifecycleStore.write(neutralizeTelemetryLifecycle());
      }
      publish();
      return snapshot();
    });
  }

  async function resetIdentity() {
    return serialize(async () => {
      await initialize();
      cancelRetry();
      await identityStore.clear();
      queue = await queueStore.clear();
      lifecycle = await lifecycleStore.write(neutralizeTelemetryLifecycle());
      publish();
      return snapshot();
    });
  }

  async function noteForegroundActivity() {
    return serialize(async () => {
      await initialize();
      if (getDisabledReason()) return { enqueued: false, state: snapshot() };
      const currentTime = now();
      const utcDay = currentTime.toISOString().slice(0, 10);
      const shouldEnqueueFirstRun = lifecycle.cohort_status === "fresh"
        && lifecycle.first_run_enqueued !== true;
      const shouldEnqueueDailyActive = queue.last_enqueued_utc_day !== utcDay;
      if (!shouldEnqueueFirstRun && !shouldEnqueueDailyActive) {
        if (queue.events.length > 0) scheduleFlush(0);
        return { enqueued: false, state: snapshot() };
      }
      const shouldIncludeRetention = shouldEnqueueFirstRun
        || isWithinRetentionMeasurementWindow(lifecycle.first_run_utc_day, utcDay);
      const anonymousId = await identityStore.getMonthlyAnonymousId(currentTime);
      const retentionId = shouldIncludeRetention
        ? await identityStore.getRetentionAnonymousId()
        : undefined;
      const events = [];
      if (shouldEnqueueFirstRun) {
        events.push(createDesktopFirstRunEvent({
          activityDay: utcDay,
          anonymousId,
          appVersion: identity.version,
          architecture,
          eventId: randomUUID(),
          osMajor,
          platform,
          retentionId,
        }));
      }
      if (shouldEnqueueDailyActive) {
        events.push(createDesktopDailyActiveEvent({
          activityDay: utcDay,
          anonymousId,
          appVersion: identity.version,
          architecture,
          eventId: randomUUID(),
          osMajor,
          platform,
          retentionId,
        }));
      }
      queue = await queueStore.write({
        version: queue.version,
        last_enqueued_utc_day: shouldEnqueueDailyActive ? utcDay : queue.last_enqueued_utc_day,
        events: [...queue.events, ...events].slice(-32),
      });
      if (shouldEnqueueFirstRun) {
        lifecycle = await lifecycleStore.write({
          ...lifecycle,
          first_run_utc_day: utcDay,
          first_run_enqueued: true,
        });
      }
      publish();
      scheduleFlush(0);
      return { enqueued: true, state: snapshot() };
    });
  }

  async function flush() {
    await initialize();
    if (flushPromise) return flushPromise;
    if (getDisabledReason() || queue.events.length === 0) return snapshot();
    flushPromise = serialize(async () => {
      if (getDisabledReason() || queue.events.length === 0) return snapshot();
      const firstRetainedDay = getFirstRetainedUtcDay(now(), QUEUE_RETENTION_DAYS);
      const retained = queue.events.filter((event) => event.activity_day >= firstRetainedDay);
      if (retained.length !== queue.events.length) {
        queue = await queueStore.write({ ...queue, events: retained });
      }
      if (queue.events.length === 0) {
        publish();
        return snapshot();
      }

      const batch = queue.events.slice(0, MAX_BATCH_SIZE);
      try {
        const result = await transport.send(batch);
        const accepted = new Set(result?.acceptedEventIds ?? batch.map((event) => event.event_id));
        queue = await queueStore.write({
          ...queue,
          events: queue.events.filter((event) => !accepted.has(event.event_id)),
        });
        retryAttempt = 0;
        cancelRetry();
        publish();
        if (queue.events.length > 0) scheduleFlush(0);
      } catch (error) {
        logger.warn?.("Desktop telemetry delivery failed.", {
          retryable: error?.retryable !== false,
          status: Number.isInteger(error?.status) ? error.status : null,
        });
        if (error?.retryable === false) {
          const rejected = new Set(batch.map((event) => event.event_id));
          queue = await queueStore.write({
            ...queue,
            events: queue.events.filter((event) => !rejected.has(event.event_id)),
          });
          retryAttempt = 0;
          publish();
          if (queue.events.length > 0) scheduleFlush(0);
        } else {
          scheduleRetry();
        }
      }
      return snapshot();
    }).finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  }

  function scheduleFlush(delay) {
    if (disposed || retryTimer || !transport) return;
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      void flush().catch((error) => {
        logger.warn?.("Desktop telemetry flush failed before delivery.", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }, delay);
    retryTimer?.unref?.();
  }

  function scheduleRetry() {
    if (disposed || retryTimer) return;
    const exponential = Math.min(RETRY_BASE_DELAY_MS * (2 ** retryAttempt), RETRY_MAX_DELAY_MS);
    retryAttempt += 1;
    const jitter = 0.8 + (Math.max(0, Math.min(1, random())) * 0.4);
    scheduleFlush(Math.round(exponential * jitter));
  }

  function cancelRetry() {
    if (retryTimer) clearTimeoutFn(retryTimer);
    retryTimer = null;
  }

  function publish() {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }

  function dispose() {
    disposed = true;
    cancelRetry();
    listeners.clear();
  }

  return Object.freeze({
    dispose,
    flush,
    getDisclosure: getDesktopTelemetryDisclosure,
    getSnapshot: snapshot,
    initialize,
    markNoticeSeen,
    noteForegroundActivity,
    onDidChange(listener) {
      if (typeof listener !== "function") throw new TypeError("Telemetry listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resetIdentity,
    setLevel,
    start,
  });
}

export function resolveTelemetryEligibility({ buildInfo, isPackaged }) {
  const identity = assertDesktopBuildInfo(buildInfo);
  if (!isPackaged) {
    return Object.freeze({ eligible: false, defaultLevel: "basic", reason: "unpackaged-build" });
  }
  if (identity.channel !== "stable") {
    return Object.freeze({ eligible: false, defaultLevel: "basic", reason: "non-stable-build" });
  }
  return Object.freeze({ eligible: true, defaultLevel: "basic", reason: null });
}

function requirePort(value, name, methods) {
  if (!value || methods.some((method) => typeof value[method] !== "function")) {
    throw new TypeError(`A valid ${name} port is required.`);
  }
}

function hasPriorTelemetryState({ hasStoredIdentity, preference, queue }) {
  return hasStoredIdentity
    || preference.notice_seen_version > 0
    || preference.updated_at !== null
    || queue.last_enqueued_utc_day !== null
    || queue.events.length > 0;
}

function getFirstRetainedUtcDay(value, retentionDays) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("A valid telemetry retention time is required.");
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (retentionDays - 1));
  return date.toISOString().slice(0, 10);
}

function isWithinRetentionMeasurementWindow(firstRunDay, activityDay) {
  if (!firstRunDay) return false;
  const first = new Date(`${firstRunDay}T00:00:00.000Z`);
  const activity = new Date(`${activityDay}T00:00:00.000Z`);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(activity.getTime())) return false;
  const elapsedDays = Math.floor((activity.getTime() - first.getTime()) / 86_400_000);
  return elapsedDays >= 0 && elapsedDays < RETENTION_MEASUREMENT_DAYS;
}
