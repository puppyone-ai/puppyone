import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInitialTelemetryLifecycle,
  createTelemetryLifecycleStore,
  neutralizeTelemetryLifecycle,
} from "../electron/main/telemetry/infrastructure/telemetry-lifecycle-store.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.promises.rm(directory, { force: true, recursive: true })
  )));
});

describe("Desktop telemetry lifecycle store", () => {
  it("persists a fresh first-run cohort independently from its anonymous identity", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-telemetry-lifecycle-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "lifecycle-v1.json");
    const store = createTelemetryLifecycleStore({ filePath });

    await expect(store.read()).resolves.toBeNull();
    const fresh = createInitialTelemetryLifecycle({
      fresh: true,
    });
    await store.write(fresh);
    await expect(store.read()).resolves.toEqual(fresh);
  });

  it("neutralizes a cohort without retaining its first-observed day", () => {
    expect(neutralizeTelemetryLifecycle()).toEqual({
      version: 1,
      cohort_status: "baseline",
      first_run_utc_day: null,
      first_run_enqueued: true,
    });
  });
});
