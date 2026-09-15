import { describe, expect, it } from "vitest";
import {
  ResourceUriIdentityService,
  createWorkspaceResourceUri,
  createWorkspaceRootUri,
  getWorkspaceResourcePath,
  parseResourceUri,
} from "../../../../packages/shared-ui/src/core/resourceUri";

describe("workspace Resource URI identity", () => {
  it("keeps equal relative paths in different folders globally distinct", () => {
    const folderA = createWorkspaceRootUri("folder-a");
    const folderB = createWorkspaceRootUri("folder-b");
    const resourceA = createWorkspaceResourceUri(folderA, "./src\\App.tsx");
    const resourceB = createWorkspaceResourceUri(folderB, "src//App.tsx");
    const identity = new ResourceUriIdentityService();

    expect(getWorkspaceResourcePath(folderA, resourceA)).toBe("src/App.tsx");
    expect(getWorkspaceResourcePath(folderB, resourceB)).toBe("src/App.tsx");
    expect(identity.canonicalKey(resourceA)).not.toBe(identity.canonicalKey(resourceB));
    expect(identity.isEqual(resourceA, resourceB)).toBe(false);
  });

  it("normalizes provider paths without permitting traversal outside the root", () => {
    const root = createWorkspaceRootUri("folder with spaces");
    const resource = createWorkspaceResourceUri(root, "docs/./guides/../README.md");

    expect(parseResourceUri(resource)).toMatchObject({
      scheme: "puppyone-local",
      authority: "workspace",
      path: "folder with spaces/docs/README.md",
    });
    expect(() => createWorkspaceResourceUri(root, "../../escape.md")).toThrow(/outside|traversal/i);
  });

  it("owns equality, ancestry, relative paths, and rebasing for one provider", () => {
    const identity = new ResourceUriIdentityService();
    const root = createWorkspaceRootUri("folder-a");
    const docs = createWorkspaceResourceUri(root, "docs");
    const note = createWorkspaceResourceUri(root, "docs/nested/note.md");
    const renamed = createWorkspaceResourceUri(root, "notes");

    expect(identity.isEqualOrParent(note, docs)).toBe(true);
    expect(identity.relativePath(docs, note)).toBe("nested/note.md");
    expect(identity.rebase(note, docs, renamed)).toBe(
      createWorkspaceResourceUri(root, "notes/nested/note.md"),
    );
  });

  it("uses provider-declared path casing without changing folder authority", () => {
    const root = createWorkspaceRootUri("Folder-A");
    const upper = createWorkspaceResourceUri(root, "Docs/Note.md");
    const lower = createWorkspaceResourceUri(root, "docs/note.md");

    expect(new ResourceUriIdentityService().isEqual(upper, lower)).toBe(false);
    expect(new ResourceUriIdentityService({
      isPathCaseSensitive: () => false,
    }).isEqual(upper, lower)).toBe(true);
  });
});
