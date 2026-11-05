import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHostFolderRegistry } from "../../../../electron/main/hosts/host-folder-registry.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const deviceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const apiBase = "https://api.puppyone.ai/api/v1";

async function setup() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-registry-")));
  roots.push(root);
  const folderPath = path.join(root, "Notes");
  await fs.mkdir(folderPath);
  let loseReply = true;
  const requests = [];
  const auth = {
    readSession: async () => ({ user_id: accountId, api_base_url: apiBase, session_generation: "one" }),
    async requestSessionApi(base, route, options) {
      requests.push({ base, route, options });
      if (loseReply) { loseReply = false; throw new Error("lost response"); }
      return { folder_id: JSON.parse(options.body).folder_id };
    },
  };
  const registry = createHostFolderRegistry({ filePath: path.join(root, "registry.json"), auth, apiBase });
  return { registry, folderPath, root, requests };
}

describe("host folder registry", () => {
  it("persists one canonical local mapping and retries an unknown result with the same ID", async () => {
    const { registry, folderPath, requests } = await setup();
    await expect(registry.register({ deviceId, rootPath: folderPath, name: "Notes" })).rejects.toThrow("lost response");
    const result = await registry.register({ deviceId, rootPath: folderPath, name: "Notes" });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[0].options.body).folder_id).toBe(result.folderId);
    expect(requests[0].options.body).not.toContain(folderPath);
    expect(await registry.resolve(result.folderId, accountId, deviceId)).toEqual({
      rootPath: folderPath, state: "active", capabilities: ["folder.read"],
    });
    expect(await registry.resolve(result.folderId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", deviceId)).toBeNull();
    expect(await registry.resolve(result.folderId, accountId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd")).toBeNull();
  });

  it("rejects a symlink root and changed registration settings", async () => {
    const { registry, folderPath, root } = await setup();
    const link = path.join(root, "link");
    await fs.symlink(folderPath, link);
    await expect(registry.register({ deviceId, rootPath: link, name: "Notes" })).rejects.toThrow("Select a real directory");
    await expect(registry.register({ deviceId, rootPath: folderPath, name: "Notes" })).rejects.toThrow("lost response");
    await expect(registry.register({ deviceId, rootPath: folderPath, name: "Notes", writable: true })).rejects.toThrow("different settings");
  });
});
