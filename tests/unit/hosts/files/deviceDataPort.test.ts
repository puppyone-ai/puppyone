// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceFolderRootUri } from "../../../../src/features/hosts/model/deviceFolderIdentity";
import { availabilityOf, createDeviceDataService } from "../../../../src/features/hosts/data/deviceDataPort";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

const ref = {
  deployment: "https://api.puppyone.ai/api/v1",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  folderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const revision = "a".repeat(64);
const session = { user_id: ref.accountId, api_base_url: ref.deployment,
  session_generation: "one" } as DesktopCloudSession;
const requestHostFolder = vi.fn();
let eventListener: ((event: unknown) => void) | null = null;
const watchHostFolder = vi.fn(async ({ id }: { id: string }) => ({ id }));
const stopHostFolderWatch = vi.fn(async () => {});

beforeEach(() => {
  requestHostFolder.mockReset();
  (window as unknown as { puppyoneDesktop: unknown }).puppyoneDesktop = {
    requestHostFolder, watchHostFolder, stopHostFolderWatch,
    onHostFolderEvent: (callback: (event: unknown) => void) => { eventListener = callback; return () => { eventListener = null; }; },
  };
});
afterEach(() => { delete (window as unknown as { puppyoneDesktop?: unknown }).puppyoneDesktop; });

function service(writable = true, isCurrent = () => true) {
  return createDeviceDataService({ ref, name: "Notes", writable, session,
    apiBase: ref.deployment, isCurrent });
}

describe("device DataPort", () => {
  it("routes a resource to one folder through Main and reads text without a local path", async () => {
    requestHostFolder.mockImplementation(async ({ operation, folderId, expectedSession }) => {
      expect(folderId).toBe(ref.folderId);
      expect(expectedSession).toEqual({ userId: ref.accountId, generation: "one" });
      if (operation.action === "list") return { ok: true, result: { entries: [
        { name: "docs", kind: "directory", size: 0, modified_ns: "1" },
        { name: "note.md", kind: "file", size: 4, modified_ns: "1" }] } };
      if (operation.action === "read" && operation.path === "note.md") {
        return { ok: true, result: { content_base64: "bm90ZQ==", revision } };
      }
      return { ok: false, status: 404, code: "not_found" };
    });
    const source = service();
    const children = await source.dataPort.listChildren(null);
    expect(children.map((child) => child.type)).toEqual(["folder", "markdown"]);
    expect(children[0].source).toBe("device");
    expect(source.dataPort.getCachedChildren!(null)).toHaveLength(2);
    const content = await source.dataPort.readFile!(children[1].path);
    expect(content.content).toBe("note");
    expect(content.version).toBe(revision);
    expect(String(content.path)).toContain(String(deviceFolderRootUri(ref)));
    await expect(source.dataPort.readFile!("../secret")).rejects.toThrow();
    await expect(source.dataPort.readFile!("/etc/passwd")).rejects.toThrow();
    await expect(source.dataPort.readFile!(".git/config")).rejects.toThrow();
    expect(source.folder.capabilities).toMatchObject({ execute: false, watch: true });
    expect(source.dataPort.openExternalFile).toBeUndefined();
    expect(source.dataPort.revealInFileManager).toBeUndefined();
  });

  it("does not retry an uncertain write and keeps the draft", async () => {
    requestHostFolder.mockResolvedValueOnce({ ok: false, status: 503, code: "device_disconnected", outcomeUnknown: true });
    const source = service();
    const result = await source.dataPort.documentPersistence!.persist({
      path: "note.md", content: "new", revision: "draft", baseVersion: revision, reason: "manual",
    });
    expect(result).toMatchObject({ ok: false, kind: "io" });
    expect((result as { message: string }).message).toContain("did not confirm");
    expect(requestHostFolder).toHaveBeenCalledTimes(1);
    expect(() => createDeviceDataService({ ref, name: "Notes", writable: true,
      session: { ...session, user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, apiBase: ref.deployment })).toThrow();
  });

  it("returns a fresh snapshot after a rejected compare-and-swap without replaying it", async () => {
    requestHostFolder.mockResolvedValueOnce({ ok: false, status: 409, code: "conflict" });
    requestHostFolder.mockResolvedValueOnce({ ok: true, result: { content_base64: "ZXh0ZXJuYWw=", revision: "b".repeat(64) } });
    const source = service();
    const result = await source.dataPort.documentPersistence!.persist({
      path: "note.md", content: "draft", revision: "draft", baseVersion: revision, reason: "manual",
    });
    expect(result).toMatchObject({ ok: false, kind: "conflict", content: "external", version: "b".repeat(64) });
    expect(requestHostFolder.mock.calls.map(([call]) => call.operation.action)).toEqual(["write", "read"]);
    expect(requestHostFolder.mock.calls[0][0].operation).toMatchObject({ path: "note.md", expected_revision: revision });
  });

  it("creates, renames, moves and deletes only inside the folder, and only when writable", async () => {
    requestHostFolder.mockResolvedValue({ ok: true, result: {} });
    const source = service();
    await source.dataPort.createFile!("new.md", "hello");
    await source.dataPort.createFolder!("docs");
    await source.dataPort.renameNode!("docs/a.md", "b.md");
    await source.dataPort.moveNode!("new.md", "docs/new.md");
    await source.dataPort.deleteNode!("docs");
    expect(requestHostFolder.mock.calls.map(([call]) => call.operation)).toEqual([
      { action: "write", path: "new.md", content_base64: "aGVsbG8=", expected_revision: null },
      { action: "mkdir", path: "docs" },
      { action: "move", path: "docs/a.md", destination: "docs/b.md" },
      { action: "move", path: "new.md", destination: "docs/new.md" },
      { action: "remove", path: "docs" },
    ]);
    await expect(source.dataPort.renameNode!("docs/a.md", "../x")).rejects.toThrow();
    await expect(source.dataPort.deleteNode!("")).rejects.toThrow();
    const readOnly = service(false);
    expect(readOnly.dataPort.createFile).toBeUndefined();
    expect(readOnly.dataPort.documentPersistence).toBeUndefined();
  });

  it("maps reachability for the folder surface and streams changes", async () => {
    const source = service();
    const changes: Array<string[] | null> = [];
    const states: string[] = [];
    const stop = source.watchFolder((paths) => changes.push(paths), (state) => states.push(state));
    const id = watchHostFolder.mock.calls.at(-1)![0].id;
    eventListener?.({ id, type: "change", paths: [], reset: true });
    eventListener?.({ id, type: "change", paths: ["a.md"], reset: false });
    eventListener?.({ id: "other", type: "change", paths: ["b.md"], reset: false });
    eventListener?.({ id, type: "offline", code: "device_offline" });
    eventListener?.({ id, type: "unavailable", retryable: false, code: "folder_unavailable" });
    expect(changes).toEqual([null, ["a.md"]]);
    expect(states).toEqual(["online", "online", "offline", "revoked"]);
    stop();
    expect(stopHostFolderWatch).toHaveBeenCalledWith({ id });
    requestHostFolder.mockResolvedValueOnce({ ok: false, status: 503, code: "device_offline" });
    const error = await source.dataPort.listChildren(null).catch((cause) => cause);
    expect(availabilityOf(error)).toBe("offline");
  });

  it("hands the workbench the paths a change names and drops only their listings", async () => {
    requestHostFolder.mockImplementation(async ({ operation }) => ({ ok: true, result: { entries: operation.path === ""
      ? [{ name: "docs", kind: "directory", size: 0, modified_ns: "1" }, { name: "other", kind: "directory", size: 0, modified_ns: "1" }]
      : [{ name: "a.md", kind: "file", size: 1, modified_ns: "1" }] } }));
    const source = service();
    await source.dataPort.listChildren(null);
    await source.dataPort.listChildren("docs");
    await source.dataPort.listChildren("other");
    const changed = vi.fn(), failed = vi.fn();
    const stop = source.watch(changed, failed);
    const id = watchHostFolder.mock.calls.at(-1)![0].id;

    eventListener?.({ id, type: "change", paths: ["docs/a.md"], reset: false });
    expect(changed).toHaveBeenLastCalledWith(["docs/a.md"]);
    expect(source.dataPort.getCachedChildren!("docs")).toBeUndefined();
    expect(source.dataPort.getCachedChildren!(null)).toHaveLength(2);
    expect(source.dataPort.getCachedChildren!("other")).toHaveLength(1);

    eventListener?.({ id, type: "change", paths: ["other"], reset: false });
    expect(source.dataPort.getCachedChildren!("other")).toBeUndefined();
    expect(source.dataPort.getCachedChildren!(null)).toBeUndefined();

    await source.dataPort.listChildren(null);
    eventListener?.({ id, type: "change", paths: [], reset: true });
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(source.dataPort.getCachedChildren!(null)).toBeUndefined();
    expect(failed).not.toHaveBeenCalled();
    stop();
  });

  it("runs changes to unrelated paths concurrently and keeps overlapping ones in order", async () => {
    const pending = new Map<string, () => void>();
    const started: string[] = [];
    requestHostFolder.mockImplementation(({ operation }) => {
      const key = `${operation.action}:${operation.path}`;
      started.push(key);
      return new Promise((resolve) => pending.set(key, () => resolve({ ok: true, result: {} })));
    });
    const source = service();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const createA = source.dataPort.createFile!("docs/a.md", "a");
    const createB = source.dataPort.createFile!("other/b.md", "b");
    const removeDocs = source.dataPort.deleteNode!("docs");
    await settle();
    expect(started).toEqual(["write:docs/a.md", "write:other/b.md"]);

    pending.get("write:other/b.md")!();
    await createB;
    expect(started).not.toContain("remove:docs");
    pending.get("write:docs/a.md")!();
    await createA;
    await settle();
    expect(started).toContain("remove:docs");
    pending.get("remove:docs")!();
    await removeDocs;
  });

  it("invalidates old admission on session change", async () => {
    let valid = true;
    const source = service(false, () => valid);
    valid = false;
    expect(() => source.dataPort.listChildren(null)).toThrow("session changed");
  });
});
