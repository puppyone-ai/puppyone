import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopUpdatePreferenceStore,
  DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION,
} from "../../../../electron/main/updates/update-preference-store.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe("Desktop update preference store", () => {
  it("rejects a missing persistence path", () => {
    expect(() => createDesktopUpdatePreferenceStore({ filePath: "" }))
      .toThrow("A Desktop update preference path is required.");
  });

  it("defaults automatic downloads on when no preference exists", async () => {
    const filePath = await createPreferencePath();
    const store = createDesktopUpdatePreferenceStore({ filePath });

    await expect(store.read()).resolves.toEqual({
      schemaVersion: DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION,
      automaticallyDownloadUpdates: true,
    });
  });

  it("persists an automatic download opt-out", async () => {
    const filePath = await createPreferencePath();
    const store = createDesktopUpdatePreferenceStore({ filePath });

    await store.write({ automaticallyDownloadUpdates: false });

    await expect(store.read()).resolves.toEqual({
      schemaVersion: DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION,
      automaticallyDownloadUpdates: false,
    });
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("fails open to automatic downloads for malformed preferences", async () => {
    const filePath = await createPreferencePath();
    const logger = { warn: vi.fn() };
    await fs.writeFile(filePath, "not json", "utf8");
    const store = createDesktopUpdatePreferenceStore({ filePath, logger });

    await expect(store.read()).resolves.toMatchObject({ automaticallyDownloadUpdates: true });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("fails open for unsafe paths and unsupported schema versions", async () => {
    const unsafePath = await createPreferencePath();
    const logger = { warn: vi.fn() };
    await fs.mkdir(unsafePath);

    const unsafeStore = createDesktopUpdatePreferenceStore({
      filePath: unsafePath,
      logger,
    });
    await expect(unsafeStore.read()).resolves.toMatchObject({
      automaticallyDownloadUpdates: true,
    });
    expect(logger.warn).toHaveBeenCalledOnce();

    const unsupportedPath = await createPreferencePath();
    await fs.writeFile(unsupportedPath, JSON.stringify({
      schemaVersion: DESKTOP_UPDATE_PREFERENCE_SCHEMA_VERSION + 1,
      automaticallyDownloadUpdates: false,
    }));
    const unsupportedStore = createDesktopUpdatePreferenceStore({
      filePath: unsupportedPath,
    });
    await expect(unsupportedStore.read()).resolves.toMatchObject({
      automaticallyDownloadUpdates: true,
    });
  });

  it("serializes writes and recovers the queue after a failed mutation", async () => {
    const filePath = await createPreferencePath();
    let failNextOpen = true;
    const fsApi = {
      chmod: (...args) => fs.chmod(...args),
      lstat: (...args) => fs.lstat(...args),
      mkdir: (...args) => fs.mkdir(...args),
      open: (...args) => {
        if (failNextOpen) {
          failNextOpen = false;
          return Promise.reject(new Error("simulated write failure"));
        }
        return fs.open(...args);
      },
      readFile: (...args) => fs.readFile(...args),
      rename: (...args) => fs.rename(...args),
      rm: (...args) => fs.rm(...args),
    };
    const store = createDesktopUpdatePreferenceStore({ filePath, fsApi });

    const failed = store.write({ automaticallyDownloadUpdates: false });
    const recovered = store.write({ automaticallyDownloadUpdates: true });

    await expect(failed).rejects.toThrow("simulated write failure");
    await expect(recovered).resolves.toMatchObject({
      automaticallyDownloadUpdates: true,
    });
    await expect(store.read()).resolves.toMatchObject({
      automaticallyDownloadUpdates: true,
    });

    await Promise.all([
      store.write({ automaticallyDownloadUpdates: false }),
      store.write({ automaticallyDownloadUpdates: true }),
      store.write({ automaticallyDownloadUpdates: false }),
    ]);
    await expect(store.read()).resolves.toMatchObject({
      automaticallyDownloadUpdates: false,
    });
  });
});

async function createPreferencePath() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-update-preference-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "desktop-update-preferences.json");
}
