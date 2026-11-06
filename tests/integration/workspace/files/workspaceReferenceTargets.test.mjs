import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceReferenceTargetReader, listWorkspaceReferenceTargets } from "../../../../electron/local-api/files/reference-targets.mjs";

const directories = [];
async function temporary() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-reference-targets-"));
  directories.push(root); return root;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe("workspace reference metadata", () => {
  it("coalesces refreshes into a new serialized scan rather than returning stale metadata", async () => {
    const releases = [];
    let reads = 0;
    const reader = createWorkspaceReferenceTargetReader(async () => {
      const revision = ++reads;
      await new Promise(resolve => releases.push(resolve));
      return revision;
    });
    const first = reader("root");
    const next = reader("root"), shared = reader("root");
    expect(next).toBe(shared);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads).toBe(1);
    releases.shift()();
    expect(await first).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads).toBe(2);
    releases.shift()();
    expect(await next).toBe(2);
  });
  it("enumerates beyond Explorer's 500 entries without reading file contents", async () => {
    const root = await temporary();
    await fs.mkdir(path.join(root, "attachments"));
    await Promise.all(Array.from({ length: 601 }, (_, i) => fs.writeFile(path.join(root, "attachments", `photo-${i}.jpg`), "not a decoded image")));
    const targets = await listWorkspaceReferenceTargets(root);
    expect(targets).toHaveLength(601);
    expect(targets).toContainEqual({ path: "attachments/photo-600.jpg", name: "photo-600.jpg" });
    expect(targets.every(target => Object.keys(target).sort().join() === "name,path")).toBe(true);
  });

  it("includes hidden attachment folders, excludes dependency internals and skips links", async () => {
    const root = await temporary(), outside = await temporary();
    for (const dir of [".attachments", ".git", "node_modules"]) {
      await fs.mkdir(path.join(root, dir));
      await fs.writeFile(path.join(root, dir, "图 片%20.jpg"), "data");
    }
    await fs.writeFile(path.join(outside, "secret.jpg"), "outside");
    await fs.symlink(outside, path.join(root, "linked-folder"));
    await fs.symlink(path.join(outside, "secret.jpg"), path.join(root, "linked.jpg"));
    expect(await listWorkspaceReferenceTargets(root)).toEqual([{ path: ".attachments/图 片%20.jpg", name: "图 片%20.jpg" }]);
  });

  it("rejects truncated indexes and cancellation instead of publishing false uniqueness", async () => {
    const root = await temporary();
    await fs.mkdir(path.join(root, "a")); await fs.mkdir(path.join(root, "b"));
    await fs.writeFile(path.join(root, "a/photo.jpg"), "a"); await fs.writeFile(path.join(root, "b/photo.jpg"), "b");
    await expect(listWorkspaceReferenceTargets(root, { maxEntries: 2 })).rejects.toThrow(/limit/);
    await expect(listWorkspaceReferenceTargets(root, { maxDirectories: 1 })).rejects.toThrow(/limit/);
    const controller = new AbortController(); controller.abort();
    await expect(listWorkspaceReferenceTargets(root, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(await listWorkspaceReferenceTargets(root)).toHaveLength(2);
  });
});
