/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudDataService } from "../../../../src/features/cloud/files/cloudDataPort";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { fileVersion } from "../../../fixtures/cloud/repositories/liveWorkspace";
import { installLiveWorkspaceBridge, type LiveWorkspaceBridge } from "../../../support/cloud/liveWorkspaceBridge";

const apiBaseUrl = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: apiBaseUrl, user_id: "owner", user_email: "owner@example.com",
  session_generation: "one", expires_at: Date.now() + 3600000, expires_in: 3600, status: "authenticated" };
const context = { status: "resolved" as const, projectId: "project", projectName: "Project",
  target: { kind: "project_root" as const, project_id: "project" }, capabilities: ["content.read", "content.write"] };
type Cloud = ReturnType<typeof createCloudDataService>;

let live: LiveWorkspaceBridge;
beforeEach(() => {
  vi.restoreAllMocks();
  live = installLiveWorkspaceBridge({
    "readme.md": "initial",
    "docs/guide.md": "guide",
    "docs/deep/note.md": "note",
    "other/keep.md": "keep",
  });
});

const service = () => createCloudDataService({ session, context, apiBaseUrl });
const save = (cloud: Cloud, path: string, content: string, baseVersion: string | null) =>
  cloud.dataPort.documentPersistence!.persist({ path, content, baseVersion, reason: "edit", revision: content });
