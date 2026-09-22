import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { connectionError } from "../../../shared/model-connections/schema.mjs";

export async function writeConnectionJson(filePath, value, fsApi = fs) {
  await fsApi.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fsApi.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await fsApi.rename(temporary, filePath);
  } finally {
    await fsApi.rm(temporary, { force: true }).catch(() => {});
  }
}

export function createConnectionStore({ filePath, fsApi = fs }) {
  return {
    async read() {
      try {
        const stat = await fsApi.stat(filePath);
        if (stat.size > 1024 * 1024) throw connectionError("STORE_INVALID");
        const value = JSON.parse(await fsApi.readFile(filePath, "utf8"));
        if (value?.schemaVersion !== 1 || !Array.isArray(value.connections)) throw connectionError("STORE_INVALID");
        return value.connections;
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw connectionError("STORE_INVALID");
      }
    },
    write: (connections) => writeConnectionJson(filePath, { schemaVersion: 1, connections }, fsApi),
  };
}
