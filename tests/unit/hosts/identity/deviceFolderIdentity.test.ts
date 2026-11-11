import { describe, expect, it } from "vitest";
import { deviceFolderResourceUri, deviceFolderRootUri, type DeviceFolderRef } from "../../../../src/features/hosts/model/deviceFolderIdentity";
import { getWorkspaceResourcePath } from "../../../../src/shared-ui/core/resourceUri";

const ref: DeviceFolderRef = {
  deployment: "https://api.puppyone.ai/api/v1",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  folderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

describe("device folder identity", () => {
  it("is stable across connection and display changes, but separated by account, device, folder and deployment", () => {
    const root = deviceFolderRootUri(ref);
    expect(deviceFolderRootUri({ ...ref, deployment: "https://api.puppyone.ai/api/v1/" })).toBe(root);
    for (const changed of [
      { accountId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { deviceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { folderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { deployment: "http://localhost:9090/api/v1" },
    ]) expect(deviceFolderRootUri({ ...ref, ...changed })).not.toBe(root);
    expect(getWorkspaceResourcePath(root, deviceFolderResourceUri(ref, "notes/a.md"))).toBe("notes/a.md");
  });

  it("rejects path escapes, non-IDs and arbitrary deployments", () => {
    expect(() => deviceFolderResourceUri(ref, "../other/secret")).toThrow();
    expect(() => deviceFolderResourceUri(ref, "/etc/passwd")).toThrow();
    expect(() => deviceFolderRootUri({ ...ref, folderId: "a/b" })).toThrow();
    expect(() => deviceFolderRootUri({ ...ref, deployment: "http://169.254.169.254/" })).toThrow();
    expect(() => deviceFolderRootUri({ ...ref, deployment: "https://user:pass@api.puppyone.ai/api/v1" })).toThrow();
  });
});
