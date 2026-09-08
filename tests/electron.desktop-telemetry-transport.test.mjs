import { describe, expect, it, vi } from "vitest";
import { createDesktopDailyActiveEvent } from "../electron/main/telemetry/domain/daily-active-event.mjs";
import {
  createTelemetryHttpTransport,
  normalizeTelemetryEndpoint,
} from "../electron/main/telemetry/infrastructure/telemetry-http-transport.mjs";

describe("Desktop telemetry HTTP transport", () => {
  it("posts only the versioned event batch to a pinned HTTPS endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 202 }));
    const transport = createTelemetryHttpTransport({
      endpoint: "https://telemetry.puppyone.ai/v1/desktop/events",
      fetchImpl,
      now: () => new Date("2026-08-27T08:00:00.000Z"),
    });
    const event = createDesktopDailyActiveEvent({
      activityDay: "2026-08-27",
      anonymousId: `m1_${"b".repeat(43)}`,
      appVersion: "0.3.10",
      architecture: "arm64",
      eventId: "123e4567-e89b-42d3-a456-426614174000",
      osMajor: "15",
      platform: "darwin",
      retentionId: `r1_${"c".repeat(43)}`,
    });

    await expect(transport.send([event])).resolves.toEqual({
      acceptedEventIds: [event.event_id],
    });
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://telemetry.puppyone.ai/v1/desktop/events");
    expect(request).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
    expect(JSON.parse(request.body)).toEqual({
      schema_version: 2,
      sent_at: "2026-08-27T08:00:00.000Z",
      events: [event],
    });
  });

  it("refuses insecure or credential-bearing ingestion endpoints", () => {
    expect(() => normalizeTelemetryEndpoint("http://telemetry.puppyone.ai/events")).toThrow(/HTTPS/);
    expect(() => normalizeTelemetryEndpoint("https://token@example.com/events")).toThrow(/credentials/);
    expect(() => normalizeTelemetryEndpoint("https://example.com/events?secret=1")).toThrow(/query/);
  });
});
