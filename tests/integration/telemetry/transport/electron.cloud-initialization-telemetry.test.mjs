import { describe, expect, it, vi } from "vitest";
import { createCloudInitializationTelemetry } from "../../../../electron/main/cloud-initialization/telemetry.mjs";

describe("Cloud initialization telemetry", () => {
  it("emits only the structured allowlist and truncates commit identifiers", () => {
    const logger = { info: vi.fn() };
    const telemetry = createCloudInitializationTelemetry({
      logger,
      now: () => Date.parse("2026-07-18T00:00:00.000Z"),
    });

    telemetry.record("push_attempt_failed", {
      operation_id: "operation-1",
      attempt_id: "attempt-2",
      project_id: "project-3",
      commit_oid: "0123456789abcdef0123456789abcdef01234567",
      error_code: "PUSH_FAILED",
      attempt_count: 2,
      secret: "pwg_must_not_log",
      remote_url: "https://token:secret@example.test/git/project-3.git",
      root_path: "/Users/private/repository",
    });

    expect(logger.info).toHaveBeenCalledWith("puppyone.cloud_initialization", {
      event: "push_attempt_failed",
      occurred_at: "2026-07-18T00:00:00.000Z",
      operation_id: "operation-1",
      attempt_id: "attempt-2",
      project_id: "project-3",
      commit_oid: "0123456789ab",
      error_code: "PUSH_FAILED",
      attempt_count: 2,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/pwg_|token:secret|\/Users\/private/);
  });
});
