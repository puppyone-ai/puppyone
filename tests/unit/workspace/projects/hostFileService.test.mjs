import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHostFileService } from "../../../../electron/main/hosts/host-file-service.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function setup(capabilities = ["folder.read", "folder.write"]) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-files-")));
  roots.push(root);
  await fs.writeFile(path.join(root, "note.md"), "initial");
  await fs.mkdir(path.join(root, ".git"));
  await fs.writeFile(path.join(root, ".git", "config"), "private");
  let state = "active";
  const service = createHostFileService({ resolveFolder: async (id) => id === "folder" ?
    { rootPath: root, state, capabilities } : null });
  return { root, service, revoke: () => { state = "removed"; } };
}

describe("host file service", () => {
  it("lists and reads one registered root, without exposing Git or symlinks", async () => {
    const { root, service } = await setup();
    await fs.symlink("/etc/passwd", path.join(root, "escape"));
    expect(await service.list("folder")).toEqual([{ name: "note.md", type: "file" }]);
    const read = await service.read("folder", "note.md");
    expect(Buffer.from(read.content_base64, "base64").toString()).toBe("initial");
    await expect(service.read("folder", "escape")).rejects.toThrow();
    await expect(service.read("folder", ".git/config")).rejects.toThrow();
    await expect(service.read("folder", "../outside")).rejects.toThrow();
    await expect(service.read("folder", "/etc/passwd")).rejects.toThrow();
    await expect(service.read("other", "note.md")).rejects.toThrow();
  });

  it("requires a revision; concurrent writes cannot silently overwrite one another", async () => {
    const { root, service } = await setup();
    const { revision } = await service.read("folder", "note.md");
    await expect(service.write("folder", "note.md", "bmV3", null)).rejects.toThrow("revision_required");
    const writes = await Promise.allSettled([
      service.write("folder", "note.md", "Zmlyc3Q=", revision),
      service.write("folder", "note.md", "c2Vjb25k", revision),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")[0].reason.code).toBe("conflict");
    expect(["first", "second"]).toContain(await fs.readFile(path.join(root, "note.md"), "utf8"));
  });

  it("checks the current registration and write capability on each request", async () => {
    const { service, revoke } = await setup(["folder.read"]);
    const { revision } = await service.read("folder", "note.md");
    await expect(service.write("folder", "note.md", "bmV3", revision)).rejects.toThrow("folder_unavailable");
    revoke();
    await expect(service.read("folder", "note.md")).rejects.toThrow("folder_unavailable");
  });
});
