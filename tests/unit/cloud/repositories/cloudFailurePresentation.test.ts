import { describe, expect, it } from "vitest";
import { describeCloudConnectionFailure, describeCloudOpeningFailure } from "../../../../src/features/cloud/cloudOpeningFailure";

describe("Cloud opening reasons", () => {
  it.each([
    [{ code: "CLOUD_TRANSPORT_UNAVAILABLE" }, "connection-unreachable"],
    [{ code: "CLOUD_REQUEST_TIMEOUT" }, "connection-timeout"],
    [{ status: 503, code: "project_authorization_unreachable" }, "access-check-unreachable"],
    [{ status: 503, code: "project_authorization_timeout" }, "access-check-timeout"],
    [{ status: 503, code: "project_authorization_unavailable" }, "access-check-unavailable"],
    [{ status: 503, code: "database_schema_outdated" }, "service-updating"],
    [{ status: 503, code: "workbench_connection_unavailable" }, "workspace-connection-unavailable"],
    [{ status: 503 }, "service-unavailable"],
    [{ status: 502 }, "service-unavailable"],
    [{ status: 504 }, "connection-timeout"],
    [{ status: 429 }, "service-busy"],
    [{ status: 426 }, "app-update-required"],
  ])("uses structured evidence %j", (error, code) => {
    const cause = Object.assign(new Error("https://secret@private-db failure"), error);
    expect(describeCloudConnectionFailure(cause)?.code).toBe(code);
    expect(describeCloudOpeningFailure(cause).message.code).toBe(code);
    expect(JSON.stringify(describeCloudOpeningFailure(cause))).not.toMatch(/secret|private-db/);
  });

  it.each([401, 403, 404])("keeps HTTP %s access outcomes ahead of dependency hints", (status) => {
    expect(describeCloudConnectionFailure({ status, code: "project_authorization_unreachable" })).toBeNull();
    expect(describeCloudOpeningFailure({ status, code: "project_authorization_unreachable" }).action).not.toBe("retry");
  });

  it("never guesses proxy failure or migration from exception text", () => {
    expect(describeCloudConnectionFailure(new Error("proxy database migration failure"))).toBeNull();
    expect(describeCloudConnectionFailure({ status: 503, code: "private_customer_key" }))
      .toEqual({ code: "service-unavailable", diagnostic: { status: 503 } });
    expect(describeCloudConnectionFailure({ code: "constructor" })).toBeNull();
  });

  it("keeps existing workspace configuration and protocol failures nonretryable", () => {
    expect(describeCloudOpeningFailure({ status: 503, code: "workbench_provider_not_configured" }, "workspace"))
      .toMatchObject({ message: { code: "workspace-not-configured" }, action: "none" });
    expect(describeCloudOpeningFailure({ status: 426 })).toMatchObject({ action: "none" });
  });

  it("retains the failed workspace operation when the server gives no specific cause", () => {
    expect(describeCloudOpeningFailure({ status: 503 }, "workspace"))
      .toMatchObject({ message: { code: "workspace-open-failed" }, action: "retry" });
  });
});
