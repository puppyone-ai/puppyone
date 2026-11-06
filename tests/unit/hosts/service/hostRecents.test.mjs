import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHostRecents } from "../../../../electron/main/hosts/host-recents.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const deployment = "https://api.puppyone.ai/api/v1";
const accountA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const deviceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const folderOne = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const folderTwo = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-recents-"));
  roots.push(root);
  let time = Date.parse("2026-11-05T00:00:00Z");
  return createHostRecents({ filePath: path.join(root, "recents.json"), now: () => (time += 1000) });
}

describe("recent folders on other computers", () => {
  it("remembers IDs and names per account, newest first, and the last one open", async () => {
    const recents = await setup();
    await recents.record({ deployment, accountId: accountA, deviceId, folderId: folderOne, name: "Notes", hostName: "Mac", writable: true });
    await recents.record({ deployment, accountId: accountA, deviceId, folderId: folderTwo, name: "Work", hostName: "Mac" });
    await recents.record({ deployment, accountId: accountB, deviceId, folderId: folderOne, name: "Other", hostName: "PC" });
    const listed = await recents.list(deployment, accountA);
    expect(listed.map((entry) => entry.name)).toEqual(["Work", "Notes"]);
    expect(JSON.stringify(listed)).not.toMatch(/\/Users\//);
    expect((await recents.lastActive(deployment, accountA))?.folderId).toBe(folderTwo);
    expect((await recents.lastActive(deployment, accountB))?.name).toBe("Other");
    await recents.clearLastActive(deployment, accountA);
    expect(await recents.lastActive(deployment, accountA)).toBeNull();
    expect(await recents.forget(deployment, accountA, folderTwo)).toBe(true);
    expect((await recents.list(deployment, accountA)).map((entry) => entry.folderId)).toEqual([folderOne]);
    await expect(recents.record({ deployment: "https://evil.example/api/v1", accountId: accountA, deviceId,
      folderId: folderOne, name: "x" })).rejects.toThrow();
  });
});
