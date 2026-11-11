import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
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

async function setup({ capabilities = ["folder.read", "folder.write"], files = { "note.md": "initial" }, symlinks = {}, watchPath, platform } = {}) {
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
  const service = createHostFileService({ watchPath, platform, resolveFolder: async (id) => id === "folder" ?
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

  it.each(["linux", "darwin", "win32"])("reconciles real file changes when the native %s directory stream stays silent", async (platform) => {
    const watchers = [];
    const { root, base, service } = await setup({
      platform,
      // Linux opens one watch per directory; each native handle is distinct.
      watchPath: () => {
        const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
        watchers.push(watcher);
        return watcher;
      },
      files: { "keep.md": "same", "old.md": "old", "nested/note.md": "initial" },
      symlinks: { escape: ".." },
    });
    const events = [];
    const stop = await service.watch("folder", (event) => events.push(event));
    try {
      await fs.writeFile(path.join(root, "replacement"), "atomic");
      await fs.rename(path.join(root, "replacement"), path.join(root, "nested/note.md"));
      await fs.rename(path.join(root, "old.md"), path.join(root, "new.md"));
      await fs.mkdir(path.join(root, ".git"));
      await fs.writeFile(path.join(root, ".git/HEAD"), "private");
      await fs.writeFile(path.join(root, ".puppyone-write-hidden"), "temporary");
      await fs.writeFile(path.join(base, "outside.md"), "outside change");
      const deadline = Date.now() + 3000;
      while (!events.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      expect(events.some((event) => event.reset)).toBe(false);
      const paths = events.flatMap((event) => event.paths);
      expect(paths).toEqual(expect.arrayContaining(["nested/note.md", "old.md", "new.md"]));
      expect(paths.some((name) => ["keep.md", "escape", "outside.md", ".git/HEAD", ".puppyone-write-hidden"].includes(name))).toBe(false);
    } finally { stop(); }
    expect(watchers).toHaveLength(platform === "linux" ? 2 : 1);
    for (const watcher of watchers) expect(watcher.close).toHaveBeenCalledOnce();
  });

  it("ends reconciliation after revocation and releases the native watch", async () => {
    const native = Object.assign(new EventEmitter(), { close: vi.fn() });
    const { root, service, revoke } = await setup({ watchPath: () => native });
    const events = [];
    const stop = await service.watch("folder", (event) => events.push(event));
    try {
      revoke();
      await fs.writeFile(path.join(root, "private.md"), "no longer shared");
      const deadline = Date.now() + 3000;
      while (!events.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      expect(events).toEqual([{ paths: [], reset: true }]);
      expect(native.close).toHaveBeenCalledOnce();
    } finally { stop(); }
  });

  it("does not scan or publish after the last subscriber stops", async () => {
    const { root } = await setup();
    const native = Object.assign(new EventEmitter(), { close: vi.fn() });
    const resolveFolder = vi.fn(async () => ({ rootPath: root, state: "active", capabilities: ["folder.read"] }));
    const service = createHostFileService({ resolveFolder, watchPath: () => native });
    const changed = vi.fn();
    const stop = await service.watch("folder", changed);
    stop();
    await fs.writeFile(path.join(root, "note.md"), "after stop");
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(resolveFolder).toHaveBeenCalledOnce();
    expect(native.close).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
  });

  describe("a directory swapped for a symlink between check and use", () => {
    // Deterministic race: the seam runs after the path check, before the filesystem call.
    async function racing(operation) {
      const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-race-")));
      roots.push(base);
      const root = path.join(base, "shared");
      const outside = path.join(base, "outside");
      await fs.mkdir(path.join(root, "sub"), { recursive: true });
      await fs.writeFile(path.join(root, "sub", "note.md"), "inside");
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "note.md"), "outside secret");
      await fs.writeFile(path.join(outside, "keep.md"), "keep me");
      let swapped = false;
      const service = createHostFileService({
        resolveFolder: async () => ({ rootPath: root, state: "active", capabilities: ["folder.read", "folder.write"] }),
        beforeIo: async () => {
          if (swapped) return;
          swapped = true;
          await fs.rename(path.join(root, "sub"), path.join(base, "moved-away"));
          await fs.symlink(outside, path.join(root, "sub"));
        },
      });
      const result = await operation(service).then(() => "ok", (error) => error.code);
      expect(swapped).toBe(true); // The race really happened between the check and the call.
      return { result, outside };
    }

    it("never returns bytes read through the swapped directory", async () => {
      const { result } = await racing((service) => service.read("folder", "sub/note.md"));
      expect(result).toBe("invalid_path");
    });

    it("never lists the swapped-in directory", async () => {
      const { result } = await racing((service) => service.list("folder", "sub"));
      expect(result).toBe("invalid_path");
    });

    it("never deletes files outside the folder", async () => {
      const { result, outside } = await racing((service) => service.remove("folder", "sub"));
      expect(result).toBe("invalid_path");
      expect(await fs.readFile(path.join(outside, "keep.md"), "utf8")).toBe("keep me");
      expect(await fs.readFile(path.join(outside, "note.md"), "utf8")).toBe("outside secret");
    });

    it("never writes or creates files outside the folder", async () => {
      const read = await createHostFileService({ resolveFolder: async () => null }).read("x", "y").catch((e) => e.code);
      expect(read).toBe("folder_unavailable");
      const created = await racing((service) => service.write("folder", "sub/new.md", "bmV3", null));
      expect(created.result).toBe("invalid_path");
      await expect(fs.lstat(path.join(created.outside, "new.md"))).rejects.toMatchObject({ code: "ENOENT" });
      const made = await racing((service) => service.mkdir("folder", "sub/made"));
      expect(made.result).toBe("invalid_path");
      await expect(fs.lstat(path.join(made.outside, "made"))).rejects.toMatchObject({ code: "ENOENT" });
    });
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
