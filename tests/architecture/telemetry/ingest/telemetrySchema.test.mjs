import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createDesktopDailyActiveEvent,
  createDesktopFirstRunEvent,
} from "../../../../shared/desktop-telemetry-event.mjs";
import { createD1TelemetryRepository } from "../../../../cloudflare/desktop-telemetry/src/d1-telemetry-repository.mjs";

describe("Cloudflare D1 Desktop telemetry repository", () => {
  it("defines exact unique sets without network or workspace columns", async () => {
    const initialMigration = await fs.readFile(new URL(
      "../../../../cloudflare/desktop-telemetry/migrations/0001_initial.sql",
      import.meta.url,
    ), "utf8");
    const retentionMigration = await fs.readFile(new URL(
      "../../../../cloudflare/desktop-telemetry/migrations/0002_first_run_retention.sql",
      import.meta.url,
    ), "utf8");
    const migration = `${initialMigration}\n${retentionMigration}`;

    expect(migration).toContain("PRIMARY KEY (activity_day, anonymous_id)");
    expect(migration).toContain("PRIMARY KEY (activity_month, anonymous_id)");
    expect(migration).toContain("telemetry_rollups");
    expect(migration).toContain("PRIMARY KEY (activity_day, retention_id)");
    expect(migration).toContain("PRIMARY KEY (cohort_day, retention_week)");
    expect(migration).not.toMatch(/ip_address|user_agent|email|account|workspace|repository/i);
  });
});
