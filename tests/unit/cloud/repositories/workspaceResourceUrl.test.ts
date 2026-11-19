import { describe, expect, it } from "vitest";
import { workspaceResourceUrl, workspaceResourcePath } from "../../../../src/features/cloud/files/workspaceResourceUrl";

const projectId = "01926faa-7ed1-7000-a000-000000000001";

describe("Cloud resource locators", () => {
  it("locates the root and nested folders without provisioning a share", () => {
    expect(workspaceResourceUrl("https://app.example/settings", projectId)).toBe(`https://app.example/${projectId}/`);
    expect(workspaceResourcePath(projectId, "notes/nested", true)).toBe(`/${projectId}/notes/nested/`);
  });

  it.each(["docs/笔记 #1?.md", "100%/literal%2F.md", "emoji/🐶.txt", "a+b/space here.md"])(
    "preserves path segments for %s", (path) => {
      const url = new URL(workspaceResourceUrl("https://app.example", projectId, path));
      expect(url.pathname.split("/").slice(2).map(decodeURIComponent).join("/")).toBe(path);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    },
  );

  it.each(["../secret", "/notes", "notes/", "a//b", "a/../b", "a\\b", "a\u0000b", "a\nb"])(
    "rejects a path that cannot be a safe website locator: %j", (path) => {
      expect(() => workspaceResourcePath(projectId, path)).toThrow();
    },
  );

  it("rejects missing project identity and non-web origins", () => {
    expect(() => workspaceResourcePath("project")).toThrow();
    expect(() => workspaceResourceUrl("file:///tmp", projectId)).toThrow();
    expect(() => workspaceResourceUrl("https://user:password@app.example", projectId)).toThrow();
  });
});
