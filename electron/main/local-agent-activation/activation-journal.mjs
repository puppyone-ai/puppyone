import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertActivationSnapshot } from "../../../shared/local-agent-activation/schema.mjs";

export function createActivationJournal(filePath) {
  let queue = Promise.resolve();
  return {
    async read() {
      try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error("Invalid activation journal.");
        return assertActivationSnapshot(JSON.parse(await fs.readFile(filePath, "utf8"))).operations;
      } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
    write(snapshot) {
      const data = JSON.stringify(assertActivationSnapshot(snapshot));
      const next = queue.catch(() => {}).then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
        const temporary = `${filePath}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, data, { mode: 0o600, flag: "wx" });
          await fs.rename(temporary, filePath);
        } finally { await fs.rm(temporary, { force: true }); }
      });
      queue = next;
      return next;
    },
  };
}
