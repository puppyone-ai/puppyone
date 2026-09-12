import { describe, expect, it, vi } from "vitest";
import { createDesktopTelemetryService } from "../../../../electron/main/telemetry/application/desktop-telemetry-service.mjs";
import { createDefaultTelemetryPreference } from "../../../../electron/main/telemetry/infrastructure/telemetry-preference-store.mjs";
import { createEmptyTelemetryQueue } from "../../../../electron/main/telemetry/infrastructure/telemetry-queue-store.mjs";
import { neutralizeTelemetryLifecycle } from "../../../../electron/main/telemetry/infrastructure/telemetry-lifecycle-store.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";

const commitSha = "e".repeat(40);

describe("Desktop telemetry service", () => {
  it("keeps default-on Stable analytics dormant until the notice is shown", async () => {
    const fixture = createServiceFixture();
    await fixture.service.start();

    expect(fixture.service.getSnapshot()).toMatchObject({
      defaultLevel: "basic",
      level: "basic",
      effectiveLevel: "off",
      enabled: false,
      noticeRequired: true,
      disabledReason: "notice-required",
    });
    expect(await fixture.service.noteForegroundActivity()).toMatchObject({ enqueued: false });
    expect(fixture.transport.send).not.toHaveBeenCalled();
  });

  it("sends at most one allowlisted activity event per UTC day", async () => {
    const fixture = createServiceFixture();
    await fixture.service.start();
    await fixture.service.markNoticeSeen();

    expect(await fixture.service.noteForegroundActivity()).toMatchObject({ enqueued: true });
    expect(await fixture.service.noteForegroundActivity()).toMatchObject({ enqueued: false });
    await fixture.service.flush();

    expect(fixture.transport.send).toHaveBeenCalledTimes(1);
    const first = fixture.transport.send.mock.calls[0][0][0];
    expect(first).toMatchObject({
      event: "desktop_daily_active",
      activity_day: "2026-08-27",
      anonymous_id: `m1_${"a".repeat(43)}`,
      properties: {
        app_version: "0.3.10",
        platform: "darwin",
        architecture: "arm64",
        os_major: "15",
      },
    });
    expect(fixture.service.getSnapshot().queuedEventCount).toBe(0);

    fixture.setNow("2026-08-28T08:00:00.000Z");
    expect(await fixture.service.noteForegroundActivity()).toMatchObject({ enqueued: true });
    await fixture.service.flush();
    expect(fixture.transport.send).toHaveBeenCalledTimes(2);
  });

  it("queues one first-run cohort signal alongside the first daily activity for a fresh install", async () => {
    const fixture = createServiceFixture({ hasStoredIdentity: false });
    await fixture.service.start();
    await fixture.service.markNoticeSeen();

    expect(await fixture.service.noteForegroundActivity()).toMatchObject({ enqueued: true });
    expect(await fixture.service.noteForegroundActivity()).toMatchObject({ enqueued: false });
    expect(fixture.readQueue().events.map((event) => event.event)).toEqual([
      "desktop_first_run",
      "desktop_daily_active",
    ]);
    expect(fixture.readLifecycle()).toEqual({
      version: 1,
      cohort_status: "fresh",
      first_run_utc_day: "2026-08-27",
      first_run_enqueued: true,
    });

    await fixture.service.flush();
    expect(fixture.transport.send).toHaveBeenCalledTimes(1);
    expect(fixture.transport.send.mock.calls[0][0]).toEqual([
      expect.objectContaining({ event: "desktop_first_run", retention_id: `r1_${"b".repeat(43)}` }),
      expect.objectContaining({ event: "desktop_daily_active", retention_id: `r1_${"b".repeat(43)}` }),
    ]);
  });

  it("clears queued events and the local identity immediately when switched off", async () => {
    const fixture = createServiceFixture();
    await fixture.service.start();
    await fixture.service.markNoticeSeen();
    await fixture.service.noteForegroundActivity();
    expect(fixture.service.getSnapshot().queuedEventCount).toBe(1);

    await fixture.service.setLevel("off");

    expect(fixture.service.getSnapshot()).toMatchObject({
      level: "off",
      enabled: false,
      queuedEventCount: 0,
      disabledReason: "level-off",
    });
    expect(fixture.identityStore.clear).toHaveBeenCalledTimes(1);
    expect(fixture.queueStore.clear).toHaveBeenCalledTimes(1);
    expect(fixture.readLifecycle()).toEqual(neutralizeTelemetryLifecycle());
  });

  it("treats an explicit Basic selection as acknowledgment of the current notice", async () => {
    const fixture = createServiceFixture();
    await fixture.service.start();

    expect(fixture.service.getSnapshot().noticeRequired).toBe(true);
    await fixture.service.setLevel("basic");

    expect(fixture.service.getSnapshot()).toMatchObject({
      enabled: true,
      noticeRequired: false,
      noticeSeenVersion: 2,
    });
  });

  it("stops sending the retention ID after the bounded 100-day measurement window", async () => {
    const fixture = createServiceFixture({ hasStoredIdentity: false });
    await fixture.service.start();
    await fixture.service.markNoticeSeen();
    await fixture.service.noteForegroundActivity();
    await fixture.service.flush();

    fixture.setNow("2026-12-05T07:00:00.000Z");
    await fixture.service.noteForegroundActivity();

    const event = fixture.readQueue().events[0];
    expect(event).toMatchObject({ event: "desktop_daily_active", activity_day: "2026-12-05" });
    expect(event).not.toHaveProperty("retention_id");
  });

  it("keeps the default-on preference without sending from unpackaged or non-Stable builds", async () => {
    const devBuild = resolveDesktopBuildIdentity({
      baseVersion: "0.3.10",
      channel: "dev",
      commitSha,
    });
    const fixture = createServiceFixture({ buildInfo: devBuild, isPackaged: false });
    await fixture.service.start();
    await fixture.service.markNoticeSeen();

    expect(fixture.service.getSnapshot()).toMatchObject({
      eligible: false,
      defaultLevel: "basic",
      level: "basic",
      effectiveLevel: "off",
      disabledReason: "unpackaged-build",
    });
    expect(await fixture.service.noteForegroundActivity()).toMatchObject({ enqueued: false });
  });

  it("retains a retryable batch without logging event payloads", async () => {
    const fixture = createServiceFixture();
    fixture.transport.send.mockRejectedValueOnce(Object.assign(new Error("offline"), { retryable: true }));
    await fixture.service.start();
    await fixture.service.markNoticeSeen();
    await fixture.service.noteForegroundActivity();
    await fixture.service.flush();

    expect(fixture.service.getSnapshot().queuedEventCount).toBe(1);
    expect(fixture.logger.warn).toHaveBeenCalledWith(
      "Desktop telemetry delivery failed.",
      { retryable: true, status: null },
    );
  });

  it("retains only seven calendar activity days without storing time-of-day", async () => {
    const fixture = createServiceFixture();
    fixture.transport.send.mockRejectedValue(Object.assign(new Error("offline"), { retryable: true }));
    await fixture.service.start();
    await fixture.service.markNoticeSeen();

    for (let day = 20; day <= 27; day += 1) {
      fixture.setNow(`2026-08-${day}T23:59:59.999Z`);
      await fixture.service.noteForegroundActivity();
    }
    await fixture.service.flush();

    expect(fixture.service.getSnapshot().queuedEventCount).toBe(7);
    const persistedEvents = fixture.queueStore.write.mock.calls.at(-1)[0].events;
    expect(persistedEvents[0].activity_day).toBe("2026-08-21");
    expect(JSON.stringify(persistedEvents)).not.toMatch(/23:59:59|occurred_at/);
  });
});

