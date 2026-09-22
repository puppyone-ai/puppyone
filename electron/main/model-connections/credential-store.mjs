import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeConnectionJson } from "./connection-store.mjs";
import { connectionError } from "../../../shared/model-connections/schema.mjs";

/** Only Main constructs this store. References never cross the public IPC boundary. */
export function createModelCredentialStore({ directory, secureStorage, fsApi = fs, platform = process.platform }) {
  const ensureSecure = () => {
    if (secureStorage?.isEncryptionAvailable() !== true || (platform === "linux" && secureStorage.getSelectedStorageBackend?.() === "basic_text")) {
      throw connectionError("SECURE_STORAGE_UNAVAILABLE");
    }
  };
  const location = (ref) => {
    if (typeof ref !== "string" || !/^[a-f0-9-]{36}$/u.test(ref)) throw connectionError("CREDENTIAL_UNAVAILABLE");
    return path.join(directory, `${ref}.json`);
  };
  return {
    async create(secret) {
      ensureSecure();
      const ref = randomUUID();
      await writeConnectionJson(location(ref), { version: 1, encrypted: secureStorage.encryptString(secret).toString("base64") }, fsApi);
      return ref;
    },
    async read(ref) {
      ensureSecure();
      try {
        if ((await fsApi.stat(location(ref))).size > 64 * 1024) throw connectionError("CREDENTIAL_UNAVAILABLE");
        const value = JSON.parse(await fsApi.readFile(location(ref), "utf8"));
        if (value?.version !== 1 || typeof value.encrypted !== "string") throw connectionError("CREDENTIAL_UNAVAILABLE");
        return secureStorage.decryptString(Buffer.from(value.encrypted, "base64"));
      } catch { throw connectionError("CREDENTIAL_UNAVAILABLE"); }
    },
    async remove(ref) { if (ref) await fsApi.rm(location(ref), { force: true }); },
    async reconcile(references) {
      const retained = new Set(references);
      let names;
      try { names = await fsApi.readdir(directory); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
      for (const name of names) {
        if (/^[a-f0-9-]{36}\.json$/u.test(name) && !retained.has(name.slice(0, -5))) await fsApi.rm(path.join(directory, name), { force: true });
      }
    },
  };
}
