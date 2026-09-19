import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createModelCredentialStore } from "../../../../electron/main/model-connections/credential-store.mjs";
import { registerModelConnectionsIpcHandlers } from "../../../../electron/main/ipc/model-connections-ipc.mjs";

const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
it.each(["unavailable", "basic_text"])("fails closed when OS protection is %s", async (backend) => {
  const secureStorage = { isEncryptionAvailable: () => backend !== "unavailable", getSelectedStorageBackend: () => backend, encryptString: vi.fn() };
  const store = createModelCredentialStore({ directory: "/unused", secureStorage, platform: "linux" });
  await expect(store.create("synthetic-key-value")).rejects.toMatchObject({ code: "SECURE_STORAGE_UNAVAILABLE" });
  expect(secureStorage.encryptString).not.toHaveBeenCalled();
});
it("persists only encrypted material, round-trips through the OS port and reconciles orphans", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "model-credential-test-")); directories.push(directory);
  const secureStorage = { isEncryptionAvailable: () => true, encryptString: vi.fn(() => Buffer.from("synthetic-encrypted-bytes")), decryptString: vi.fn(() => "synthetic-private-key") };
  const store = createModelCredentialStore({ directory, secureStorage });
  const retained = await store.create("synthetic-private-key"); const orphan = await store.create("synthetic-orphan-key");
  expect(await fs.readFile(path.join(directory, `${retained}.json`), "utf8")).not.toContain("synthetic-private-key");
  if (process.platform !== "win32") expect((await fs.stat(path.join(directory, `${retained}.json`))).mode & 0o777).toBe(0o600);
  expect(await store.read(retained)).toBe("synthetic-private-key");
  await store.reconcile([retained]);
  await expect(store.read(orphan)).rejects.toMatchObject({ code: "CREDENTIAL_UNAVAILABLE" });
  await store.remove(retained); expect(await fs.readdir(directory)).toEqual([]);
});
it("public IPC never serializes provider exceptions or unknown request fields", async () => {
  const handlers = new Map();
  const save = vi.fn(async () => { throw new Error("server echoed synthetic-private-key"); });
  registerModelConnectionsIpcHandlers({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, connections: { save } });
  const result = await handlers.get("model-connections:save")({}, { driver: "ollama", auth: "none", name: "Test", baseUrl: "http://127.0.0.1:11434", credentialRef: "forbidden" });
  expect(result).toEqual({ ok: false, code: "OPERATION_FAILED" });
  expect(save.mock.calls[0][0]).not.toHaveProperty("credentialRef");
});
