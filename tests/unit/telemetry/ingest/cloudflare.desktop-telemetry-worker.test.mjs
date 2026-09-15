import { describe, expect, it, vi } from "vitest";
import { createDesktopDailyActiveEvent } from "../../../../shared/desktop-telemetry-event.mjs";
import { createDesktopTelemetryWorker } from "../../../../cloudflare/desktop-telemetry/src/worker.mjs";

const currentTime = new Date("2026-08-27T12:00:00.000Z");

describe("Cloudflare Desktop telemetry Worker", () => {
  it("is fail-closed in paused mode without touching storage", async () => {
    const repository = createRepository();
    const worker = createDesktopTelemetryWorker({
      now: () => currentTime,
      repositoryFactory: () => repository,
    });
    const response = await worker.fetch(createRequest(), { TELEMETRY_MODE: "paused" });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("rate limits by monthly pseudonymous ID and persists a valid batch", async () => {
    const repository = createRepository();
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    const worker = createDesktopTelemetryWorker({
      now: () => currentTime,
      repositoryFactory: () => repository,
    });
    const response = await worker.fetch(createRequest(), {
      DB: {},
      INGEST_RATE_LIMITER: limiter,
      TELEMETRY_MODE: "accept",
    });

    expect(response.status).toBe(202);
    expect(limiter.limit).toHaveBeenCalledWith({ key: `m1_${"a".repeat(43)}` });
    expect(repository.ingest).toHaveBeenCalledWith([createEvent()], currentTime);
    await expect(response.json()).resolves.toEqual({
      accepted_event_ids: ["123e4567-e89b-42d3-a456-426614174000"],
    });
  });

  it("supports a discard kill switch and never persists acknowledged events", async () => {
    const repository = createRepository();
    const worker = createDesktopTelemetryWorker({
      now: () => currentTime,
      repositoryFactory: () => repository,
    });
    const response = await worker.fetch(createRequest(), { TELEMETRY_MODE: "discard" });

    expect(response.status).toBe(202);
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("rejects a rate-limited request before storage", async () => {
    const repository = createRepository();
    const worker = createDesktopTelemetryWorker({
      now: () => currentTime,
      repositoryFactory: () => repository,
    });
    const response = await worker.fetch(createRequest(), {
      DB: {},
      INGEST_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
      TELEMETRY_MODE: "accept",
    });

    expect(response.status).toBe(429);
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("runs exact rollups and pruning from the scheduled handler", async () => {
    const repository = createRepository();
    const worker = createDesktopTelemetryWorker({ repositoryFactory: () => repository });
    await worker.scheduled({ scheduledTime: currentTime.getTime() }, { DB: {} });

    expect(repository.rollupAndPrune).toHaveBeenCalledWith(currentTime);
  });
});

function createRepository() {
  return {
    ingest: vi.fn(async (events) => ({ acceptedEventIds: events.map((event) => event.event_id) })),
    rollupAndPrune: vi.fn(async () => undefined),
  };
}

function createEvent() {
  return createDesktopDailyActiveEvent({
    activityDay: "2026-08-27",
    anonymousId: `m1_${"a".repeat(43)}`,
    appVersion: "0.3.10",
    architecture: "arm64",
    eventId: "123e4567-e89b-42d3-a456-426614174000",
    osMajor: "15",
    platform: "darwin",
    retentionId: `r1_${"b".repeat(43)}`,
  });
}

function createRequest() {
  return new Request("https://telemetry.puppyone.ai/v1/desktop/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema_version: 2,
      sent_at: "2026-08-27T12:00:00.000Z",
      events: [createEvent()],
    }),
  });
}