function createServiceFixture({
  buildInfo = resolveDesktopBuildIdentity({
    baseVersion: "0.3.10",
    buildNumber: 10,
    channel: "stable",
    commitSha,
  }),
  defaultLevel = "basic",
  hasStoredIdentity = true,
  initialLifecycle = null,
  isPackaged = true,
} = {}) {
  let currentNow = new Date("2026-08-27T07:00:00.000Z");
  let preference = createDefaultTelemetryPreference(defaultLevel);
  let queue = createEmptyTelemetryQueue();
  let lifecycle = initialLifecycle;
  const preferenceStore = {
    read: vi.fn(async () => preference),
    write: vi.fn(async (value) => {
      preference = Object.freeze({ ...value, version: 1 });
      return preference;
    }),
  };
  const queueStore = {
    read: vi.fn(async () => queue),
    write: vi.fn(async (value) => {
      queue = Object.freeze({
        version: 1,
        last_enqueued_utc_day: value.last_enqueued_utc_day ?? null,
        events: Object.freeze([...(value.events ?? [])]),
      });
      return queue;
    }),
    clear: vi.fn(async () => {
      queue = createEmptyTelemetryQueue();
      return queue;
    }),
  };
  const identityStore = {
    hasStoredIdentity: vi.fn(async () => hasStoredIdentity),
    getMonthlyAnonymousId: vi.fn(async () => `m1_${"a".repeat(43)}`),
    getRetentionAnonymousId: vi.fn(async () => `r1_${"b".repeat(43)}`),
    clear: vi.fn(async () => undefined),
  };
  const lifecycleStore = {
    read: vi.fn(async () => lifecycle),
    write: vi.fn(async (value) => {
      lifecycle = Object.freeze({ ...value, version: 1 });
      return lifecycle;
    }),
  };
  const transport = {
    send: vi.fn(async (events) => ({ acceptedEventIds: events.map((event) => event.event_id) })),
  };
  const logger = { warn: vi.fn() };
  const timers = [];
  const service = createDesktopTelemetryService({
    architecture: "arm64",
    buildInfo,
    identityStore,
    isPackaged,
    lifecycleStore,
    logger,
    now: () => new Date(currentNow),
    osMajor: "15",
    platform: "darwin",
    preferenceStore,
    queueStore,
    random: () => 0.5,
    randomUUID: createUuidSequence(),
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref: () => undefined };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
    transport,
  });
  return {
    identityStore,
    lifecycleStore,
    logger,
    preferenceStore,
    queueStore,
    readLifecycle: () => lifecycle,
    readQueue: () => queue,
    service,
    setNow: (value) => { currentNow = new Date(value); },
    timers,
    transport,
  };
}

function createUuidSequence() {
  let next = 1;
  return () => `123e4567-e89b-42d3-a456-${String(next++).padStart(12, "0")}`;
}
