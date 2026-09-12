import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCredentialStore } from "../../../../electron/main/auth/credential-store.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe("desktop credential store", () => {
  it("atomically persists only the v2 refresh credential and reads it back", async () => {
    const { filePath, store } = await createFixture();
    const credential = createCredential();

    await store.write(credential);

    expect(await store.read()).toEqual(credential);
    const envelope = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    expect(envelope).toMatchObject({ version: 2, storage: "electron-safe-storage" });
    expect(JSON.stringify(envelope)).not.toContain("access-token-must-not-persist");
    expect((await fs.promises.stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("reads a legacy full-session envelope without returning its access token", async () => {
    const { filePath, store, secureStorage } = await createFixture();
    const legacy = {
      access_token: "legacy-access-token",
      refresh_token: "legacy-refresh-token",
      user_email: "legacy@example.com",
      api_base_url: "https://api.puppyone.ai/api/v1",
      expires_at: Date.now() + 60_000,
    };
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify({
      version: 1,
      storage: "electron-safe-storage",
      data: secureStorage.encryptString(JSON.stringify(legacy)).toString("base64"),
    }));

    const restored = await store.read();

    expect(restored).toEqual({
      version: 1,
      user_id: null,
      user_email: "legacy@example.com",
      api_origin: "https://api.puppyone.ai/api/v1",
      refresh_token: "legacy-refresh-token",
    });
    expect(restored).not.toHaveProperty("access_token");
  });

  it("quarantines malformed storage instead of silently treating it as a valid logout", async () => {
    const { root, filePath, store } = await createFixture();
    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.writeFile(filePath, "{not-json", "utf8");

    expect(await store.read()).toBeNull();
    expect(await fs.promises.readdir(root)).toEqual([
      expect.stringMatching(/^desktop-cloud-session\.json\.corrupt\./),
    ]);
  });

  it("fails closed when Linux safeStorage selected basic_text", async () => {
    const { filePath } = await createFixture();
    const store = createCredentialStore({
      filePath,
      platform: "linux",
      secureStorage: createSecureStorage({ backend: "basic_text" }),
      allowInsecureStorage: false,
    });

    await expect(store.write(createCredential())).rejects.toMatchObject({
      code: "SECURE_STORAGE_UNAVAILABLE",
    });
  });
});

async function createFixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-credential-store-"));
  roots.push(root);
  const filePath = path.join(root, "desktop-cloud-session.json");
  const secureStorage = createSecureStorage();
  return {
    root,
    filePath,
    secureStorage,
    store: createCredentialStore({ filePath, secureStorage }),
  };
}

function createCredential() {
  return {
    version: 2,
    user_id: "user-123",
    user_email: "user@example.com",
    api_origin: "https://api.puppyone.ai/api/v1",
    refresh_token: "refresh-token-123",
    updated_at: "2026-07-11T00:00:00.000Z",
  };
}

function createSecureStorage({ backend = "gnome_libsecret" } = {}) {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("sealed:")) throw new Error("bad envelope");
      return decoded.slice("sealed:".length);
    },
  };
}
