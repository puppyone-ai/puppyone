import { describe, expect, it } from "vitest";
import {
  getDesktopTelemetryDisclosure,
} from "../shared/desktop-telemetry-contract.mjs";
import {
  createDesktopDailyActiveEvent,
  createDesktopFirstRunEvent,
  isDesktopTelemetryEvent,
} from "../electron/main/telemetry/domain/daily-active-event.mjs";

const validEvent = () => createDesktopDailyActiveEvent({
  activityDay: "2026-08-27",
  anonymousId: `m1_${"a".repeat(43)}`,
  appVersion: "0.3.10",
  architecture: "arm64",
  eventId: "123e4567-e89b-42d3-a456-426614174000",
  osMajor: "15.6.1",
  platform: "darwin",
  retentionId: `r1_${"b".repeat(43)}`,
});

describe("Desktop telemetry public contract", () => {
  it("projects a fixed daily-active payload without workspace or account fields", () => {
    const event = validEvent();

    expect(event).toEqual({
      schema_version: 2,
      event_id: "123e4567-e89b-42d3-a456-426614174000",
      event: "desktop_daily_active",
      activity_day: "2026-08-27",
      anonymous_id: `m1_${"a".repeat(43)}`,
      retention_id: `r1_${"b".repeat(43)}`,
      properties: {
        app_version: "0.3.10",
        platform: "darwin",
        architecture: "arm64",
        os_major: "15",
        notice_version: 2,
      },
    });
    expect(JSON.stringify(event)).not.toMatch(/path|prompt|account|email|remote|repository/i);
    expect(isDesktopTelemetryEvent(event)).toBe(true);
  });

  it("rejects payloads with unregistered fields", () => {
    const event = validEvent();
    expect(isDesktopTelemetryEvent({ ...event, workspace_path: "/private/project" })).toBe(false);
    expect(isDesktopTelemetryEvent({
      ...event,
      properties: { ...event.properties, locale: "en-US" },
    })).toBe(false);
  });

  it("omits the retention ID from daily activity outside the cohort window", () => {
    const event = createDesktopDailyActiveEvent({
      activityDay: "2026-12-05",
      anonymousId: `m1_${"a".repeat(43)}`,
      appVersion: "0.3.10",
      architecture: "arm64",
      eventId: "123e4567-e89b-42d3-a456-426614174001",
      osMajor: "15",
      platform: "darwin",
    });

    expect(event).not.toHaveProperty("retention_id");
    expect(isDesktopTelemetryEvent(event)).toBe(true);
  });

  it("rejects timestamps and invalid calendar days", () => {
    expect(() => createDesktopDailyActiveEvent({
      activityDay: "2026-08-27T07:00:00.000Z",
      anonymousId: `m1_${"a".repeat(43)}`,
      appVersion: "0.3.10",
      architecture: "arm64",
      eventId: "123e4567-e89b-42d3-a456-426614174000",
      osMajor: "15",
      platform: "darwin",
      retentionId: `r1_${"b".repeat(43)}`,
    })).toThrow(/activity day/);
    expect(isDesktopTelemetryEvent({ ...validEvent(), activity_day: "2026-02-30" })).toBe(false);
  });

  it("publishes the complete event disclosure from the shared contract", () => {
    const disclosure = getDesktopTelemetryDisclosure();
    expect(disclosure.events).toHaveLength(2);
    expect(disclosure.events[0]).toMatchObject({
      name: "desktop_first_run",
    });
    expect(disclosure.events[1]).toMatchObject({
      name: "desktop_daily_active",
    });
    expect(disclosure.neverCollected).toContain("file contents");
  });

  it("allows exactly one first-run event shape with the onboarding contract", () => {
    const event = createDesktopFirstRunEvent({
      activityDay: "2026-08-27",
      anonymousId: `m1_${"a".repeat(43)}`,
      appVersion: "0.3.10",
      architecture: "arm64",
      eventId: "123e4567-e89b-42d3-a456-426614174000",
      osMajor: "15",
      platform: "darwin",
      retentionId: `r1_${"b".repeat(43)}`,
    });

    expect(event).toMatchObject({
      schema_version: 2,
      event: "desktop_first_run",
      retention_id: `r1_${"b".repeat(43)}`,
      properties: { notice_version: 2, onboarding_version: 1 },
    });
    expect(isDesktopTelemetryEvent(event)).toBe(true);
    expect(isDesktopTelemetryEvent({
      ...event,
      properties: { ...event.properties, onboarding_version: 2 },
    })).toBe(false);
  });

  it("continues to validate the exact legacy schema for queued and deployed clients", () => {
    const legacy = {
      schema_version: 1,
      event_id: "123e4567-e89b-42d3-a456-426614174000",
      event: "desktop_daily_active",
      activity_day: "2026-08-27",
      anonymous_id: `m1_${"a".repeat(43)}`,
      properties: {
        app_version: "0.3.10",
        platform: "darwin",
        architecture: "arm64",
        os_major: "15",
        notice_version: 1,
      },
    };

    expect(isDesktopTelemetryEvent(legacy)).toBe(true);
    expect(isDesktopTelemetryEvent({ ...legacy, retention_id: `r1_${"b".repeat(43)}` })).toBe(false);
  });
});
