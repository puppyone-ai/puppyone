import { describe, expect, it } from "vitest";
import { getWorkspaceParentPathForDisplay, getWorkspacePathForDisplay } from "../../../../src/features/app-shell/workspaceHomeModel";

describe("desktop workspace display path", () => {
  it("abbreviates Mac home paths without removing the project or abbreviating external locations", () => {
    expect(getWorkspacePathForDisplay("/Users/example/project/demo")).toBe("~/project/demo");
    expect(getWorkspacePathForDisplay("/Users/example")).toBe("~");
    expect(getWorkspacePathForDisplay("/Volumes/Projects/demo")).toBe("/Volumes/Projects/demo");
    expect(getWorkspacePathForDisplay("C:\\Projects\\demo")).toBe("C:\\Projects\\demo");
  });

  it("shows the home-relative parent without repeating the project name", () => {
    expect(getWorkspaceParentPathForDisplay("/Users/example/Desktop/puppyone desktop"))
      .toBe("~/Desktop");
  });

  it("keeps non-home parent paths canonical", () => {
    expect(getWorkspaceParentPathForDisplay("/private/tmp/puppyone-project"))
      .toBe("/private/tmp");
  });

  it("handles trailing separators and filesystem roots", () => {
    expect(getWorkspaceParentPathForDisplay("/Users/example/Documents/demo/"))
      .toBe("~/Documents");
    expect(getWorkspaceParentPathForDisplay("/workspace"))
      .toBe("/");
  });
});
