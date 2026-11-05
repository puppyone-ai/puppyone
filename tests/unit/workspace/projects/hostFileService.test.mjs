import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHostFileService } from "../../../../electron/main/hosts/host-file-service.mjs";

const contract = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../fixtures/cloud/contracts/host-file-protocol-v1.json", import.meta.url)), "utf8"));
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function setup({ capabilities = ["folder.read", "folder.write"], files = { "note.md": "initial" }, symlinks = {} } = {}) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-files-")));
  roots.push(base);
  const root = path.join(base, "shared");
  await fs.mkdir(root);
  await fs.writeFile(path.join(base, "outside.md"), "outside");
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  for (const [name, target] of Object.entries(symlinks)) await fs.symlink(target, path.join(root, name));
  let state = "active";
  const service = createHostFileService({ resolveFolder: async (id) => id === "folder" ?
    { rootPath: root, state, capabilities } : null });
  return { root, base, service, revoke: () => { state = "removed"; } };
}

describe("host file service", () => {
  it("lists and reads one registered root, without exposing Git or symlinks", async () => {
    const { root, service } = await setup({ files: { "note.md": "initial", ".git/config": "private" } });
    await fs.symlink("/etc/passwd", path.join(root, "escape"));
    const listed = await service.list("folder");
    expect(listed.entries.map(({ name, kind }) => ({ name, kind }))).toEqual([{ name: "note.md", kind: "file" }]);
    expect(listed.entries[0]).toMatchObject({ size: 7 });
    expect(listed.entries[0].modified_ns).toMatch(/^\d+$/);
    const read = await service.read("folder", "note.md");
    expect(Buffer.from(read.content_base64, "base64").toString()).toBe("initial");
    expect(read).toMatchObject({ name: "note.md", kind: "file", size: 7 });
    await expect(service.read("folder", "escape")).rejects.toThrow();
    await expect(service.read("folder", ".git/config")).rejects.toThrow();
    await expect(service.read("folder", "../outside")).rejects.toThrow();
    await expect(service.read("folder", "/etc/passwd")).rejects.toThrow();
    await expect(service.read("other", "note.md")).rejects.toThrow();
  });

  it("reports a missing name inside the root, but nothing about names behind a symlink", async () => {
    const { root, service } = await setup();
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-outside-")));
    roots.push(outside);
    await fs.writeFile(path.join(outside, "exists.md"), "outside");
    await fs.symlink(outside, path.join(root, "linked"));
    await fs.mkdir(path.join(root, "sub"));
    await expect(service.read("folder", "missing.md")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.read("folder", "sub/missing.md")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.list("folder", "nowhere")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.read("folder", "linked/exists.md")).rejects.toMatchObject({ code: "invalid_path" });
    await expect(service.read("folder", "linked/missing.md")).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("requires a revision; concurrent writes cannot silently overwrite one another", async () => {
    const { root, service } = await setup();
    const { revision } = await service.read("folder", "note.md");
    await expect(service.write("folder", "note.md", "bmV3", undefined)).rejects.toThrow("revision_required");
    const writes = await Promise.allSettled([
      service.write("folder", "note.md", "Zmlyc3Q=", revision),
      service.write("folder", "note.md", "c2Vjb25k", revision),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")[0].reason.code).toBe("conflict");
    expect(["first", "second"]).toContain(await fs.readFile(path.join(root, "note.md"), "utf8"));
  });

  it("checks the current registration and write capability on each request", async () => {
    const { service, revoke } = await setup({ capabilities: ["folder.read"] });
    const { revision } = await service.read("folder", "note.md");
    await expect(service.write("folder", "note.md", "bmV3", revision)).rejects.toThrow("folder_unavailable");
    await expect(service.mkdir("folder", "new")).rejects.toThrow("folder_unavailable");
    await expect(service.remove("folder", "note.md")).rejects.toThrow("folder_unavailable");
    revoke();
    await expect(service.read("folder", "note.md")).rejects.toThrow("folder_unavailable");
  });

  it("coalesces changes made on this computer into watch events", async () => {
    const { root, service } = await setup();
    const events = [];
    const stop = await service.watch("folder", (event) => events.push(event));
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await fs.writeFile(path.join(root, "note.md"), "changed here");
      await fs.mkdir(path.join(root, ".git"));
      await fs.writeFile(path.join(root, ".git", "HEAD"), "ref");
      const deadline = Date.now() + 3000;
      while (!events.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events.length).toBeGreaterThan(0);
      const paths = events.flatMap((event) => event.reset ? [] : event.paths);
      expect(events.some((event) => event.reset) || paths.includes("note.md")).toBe(true);
      expect(paths.some((item) => item.split("/").includes(".git"))).toBe(false);
    } finally { stop(); }
  });

  describe("shared conformance cases (host-file-protocol-v1)", () => {
    for (const testCase of contract.conformance) {
      it(testCase.name, async () => {
        const { root, service } = await setup({ files: testCase.files ?? {}, symlinks: testCase.symlinks ?? {} });
        const request = { folder_id: "folder", ...testCase.request };
        if (testCase.error) {
          await expect(service.run(request)).rejects.toMatchObject({ code: testCase.error });
        } else {
          const result = await service.run(request);
          if (testCase.request.action === "list") {
            expect(result.entries.map(({ name, kind }) => ({ name, kind }))).toEqual(testCase.expect.entries);
          } else {
            expect(result).toMatchObject(testCase.expect);
          }
        }
        for (const [name, content] of Object.entries(testCase.after ?? {})) {
          expect(await fs.readFile(path.join(root, name), "utf8")).toBe(content);
        }
        for (const name of testCase.absent ?? []) {
          await expect(fs.lstat(path.join(root, name))).rejects.toMatchObject({ code: "ENOENT" });
        }
      });
    }
  });
});
