import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopLocaleService } from "../../../../electron/main/localization/desktop-locale-service.mjs";
import { createLocalePreferenceStore } from "../../../../electron/main/localization/locale-preference-store.mjs";
import {
  isAppLanguagePreference,
  resolveSystemLocale,
  validateLocaleManifest,
} from "../../../../electron/main/localization/locale-resolver.mjs";

const temporaryDirectories = [];
const localesRoot = path.resolve("locales");

async function createTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-locale-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

function createAppMock(initialLanguages) {
  let languages = [...initialLanguages];
  return {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    getLocale: () => languages[0] ?? "en",
    getPreferredSystemLanguages: () => [...languages],
    setLanguages: (nextLanguages) => {
      languages = [...nextLanguages];
    },
  };
}

describe("DesktopLocaleService", () => {
  it("loads system state, localizes native UI, persists, and broadcasts atomically", async () => {
    const directory = await createTemporaryDirectory();
    const app = createAppMock(["fr-CA", "en-US"]);
    const send = vi.fn();
    const service = createDesktopLocaleService({
      app,
      localesRoot,
      preferenceFilePath: path.join(directory, "preference.json"),
      getWindows: () => [{
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send },
      }],
    });

    await expect(service.initialize()).resolves.toMatchObject({
      preference: "system",
      locale: "fr",
      direction: "ltr",
    });
    expect(service.t("native.dock.newWindow")).toBe("Nouvelle fenêtre");
    expect(service.t("native.menu.file")).toBe("Fichier");
    expect(send).not.toHaveBeenCalled();

    await expect(service.setLanguagePreference("de")).resolves.toMatchObject({
      preference: "de",
      locale: "de",
      direction: "ltr",
    });
    expect(send).toHaveBeenCalledWith("localization:changed", expect.objectContaining({ locale: "de" }));
    expect(JSON.parse(await fs.readFile(path.join(directory, "preference.json"), "utf8"))).toEqual({
      version: 1,
      language: "de",
    });

    await expect(service.setLanguagePreference("it")).rejects.toThrow(
      "Unsupported application language preference",
    );
    expect(service.getSnapshot().locale).toBe("de");
  });

  it("follows OS changes only while the preference is System", async () => {
    const directory = await createTemporaryDirectory();
    const app = createAppMock(["zh-TW", "es-MX"]);
    const service = createDesktopLocaleService({
      app,
      localesRoot,
      preferenceFilePath: path.join(directory, "preference.json"),
      getWindows: () => [],
    });
    await service.initialize();
    expect(service.getSnapshot().locale).toBe("es");

    app.setLanguages(["ja-JP"]);
    await service.refreshSystemLanguages();
    expect(service.getSnapshot().locale).toBe("ja");

    await service.setLanguagePreference("ko");
    app.setLanguages(["fr-FR"]);
    await service.refreshSystemLanguages();
    expect(service.getSnapshot().locale).toBe("ko");
  });
});

describe("locale preference persistence", () => {
  it("recovers from a malformed preference file", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = path.join(directory, "preference.json");
    await fs.writeFile(filePath, "{broken", "utf8");
    const store = createLocalePreferenceStore({ filePath });
    await expect(store.read()).resolves.toBe("system");
  });
});

describe("locale production readiness", () => {
  it("does not expose or system-resolve a locale whose release flag is disabled", async () => {
    const rawManifest = JSON.parse(await fs.readFile(path.join(localesRoot, "manifest.json"), "utf8"));
    const manifest = validateLocaleManifest({
      ...rawManifest,
      locales: rawManifest.locales.map((entry) => (
        entry.locale === "es" ? { ...entry, productionReady: false } : entry
      )),
    });

    expect(isAppLanguagePreference(manifest, "es")).toBe(false);
    expect(resolveSystemLocale(manifest, ["es-MX", "de-DE"])).toBe("de");
  });
});
