import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { watchDirectoryTree } from "../../../../electron/main/directory-tree-watch.mjs";

describe("directory-based recursive file notifications", () => {
  const cleanups = [];
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

  it("keeps reporting external edits after repeated atomic saves, including new nested folders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-directory-watch-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "existing"));
    const events = [];
    const watcher = watchDirectoryTree(root, (_kind, filename) => events.push(filename));
    cleanups.push(() => watcher.close());
    watcher.on("error", (error) => { throw error; });
    for (const folder of ["existing", "created/nested"]) {
      await fs.mkdir(path.join(root, folder), { recursive: true });
      if (folder.startsWith("created/")) {
        await expect.poll(() => events.includes("created"), { timeout: 5000 }).toBe(true);
      }
      const file = `${folder}/board.excalidraw`;
      await fs.writeFile(path.join(root, file), "initial");
      await expect.poll(() => events.includes(file), { timeout: 5000, message: file }).toBe(true);
      for (let index = 0; index < 3; index++) {
        const temporary = path.join(root, folder, `save-${index}.tmp`);
        await fs.writeFile(temporary, `saved-${index}`);
        events.length = 0;
        await fs.rename(temporary, path.join(root, file));
        await expect.poll(() => events.includes(file), { timeout: 5000 }).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        events.length = 0;
        await fs.writeFile(path.join(root, file), `agent-${index}`);
        await expect.poll(() => events.includes(file), { timeout: 5000 }).toBe(true);
      }
    }
    watcher.close();
    events.length = 0;
    await fs.writeFile(path.join(root, "existing/board.excalidraw"), "after-close");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events).toEqual([]);
  });
});
