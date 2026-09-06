import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTelemetryIdentityStore } from "../electron/main/telemetry/infrastructure/telemetry-identity-store.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.promises.rm(directory, { force: true, recursive: true })
  )));
});

describe("Desktop telemetry rotating identity", () => {
  it("is stable within a calendar month and unlinkable across months", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-telemetry-identity-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "identity-v1.json");
    const store = createTelemetryIdentityStore({ filePath });

    const augustFirst = await store.getMonthlyAnonymousId(new Date("2026-08-01T00:00:00.000Z"));
    const augustLast = await store.getMonthlyAnonymousId(new Date("2026-08-31T23:59:59.000Z"));
    const september = await store.getMonthlyAnonymousId(new Date("2026-09-01T00:00:00.000Z"));
    const retentionBefore = await store.getRetentionAnonymousId();
    const retentionAfter = await store.getRetentionAnonymousId();

    expect(augustFirst).toBe(augustLast);
    expect(september).not.toBe(augustFirst);
    expect(augustFirst).toMatch(/^m1_[A-Za-z0-9_-]{43}$/);
    expect(retentionBefore).toBe(retentionAfter);
    expect(retentionBefore).toMatch(/^r1_[A-Za-z0-9_-]{43}$/);
    expect(retentionBefore).not.toBe(augustFirst);
    await expect(store.hasStoredIdentity()).resolves.toBe(true);

    const stored = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    expect(stored).toEqual({ version: 1, secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(JSON.stringify(stored)).not.toContain(augustFirst);
  });

  it("deletes the local secret when telemetry identity is reset", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-telemetry-reset-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "identity-v1.json");
    const store = createTelemetryIdentityStore({ filePath });
    await expect(store.hasStoredIdentity()).resolves.toBe(false);
    const before = await store.getMonthlyAnonymousId(new Date("2026-08-27T00:00:00.000Z"));
    const retentionBefore = await store.getRetentionAnonymousId();

    await store.clear();
    await expect(fs.promises.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    const after = await store.getMonthlyAnonymousId(new Date("2026-08-27T00:00:00.000Z"));
    const retentionAfter = await store.getRetentionAnonymousId();
    expect(after).not.toBe(before);
    expect(retentionAfter).not.toBe(retentionBefore);
  });
});
