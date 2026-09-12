import { describe, expect, it } from "vitest";

import { mapCloudMutationError } from "../../../../electron/main/cloud-publish-contract.mjs";

describe("Cloud publish structured service compatibility errors", () => {
  it.each([
    "database_schema_outdated",
    "schema_migration_required",
    "service_upgrade_required",
  ])("maps %s without parsing server messages", (code) => {
    const cause = Object.assign(new Error("internal detail must not become product copy"), {
      code,
      status: 503,
    });

    const error = mapCloudMutationError(
      "CREDENTIAL_FAILED",
      "Unable to issue the Project Git credential.",
      cause,
    );

    expect(error.publishCode).toBe("SERVICE_UPGRADE_REQUIRED");
    expect(error.publishRetryable).toBe(true);
    expect(error.message).toBe("PuppyOne Cloud is being upgraded. Resume publishing shortly.");
    expect(error.cause).toBe(cause);
  });

  it("does not infer compatibility failures from an unstructured message", () => {
    const error = mapCloudMutationError(
      "CREDENTIAL_FAILED",
      "Unable to issue the Project Git credential.",
      Object.assign(new Error("database schema outdated"), { status: 500 }),
    );

    expect(error.publishCode).toBe("CREDENTIAL_FAILED");
  });
});
