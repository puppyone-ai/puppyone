import { describe, expect, it, vi } from "vitest";
import { deviceFolderRootUri } from "../../../../src/features/hosts/model/deviceFolderIdentity";
import { createDeviceDataService } from "../../../../src/features/hosts/data/deviceDataPort";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

const cloudApiRequest = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest }));
const ref = {
  deployment: "https://api.puppyone.ai/api/v1",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  folderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const revision = "a".repeat(64);
const session = { user_id: ref.accountId, api_base_url: ref.deployment,
  session_generation: "one" } as DesktopCloudSession;

function service(writable = true, isCurrent = () => true) {
  return createDeviceDataService({ ref, name: "Notes", writable, session,
    apiBase: ref.deployment, isCurrent });
}

describe("device DataPort", () => {
  it("routes a resource to one folder and reads text without a local path", async () => {
    cloudApiRequest.mockImplementation(async (path: string) => {
      if (path.endsWith("/files?path=")) return [{ name: "note.md", type: "file" }];
      if (path.endsWith("/file?path=note.md")) return { content_base64: "bm90ZQ==", revision };
      throw new Error(path);
    });
    const source = service();
    const children = await source.dataPort.listChildren(null);
    expect(children).toHaveLength(1);
    expect(children[0].source).toBe("device");
    const content = await source.dataPort.readFile!(children[0].path);
    expect(content.content).toBe("note");
    expect(content.version).toBe(revision);
    expect(String(content.path)).toContain(String(deviceFolderRootUri(ref)));
    await expect(source.dataPort.readFile!("../secret")).rejects.toThrow();
    await expect(source.dataPort.readFile!("/etc/passwd")).rejects.toThrow();
  });

  it("does not retry an uncertain write or send it to another account", async () => {
    cloudApiRequest.mockReset();
    cloudApiRequest.mockRejectedValueOnce(new Error("connection lost"));
    const source = service();
    const result = await source.dataPort.documentPersistence!.persist({
      path: "note.md", content: "new", revision: "draft", baseVersion: revision, reason: "manual",
    });
    expect(result).toMatchObject({ ok: false, kind: "io" });
    expect(cloudApiRequest).toHaveBeenCalledTimes(1);
    expect(() => createDeviceDataService({ ref, name: "Notes", writable: true,
      session: { ...session, user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, apiBase: ref.deployment })).toThrow();
  });

  it("returns a fresh conflict snapshot without replaying the rejected write", async () => {
    cloudApiRequest.mockReset();
    cloudApiRequest.mockRejectedValueOnce(Object.assign(new Error("Conflict"), { status: 409 }));
    cloudApiRequest.mockResolvedValueOnce({ content_base64: "ZXh0ZXJuYWw=", revision: "b".repeat(64) });
    const source = service();
    const result = await source.dataPort.documentPersistence!.persist({
      path: "note.md", content: "draft", revision: "draft", baseVersion: revision, reason: "manual",
    });
    expect(result).toMatchObject({ ok: false, kind: "conflict", content: "external", version: "b".repeat(64) });
    expect(cloudApiRequest).toHaveBeenCalledTimes(2);
    expect(cloudApiRequest.mock.calls[0][0]).toContain("/file");
    expect(cloudApiRequest.mock.calls[1][0]).toContain("/file?path=note.md");
  });

  it("invalidates old admission on session change", async () => {
    let valid = true;
    const source = service(false, () => valid);
    valid = false;
    expect(() => source.dataPort.listChildren(null)).toThrow("session changed");
  });
});
