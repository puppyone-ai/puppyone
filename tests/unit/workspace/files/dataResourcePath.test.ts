import { describe, expect, it } from "vitest";
import {
  canonicalizeResourcePath,
  collectDataResourceAncestors,
  createWorkspaceResourceUri,
  createWorkspaceRootUri,
  getDataResourceName,
  getDataResourceParent,
  isDataResourceDescendant,
  isSameDataResource,
  joinDataResourcePath,
  normalizeDataResourcePath,
  qualifyDataResourcePath,
  rebaseDataResourcePath,
} from "../../../../packages/shared-ui/src";

describe("data Resource path operations", () => {
  it("preserves Resource URI identity across navigation operations", () => {
    const root = createWorkspaceRootUri("folder-a");
    const src = createWorkspaceResourceUri(root, "src");
    const file = createWorkspaceResourceUri(root, "src/App.tsx");

    expect(normalizeDataResourcePath(file)).toBe(file);
    expect(getDataResourceName(file)).toBe("App.tsx");
    expect(getDataResourceParent(file)).toBe(src);
    expect(joinDataResourcePath(src, "App.tsx")).toBe(file);
    expect(collectDataResourceAncestors(file)).toEqual([root, src]);
    expect(isDataResourceDescendant(file, root)).toBe(true);
    expect(isSameDataResource(file, createWorkspaceResourceUri(root, "src/./App.tsx"))).toBe(true);
  });

  it("does not expose a parent above a Workspace Folder root", () => {
    const root = createWorkspaceRootUri("folder-a");
    expect(getDataResourceParent(root)).toBeNull();
    expect(collectDataResourceAncestors(root)).toEqual([]);
  });

  it("keeps equal provider paths isolated by Folder URI", () => {
    const first = createWorkspaceResourceUri(createWorkspaceRootUri("folder-a"), "README.md");
    const second = createWorkspaceResourceUri(createWorkspaceRootUri("folder-b"), "README.md");

    expect(isSameDataResource(first, second)).toBe(false);
    expect(isDataResourceDescendant(first, createWorkspaceRootUri("folder-b"))).toBe(false);
  });

  it("rebases descendants without crossing Workspace Folders", () => {
    const root = createWorkspaceRootUri("folder-a");
    const before = createWorkspaceResourceUri(root, "docs");
    const after = createWorkspaceResourceUri(root, "notes");
    const child = createWorkspaceResourceUri(root, "docs/guide.md");

    expect(rebaseDataResourcePath(child, before, after)).toBe(
      createWorkspaceResourceUri(root, "notes/guide.md"),
    );
  });

  it("retains legacy relative path behavior", () => {
    expect(normalizeDataResourcePath("./src//App.tsx")).toBe("src/App.tsx");
    expect(getDataResourceParent("src/App.tsx")).toBe("src");
    expect(joinDataResourcePath("src", "App.tsx")).toBe("src/App.tsx");
    expect(collectDataResourceAncestors("src/components/App.tsx")).toEqual(["src", "src/components"]);
  });

  it("fails closed when a Resource URI delimiter has been damaged", () => {
    const malformed = "puppyone-local:/workspace/folder-a/docs/guanqun.md";

    expect(() => normalizeDataResourcePath(malformed)).toThrow(/Malformed Resource URI/i);
    expect(() => getDataResourceName(malformed)).toThrow(/Malformed Resource URI/i);
    expect(() => normalizeDataResourcePath(
      ".\\puppyone-local:\\workspace\\folder-a\\docs\\guanqun.md",
    )).toThrow(/Malformed Resource URI/i);
  });

  it("refuses to normalize Resource URIs as provider-relative paths", () => {
    expect(() => canonicalizeResourcePath(
      "puppyone-local://workspace/folder-a/docs/guanqun.md",
    )).toThrow(/provider-relative paths/i);
    expect(() => canonicalizeResourcePath(
      "puppyone-local:/workspace/folder-a/docs/guanqun.md",
    )).toThrow(/provider-relative paths/i);
  });

  it("refuses to encode host absolute paths as provider-relative resources", () => {
    const root = createWorkspaceRootUri("folder-a");

    expect(() => qualifyDataResourcePath(
      root,
      "/Users/example/project/README.md",
    )).toThrow(/provider-relative paths/i);
    expect(() => createWorkspaceResourceUri(
      root,
      "/Users/example/project/README.md",
    )).toThrow(/provider paths/i);
  });
});
