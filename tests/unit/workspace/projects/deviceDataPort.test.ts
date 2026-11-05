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

  it("invalidates old admission on session change", async () => {
    let valid = true;
    const source = service(false, () => valid);
    valid = false;
    expect(() => source.dataPort.listChildren(null)).toThrow("session changed");
  });
});
