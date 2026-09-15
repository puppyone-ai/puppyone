import { describe, expect, it } from "vitest";
import {
  createWorkspaceResourceUri,
  createWorkspaceRootUri,
} from "../../../../packages/shared-ui/src/core/resourceUri";
import {
  createDocumentIdentity,
  getDocumentIdentityKey,
} from "../../../../packages/shared-ui/src/editor/document-session/documentIdentity";

describe("DocumentIdentity", () => {
  it("retains legacy provider-path canonicalization", () => {
    const identity = createDocumentIdentity(
      { storageIdentity: "local-workbench:test" },
      ".\\docs//README.md",
    );

    expect(identity.resourcePath).toBe("docs/README.md");
  });

  it("preserves canonical Workspace Resource URIs", () => {
    const resource = createWorkspaceResourceUri(
      createWorkspaceRootUri("folder-a"),
      "docs/guanqun.md",
    );

    const identity = createDocumentIdentity(
      { storageIdentity: "local-workbench:test" },
      resource,
    );

    expect(identity.resourcePath).toBe(resource);
    expect(identity.resourcePath).toContain("://");
  });

  it("keeps equal provider paths in different Workspace Folders as distinct fingerprints", () => {
    const storage = { storageIdentity: "local-workbench:test" };
    const first = createDocumentIdentity(
      storage,
      createWorkspaceResourceUri(createWorkspaceRootUri("folder-a"), "README.md"),
    );
    const second = createDocumentIdentity(
      storage,
      createWorkspaceResourceUri(createWorkspaceRootUri("folder-b"), "README.md"),
    );

    expect(first.resourcePath).toBe("puppyone-local://workspace/folder-a/README.md");
    expect(second.resourcePath).toBe("puppyone-local://workspace/folder-b/README.md");
    expect(getDocumentIdentityKey(first)).not.toBe(getDocumentIdentityKey(second));
  });
});
