import { describe, expect, it } from "vitest";
import {
  resolveDesktopShellLocationPath,
  resolveDesktopShellWorkspaceEntryPath,
} from "../../../../src/features/app-shell/DesktopShellLocationBar";

describe("desktop Shell location bar", () => {
  it("shows the selected folder while the Files view is active", () => {
    expect(resolveDesktopShellLocationPath({
      activePath: "/Users/demo/PuppyOne/document",
      dataViewActive: true,
      workspacePath: "/Users/demo/PuppyOne",
    })).toBe("/Users/demo/PuppyOne/document");
  });

  it("shows the complete active editor file path", () => {
    expect(resolveDesktopShellLocationPath({
      activePath: "/Users/demo/PuppyOne/document/README.md",
      dataViewActive: true,
      workspacePath: "/Users/demo/PuppyOne",
    })).toBe("/Users/demo/PuppyOne/document/README.md");
  });

  it("falls back to the workspace outside Files or for an unrelated path", () => {
    expect(resolveDesktopShellLocationPath({
      activePath: "/Users/demo/Other/file.md",
      dataViewActive: true,
      workspacePath: "/Users/demo/PuppyOne/",
    })).toBe("/Users/demo/PuppyOne");
    expect(resolveDesktopShellLocationPath({
      activePath: "C:\\PuppyOne\\document\\README.md",
      dataViewActive: false,
      workspacePath: "C:\\PuppyOne\\",
    })).toBe("C:\\PuppyOne");
  });

  it("turns relative explorer paths into a full address without leaving the workspace", () => {
    expect(resolveDesktopShellLocationPath({
      activePath: "document/README.md",
      dataViewActive: true,
      workspacePath: "/Users/demo/PuppyOne",
    })).toBe("/Users/demo/PuppyOne/document/README.md");
    expect(resolveDesktopShellLocationPath({
      activePath: "README.md",
      dataViewActive: true,
      workspacePath: "/Users/demo/PuppyOne",
    })).toBe("/Users/demo/PuppyOne/README.md");
  });

  it("maps entered addresses back to workspace-scoped entry paths", () => {
    expect(resolveDesktopShellWorkspaceEntryPath(
      "/Users/demo/PuppyOne/document",
      "/Users/demo/PuppyOne",
    )).toBe("document");
    expect(resolveDesktopShellWorkspaceEntryPath(
      "/Users/demo/PuppyOne",
      "/Users/demo/PuppyOne",
    )).toBeNull();
    expect(resolveDesktopShellWorkspaceEntryPath(
      "/Users/demo/Other",
      "/Users/demo/PuppyOne",
    )).toBeUndefined();
    expect(resolveDesktopShellWorkspaceEntryPath(
      "../Other",
      "/Users/demo/PuppyOne",
    )).toBeUndefined();
  });
});
