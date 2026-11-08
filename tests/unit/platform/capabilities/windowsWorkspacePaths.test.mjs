import { describe, expect, it, vi } from "vitest";

vi.mock("node:path", async importOriginal => {
  const original = await importOriginal();
  return { ...original, default: original.win32 };
});

import { isSameOrInsidePath, resolveWorkspacePath } from "../../../../electron/local-api/files/path-policy.mjs";

describe("Windows workspace path boundaries", () => {
  it.each(["C:\\", "D:\\", "\\\\server\\share\\"])("allows a folder beneath a selected volume root: %s", root => {
    expect(resolveWorkspacePath(root, "notes/file.md")).toBe(`${root}notes\\file.md`);
  });

  it("uses Windows case-insensitive identity and permits names beginning with two dots", () => {
    expect(isSameOrInsidePath("C:\\workspace", "c:\\WORKSPACE")).toBe(true);
    expect(isSameOrInsidePath("C:\\workspace", "C:\\workspace\\..notes")).toBe(true);
  });

  it.each(["..\\outside.md", "C:\\outside.md", "D:\\outside.md", "\\\\server\\share\\outside.md"])(
    "continues to reject a path outside the workspace: %s", candidate => {
      expect(() => resolveWorkspacePath("C:\\workspace", candidate)).toThrow();
    });

  it("does not treat a sibling with the same prefix as a descendant", () => {
    expect(isSameOrInsidePath("C:\\workspace", "C:\\workspace-other\\file.md")).toBe(false);
  });
});