async function watching(cloud: Cloud) {
  const changed = vi.fn(), failed = vi.fn();
  const stop = cloud.watch!(changed, failed);
  await vi.waitFor(() => expect(live.subscribed()).toBeTruthy());
  return { changed, failed, stop };
}
async function listAll(cloud: Cloud, ...folders: (string | null)[]) {
  for (const folder of folders) await cloud.dataPort.listChildren(folder);
}
const cached = (cloud: Cloud, folder: string | null) => cloud.dataPort.getCachedChildren!(folder)?.map((node) => node.name).sort();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Cloud editing: path-scoped caches and change events", () => {
  it("saves an existing file without re-reading any listing", async () => {
    const cloud = service(); await watching(cloud);
    await listAll(cloud, null, "docs", "other");
    const file = await cloud.dataPort.readFile!("readme.md");
    const mark = live.log.length;

    expect(await save(cloud, "readme.md", "edited", file.version!)).toEqual({ ok: true, version: fileVersion("edited") });
    await listAll(cloud, null, "docs", "other");

    expect(live.requestsSince(mark)).toEqual(["PUT /file?readme.md"]);
    expect(live.files.get("readme.md")).toBe("edited");
  });

  it("creates a file by re-listing only its parent folder", async () => {
    const cloud = service(); await watching(cloud);
    await listAll(cloud, null, "docs", "other");
    const mark = live.log.length;

    await cloud.dataPort.createFile!("docs/new.md", "fresh");
    await listAll(cloud, null, "docs", "other");

    expect(live.requestsSince(mark)).toEqual(["PUT /file?docs/new.md", "GET /files?docs"]);
    expect(cached(cloud, "docs")).toEqual(expect.arrayContaining(["guide.md", "deep", "new.md"]));
  });

  it("drops only a changed file's read and its parent listing when an event names it", async () => {
    const cloud = service(); const { changed } = await watching(cloud);
    await listAll(cloud, null, "docs", "other");
    await cloud.dataPort.readFile!("docs/guide.md");

    live.files.set("docs/guide.md", "Agent rewrote this");
    live.emit({ type: "change", paths: ["docs/guide.md"] });

    expect(changed).toHaveBeenLastCalledWith(["docs/guide.md"]);
    expect(cached(cloud, "docs")).toBeUndefined();
    expect(cached(cloud, null)).toEqual(["docs", "other", "readme.md"]);
    expect(cached(cloud, "other")).toEqual(["keep.md"]);
    const mark = live.log.length;
    expect((await cloud.dataPort.readFile!("docs/guide.md")).content).toBe("Agent rewrote this");
    await listAll(cloud, null, "docs", "other");
    expect(live.requestsSince(mark)).toEqual(["GET /file?docs/guide.md", "GET /files?docs"]);
  });

  it("drops everything cached beneath a folder an event names", async () => {
    const cloud = service(); const { changed } = await watching(cloud);
    await listAll(cloud, null, "docs", "docs/deep", "other");

    live.emit({ type: "change", paths: ["docs"] });

    expect(changed).toHaveBeenLastCalledWith(["docs"]);
    expect(cached(cloud, "docs")).toBeUndefined();
    expect(cached(cloud, "docs/deep")).toBeUndefined();
    expect(cached(cloud, null)).toBeUndefined();
    expect(cached(cloud, "other")).toEqual(["keep.md"]);
  });

  it("drops every cache when an event cannot name its scope or the stream reconnects", async () => {
    const cloud = service(); const { changed } = await watching(cloud);
    await listAll(cloud, null, "docs", "other");

    live.emit({ type: "change" });
    expect(changed).toHaveBeenLastCalledWith(null);
    expect([cached(cloud, null), cached(cloud, "docs"), cached(cloud, "other")]).toEqual([undefined, undefined, undefined]);

    await listAll(cloud, null, "docs");
    changed.mockClear();
    live.emit({ type: "reconnecting" });
    expect(changed).not.toHaveBeenCalled();
    expect([cached(cloud, null), cached(cloud, "docs")]).toEqual([undefined, undefined]);
  });

  it("re-lists both parents of a rename or move, and the whole subtree of a delete", async () => {
    const cloud = service(); await watching(cloud);
    await listAll(cloud, null, "docs", "docs/deep", "other");

    await cloud.dataPort.renameNode!("docs/guide.md", "manual.md");
    expect(cached(cloud, "docs")).toBeUndefined();
    expect(cached(cloud, "other")).toEqual(["keep.md"]);
    expect(cached(cloud, null)).toEqual(["docs", "other", "readme.md"]);

    await listAll(cloud, "docs");
    await cloud.dataPort.moveNode!("docs/deep/note.md", "other/note.md");
    expect(cached(cloud, "docs/deep")).toBeUndefined();
    expect(cached(cloud, "other")).toBeUndefined();
    expect(cached(cloud, "docs")).toEqual(["deep", "manual.md"]);

    await listAll(cloud, "other");
    await cloud.dataPort.deleteNode!("docs");
    expect([cached(cloud, null), cached(cloud, "docs"), cached(cloud, "docs/deep")]).toEqual([undefined, undefined, undefined]);
    expect(cached(cloud, "other")).toEqual(["keep.md", "note.md"]);
    expect([...live.files.keys()].sort()).toEqual(["other/keep.md", "other/note.md", "readme.md"]);
  });

  it("drops caches after a failed request, since bytes may be stale", async () => {
    const cloud = service(); await watching(cloud);
    await listAll(cloud, null, "docs");
    await expect(cloud.dataPort.readFile!("missing.md")).rejects.toMatchObject({ status: 404 });
    expect([cached(cloud, null), cached(cloud, "docs")]).toEqual([undefined, undefined]);
  });

  it("treats the echo of an own save as the same bytes, re-reading once without a conflict", async () => {
    const cloud = service(); const { changed } = await watching(cloud);
    await listAll(cloud, null);
    const before = await cloud.dataPort.readFile!("readme.md");
    const saved = await save(cloud, "readme.md", "mine", before.version!);
    expect(saved).toMatchObject({ ok: true });

    live.emit({ type: "change", paths: ["readme.md"] });
    expect(changed).toHaveBeenLastCalledWith(["readme.md"]);
    const mark = live.log.length;
    const echo = await cloud.dataPort.readFile!("readme.md");
    await listAll(cloud, null);

    expect(echo).toMatchObject({ content: "mine", version: saved.ok ? saved.version : null });
    expect(live.requestsSince(mark)).toEqual(["GET /file?readme.md", "GET /files?"]);
    expect(cloud.getCachedFileContent!("readme.md")).toMatchObject({ content: "mine" });
  });

  it("stops delivering changes and keeps no live listing after the watch closes", async () => {
    const cloud = service(); const { changed, stop } = await watching(cloud);
    await listAll(cloud, null);
    stop();
    expect(live.stopCloudWorkspaceWatch).toHaveBeenCalled();
    expect(cached(cloud, null)).toBeUndefined();
    const mark = live.log.length;
    await listAll(cloud, null, null);
    // Without a live subscription a listing cannot stay authoritative.
    expect(live.requestsSince(mark)).toEqual(["GET /files?", "GET /files?"]);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("Cloud editing: write ordering", () => {
  const isPut = (path: string) => (request: { method: string; body?: string }) =>
    request.method === "PUT" && JSON.parse(request.body ?? "{}").path === path;

  it("lets a new file be created while another file is still saving", async () => {
    const cloud = service();
    const before = await cloud.dataPort.readFile!("readme.md");
    const release = live.hold(isPut("readme.md"));
    const saving = save(cloud, "readme.md", "slow save", before.version!);
    await settle();

    await cloud.dataPort.createFile!("docs/new.md", "created meanwhile");
    expect(live.files.get("docs/new.md")).toBe("created meanwhile");
    expect(live.files.get("readme.md")).toBe("initial");

    release();
    expect(await saving).toMatchObject({ ok: true });
    expect(live.files.get("readme.md")).toBe("slow save");
  });

  it("keeps writes to the same file in order", async () => {
    const cloud = service();
    const before = await cloud.dataPort.readFile!("readme.md");
    const release = live.hold(isPut("readme.md"));
    const first = save(cloud, "readme.md", "one", before.version!);
    const second = save(cloud, "readme.md", "two", fileVersion("one"));
    await settle(); await settle();
    expect(live.log.filter(isPut("readme.md"))).toHaveLength(1);

    release();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    expect(live.files.get("readme.md")).toBe("two");
  });

  it("makes a rename wait for the file's save and a folder delete wait for its child's save", async () => {
    const cloud = service();
    const readme = await cloud.dataPort.readFile!("readme.md");
    const guide = await cloud.dataPort.readFile!("docs/guide.md");
    const releaseReadme = live.hold(isPut("readme.md"));
    const releaseGuide = live.hold(isPut("docs/guide.md"));
    const savingReadme = save(cloud, "readme.md", "saved before rename", readme.version!);
    const savingGuide = save(cloud, "docs/guide.md", "saved before delete", guide.version!);
    const renaming = cloud.dataPort.renameNode!("readme.md", "README.md");
    const deleting = cloud.dataPort.deleteNode!("docs");
    await settle(); await settle();
    expect(live.log.some((request) => request.method === "POST")).toBe(false);

    releaseReadme();
    await renaming;
    expect(live.files.get("README.md")).toBe("saved before rename");
    expect(live.files.has("docs/guide.md")).toBe(true);

    releaseGuide();
    await Promise.all([savingReadme, savingGuide, deleting]);
    expect([...live.files.keys()].some((path) => path.startsWith("docs/"))).toBe(false);
  });

  it("does not retry a save whose outcome is unknown and keeps the draft's version", async () => {
    const cloud = service();
    const before = await cloud.dataPort.readFile!("readme.md");
    const original = live.request.getMockImplementation()!;
    live.request.mockImplementation(async (input) => {
      if (input.method === "PUT") { live.log.push(input); throw new TypeError("network disconnected"); }
      return original(input);
    });
    const result = await save(cloud, "readme.md", "lost in transit", before.version!);
    expect(result).toMatchObject({ ok: false, kind: "io" });
    expect(live.log.filter((request) => request.method === "PUT")).toHaveLength(1);
    expect(live.files.get("readme.md")).toBe("initial");
  });
});
